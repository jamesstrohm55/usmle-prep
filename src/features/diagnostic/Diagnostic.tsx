import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRun, fetchAttempts, fetchQuestions, fetchRunAttempts, fetchRuns, saveAttempts, setRunStatus, type Run,
} from '../../db/queries';
import type { Question } from '../../db/models';
import type { AttemptInsert } from '../../db/queries';
import { sampleDiagnostic, summarizeRun } from '../../engine/diagnostic';
import { latestPerQuestion } from '../../engine/planner';
import { gradeAnswer, type Answer } from '../../engine/mcq';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';
import { ItemImage } from '../../ui/ItemImage';
import { uuid } from '../../ui/uuid';
import { systemLabel } from '../../ui/systemLabel';
import { Loading } from '../../ui/Loading';
import { useT } from '../../ui/lang';
import { errMsg } from '../../ui/errMsg';

export async function loadDiagnostic() {
  const [questions, attempts, runs] = await Promise.all([fetchQuestions(), fetchAttempts(), fetchRuns()]);
  return { questions, attempts, runs };
}
export type DiagnosticData = Awaited<ReturnType<typeof loadDiagnostic>>;
export type DiagnosticDeps = {
  createRun: typeof createRun; setRunStatus: typeof setRunStatus;
  fetchRunAttempts: typeof fetchRunAttempts; saveAttempts: typeof saveAttempts;
};
const DEPS: DiagnosticDeps = { createRun, setRunStatus, fetchRunAttempts, saveAttempts };
type RunAnswer = { question_id: string; chosen: number; correct: boolean };
type View = 'home' | 'question' | 'review' | 'results';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Diagnostic({ load = loadDiagnostic, deps = DEPS }: { load?: () => Promise<DiagnosticData>; deps?: DiagnosticDeps }) {
  const toast = useToast();
  const tr = useT();
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [run, setRun] = useState<Run | null>(null);
  const [answered, setAnswered] = useState<RunAnswer[]>([]); // every saved answer of the run, all sittings
  const [sitting, setSitting] = useState<Answer[]>([]);
  const [showPt, setShowPt] = useState(false);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const loadRef = useRef(load);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // Refs mirror state so a double click or a late Retry can't act on stale values.
  const answeredIds = useRef(new Set<string>());
  const answeredThisVisit = useRef(new Set<string>()); // survives resetRun so a later draw skips them
  const stemRef = useRef<HTMLParagraphElement>(null);
  const busy = useRef(false);
  const runId = useRef<string | null>(null); // a late save or Retry for another run must not land here
  const shownAt = useRef(Date.now());

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const resetRun = (r: Run | null, rows: RunAnswer[]) => {
    answeredIds.current = new Set(rows.map((a) => a.question_id));
    runId.current = r?.id ?? null;
    toast.dismiss(); // a Retry from the previous run must not survive into this one
    setRun(r); setAnswered(rows); setSitting([]); setShowPt(false);
  };

  const focusId = view === 'question' ? run?.question_ids.find((id) => !answeredIds.current.has(id)) : undefined;
  useEffect(() => { stemRef.current?.focus(); }, [focusId, view]);

  const refresh = useCallback(() => {
    setError(null);
    (async () => {
      const d = await loadRef.current();
      // fetchRuns is newest first; only an active run or a completed latest run is shown.
      const r = d.runs.find((x) => x.status === 'in_progress') ?? (d.runs[0]?.status === 'completed' ? d.runs[0] : null);
      const rows = r ? await depsRef.current.fetchRunAttempts(r.id) : [];
      if (!alive.current) return;
      setData(d); resetRun(r, rows); setView(r?.status === 'completed' ? 'results' : 'home');
    })().catch((e) => { if (alive.current) setError(errMsg(e)); });
  }, []);
  useEffect(refresh, [refresh]);

  if (error) return <p role="alert">{tr('Could not load the diagnostic:')} {error} <button onClick={refresh}>{tr('Retry')}</button></p>;
  if (!data) return <Loading />;

  const byId = new Map(data.questions.map((q) => [q.id, q]));
  // A question deleted from the bank since the draw is dropped rather than blocking the run.
  const runQs = run ? run.question_ids.map((id) => byId.get(id)).filter((q): q is Question => !!q) : [];
  const current = runQs.find((q) => !answeredIds.current.has(q.id));
  const inRun = new Set(runQs.map((q) => q.id));
  const doneCount = answered.filter((a) => inRun.has(a.question_id)).length;
  const progress = <div className="q-top"><small>{tr('{a} of {b} answered', { a: doneCount, b: runQs.length })}</small><div className="meter" aria-hidden="true"><i style={{ width: `${runQs.length ? (doneCount / runQs.length) * 100 : 0}%` }} /></div></div>;

  async function start() {
    if (busy.current) return;
    busy.current = true;
    try {
      const seen = new Set([...latestPerQuestion(data!.attempts).keys(), ...answeredThisVisit.current]);
      const seed = uuid();
      const ids = sampleDiagnostic(data!.questions, seen, seed);
      if (!ids.length) return;
      const r = await depsRef.current.createRun(ids, seed);
      if (!alive.current) return;
      resetRun(r, []); setView('question'); shownAt.current = Date.now();
    } catch (e) {
      const msg = (e as { code?: string }).code === '23505'
        ? tr('A diagnostic is already in progress on another device. Reload to resume it.')
        : tr('Could not start the diagnostic: {m}', { m: errMsg(e) });
      toast.show(msg, start);
    } finally { busy.current = false; }
  }

  // Mark complete, then reload the run's answers so results show what the database holds (a 23505 may hide a different choice).
  function finish(r: Run) {
    let marked = false;
    const go = async () => {
      try {
        if (!marked) { await depsRef.current.setRunStatus(r.id, 'completed'); marked = true; }
        const rows = await depsRef.current.fetchRunAttempts(r.id);
        if (!alive.current || runId.current !== r.id) return;
        answeredIds.current = new Set(rows.map((a) => a.question_id));
        setAnswered(rows);
      } catch (e) {
        if (alive.current && runId.current === r.id) toast.show(tr('Could not finish the diagnostic: {m}', { m: errMsg(e) }), go);
      }
    };
    go();
    setRun({ ...r, status: 'completed' });
  }

  function choose(q: Question, chosen: number) {
    if (busy.current || answeredIds.current.has(q.id)) return;
    const a = gradeAnswer(q, chosen, Date.now() - shownAt.current);
    const row: AttemptInsert = { question_id: q.id, chosen, correct: a.correct, duration_ms: a.durationMs, mode: 'timed', session_id: run!.id };
    submit(run!, a, row);
  }

  // Graded once in choose; Retry re-sends the same row.
  async function submit(r: Run, a: Answer, row: AttemptInsert) {
    if (busy.current || runId.current !== r.id || answeredIds.current.has(a.questionId)) return;
    busy.current = true; setSaving(true);
    try {
      await depsRef.current.saveAttempts([row]);
    } catch (e) {
      // 23505 = unique (session_id, question_id): an earlier save of this answer already landed.
      if ((e as { code?: string }).code !== '23505') {
        if (alive.current && runId.current === r.id) toast.show(tr('Could not save your answer: {m}', { m: errMsg(e) }), () => submit(r, a, row));
        return;
      }
    } finally { busy.current = false; if (alive.current) setSaving(false); }
    if (!alive.current || runId.current !== r.id || answeredIds.current.has(a.questionId)) return;
    answeredIds.current.add(a.questionId);
    answeredThisVisit.current.add(a.questionId);
    toast.dismiss();
    setAnswered((xs) => [...xs, { question_id: a.questionId, chosen: a.chosen, correct: a.correct }]);
    setSitting((xs) => [...xs, a]);
    shownAt.current = Date.now();
    if (runQs.every((x) => answeredIds.current.has(x.id))) { finish(r); setView('review'); }
  }

  async function startOver() {
    if (!window.confirm(tr('Abandon this diagnostic? Answers already given stay in your history.'))) return;
    try {
      await depsRef.current.setRunStatus(run!.id, 'abandoned');
      if (alive.current) { resetRun(null, []); setView('home'); }
    } catch (e) { toast.show(tr('Could not start over: {m}', { m: errMsg(e) }), startOver); }
  }

  if (view === 'question' && current) return (
    <div className="card">
      {progress}
      <p ref={stemRef} tabIndex={-1} className="stem">{current.stem}</p>
      <ItemImage src={current.image_url} credit={current.image_credit} />
      <div className="choices">{current.choices.map((c, i) => <div key={i} className="choice-row"><button className="choice" disabled={saving} onClick={() => choose(current, i)}>{c}</button></div>)}</div>
      <p className="q-nav"><button disabled={saving} onClick={() => { setShowPt(false); setView('review'); }}>{tr('Pause')}</button></p>
    </div>
  );

  if (view === 'review') return (
    <div className="card">
      <h2>{tr('This sitting: {n} answered', { n: sitting.length })}</h2>
      {sitting.some((a) => byId.get(a.questionId)?.explanation_pt) && !showPt &&
        <button onClick={() => setShowPt(true)}>Ver em português</button>}
      {sitting.map((a) => {
        const q = byId.get(a.questionId)!;
        const chosen = answered.find((x) => x.question_id === q.id)?.chosen ?? a.chosen; // database wins after the reload
        return (
          <div key={q.id} className="review-item">
            <p className="stem">{q.stem}</p>
            <p className="muted">{tr('Your answer:')} {q.choices[chosen]}</p>
            <p className="muted">{tr('Correct answer:')} {q.choices[q.correct]}</p>
            <div className="explain">
              <p><Rich text={q.explanation} /></p>
              {showPt && q.explanation_pt && <p className="pt" lang="pt-BR"><Rich text={q.explanation_pt} /></p>}
            </div>
          </div>
        );
      })}
      {run?.status === 'completed'
        ? <button className="primary" onClick={() => setView('results')}>{tr('See results')}</button>
        : <button className="primary" onClick={() => { setSitting([]); setView('home'); }}>{tr('Back')}</button>}
    </div>
  );

  if (view === 'results' && run) {
    const s = summarizeRun(runQs, answered);
    return (
      <div className="card">
        <h2 className="summary-score">{tr('{c} of {t} correct', { c: s.correct, t: s.total })}</h2>
        <ul className="results">{s.bySystem.map((r) => (
          <li key={r.system}>
            {systemLabel(r.system, tr)}: {r.accuracy === null ? tr('not answered') : tr('{c} of {a} correct ({p})', { c: r.correct, a: r.answered, p: pct(r.accuracy) })}
            {r.lowConfidence && ` · ${tr('low confidence')}`}
          </li>
        ))}</ul>
        <button className="primary" onClick={start}>{tr('Start another diagnostic')}</button>
      </div>
    );
  }

  if (run) return (
    <div className="card">
      {progress}
      <button className="primary" onClick={() => {
        // Every answer saved but the completion call never landed (closed tab): finish it now.
        if (!current) { finish(run); setView('results'); return; }
        setSitting([]); setShowPt(false); shownAt.current = Date.now(); setView('question');
      }}>{tr('Resume')}</button>{' '}
      <button onClick={startOver}>{tr('Start over')}</button>
    </div>
  );

  return (
    <div className="card">
      <h2>{tr('Diagnostic')}</h2>
      <p>{tr('The diagnostic samples about 100 questions across systems to find where you stand. Answer in short sittings: pause any time and resume later. Explanations appear when you pause or finish.')}</p>
      {data.questions.length ? <button className="primary" onClick={start}>{tr('Start diagnostic')}</button> : <p>{tr('No questions yet.')}</p>}
    </div>
  );
}
