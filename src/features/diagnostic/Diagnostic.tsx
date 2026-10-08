import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRun, fetchAttempts, fetchQuestions, fetchRunAttempts, fetchRuns, saveAttempts, setRunStatus, type Run,
} from '../../db/queries';
import type { Question } from '../../db/models';
import { sampleDiagnostic, summarizeRun } from '../../engine/diagnostic';
import { latestPerQuestion } from '../../engine/planner';
import { gradeAnswer, type Answer } from '../../engine/mcq';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';
import { ItemImage } from '../../ui/ItemImage';
import { uuid } from '../../ui/uuid';

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
type RunAnswer = { question_id: string; correct: boolean };
type View = 'home' | 'question' | 'review' | 'results';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Diagnostic({ load = loadDiagnostic, deps = DEPS }: { load?: () => Promise<DiagnosticData>; deps?: DiagnosticDeps }) {
  const toast = useToast();
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [run, setRun] = useState<Run | null>(null);
  const [answered, setAnswered] = useState<RunAnswer[]>([]); // every saved answer of the run, all sittings
  const [sitting, setSitting] = useState<Answer[]>([]);
  const [showPt, setShowPt] = useState(false);
  const alive = useRef(true);
  const loadRef = useRef(load);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // Refs mirror state so a double click or a late Retry can't act on stale values.
  const answeredIds = useRef(new Set<string>());
  const busy = useRef(false);
  const shownAt = useRef(Date.now());

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const resetRun = (r: Run | null, rows: RunAnswer[]) => {
    answeredIds.current = new Set(rows.map((a) => a.question_id));
    setRun(r); setAnswered(rows); setSitting([]); setShowPt(false);
  };

  const refresh = useCallback(() => {
    setError(null);
    (async () => {
      const d = await loadRef.current();
      // fetchRuns is newest first; only an active run or a completed latest run is shown.
      const r = d.runs.find((x) => x.status === 'in_progress') ?? (d.runs[0]?.status === 'completed' ? d.runs[0] : null);
      const rows = r ? await depsRef.current.fetchRunAttempts(r.id) : [];
      if (!alive.current) return;
      setData(d); resetRun(r, rows); setView(r?.status === 'completed' ? 'results' : 'home');
    })().catch((e) => { if (alive.current) setError(e.message); });
  }, []);
  useEffect(refresh, [refresh]);

  if (error) return <p>Could not load the diagnostic: {error} <button onClick={refresh}>Retry</button></p>;
  if (!data) return <p>Loading…</p>;

  const byId = new Map(data.questions.map((q) => [q.id, q]));
  // A question deleted from the bank since the draw is dropped rather than blocking the run.
  const runQs = run ? run.question_ids.map((id) => byId.get(id)).filter((q): q is Question => !!q) : [];
  const current = runQs.find((q) => !answeredIds.current.has(q.id));
  const progress = <p>{answered.length} of {runQs.length} answered</p>;

  async function start() {
    if (busy.current) return;
    busy.current = true;
    try {
      const seen = new Set(latestPerQuestion(data!.attempts).keys());
      const seed = uuid();
      const ids = sampleDiagnostic(data!.questions, seen, seed);
      if (!ids.length) return;
      const r = await depsRef.current.createRun(ids, seed);
      if (!alive.current) return;
      resetRun(r, []); setView('question'); shownAt.current = Date.now();
    } catch (e) {
      toast.show(`Could not start the diagnostic: ${(e as Error).message}`, start);
    } finally { busy.current = false; }
  }

  function complete(r: Run) {
    depsRef.current.setRunStatus(r.id, 'completed')
      .catch((e) => { if (alive.current) toast.show(`Could not mark the diagnostic complete: ${(e as Error).message}`, () => complete(r)); });
  }

  async function choose(q: Question, chosen: number) {
    const r = run!;
    if (busy.current || answeredIds.current.has(q.id)) return;
    busy.current = true;
    const a = gradeAnswer(q, chosen, Date.now() - shownAt.current);
    try {
      await depsRef.current.saveAttempts([{ question_id: q.id, chosen, correct: a.correct, duration_ms: a.durationMs, mode: 'timed', session_id: r.id }]);
    } catch (e) {
      // 23505 = unique (session_id, question_id): an earlier save of this answer already landed.
      if ((e as { code?: string }).code !== '23505') {
        if (alive.current) toast.show(`Could not save your answer: ${(e as Error).message}`, () => choose(q, chosen));
        return;
      }
    } finally { busy.current = false; }
    if (!alive.current || answeredIds.current.has(q.id)) return;
    answeredIds.current.add(q.id);
    toast.dismiss();
    setAnswered((xs) => [...xs, { question_id: q.id, correct: a.correct }]);
    setSitting((xs) => [...xs, a]);
    shownAt.current = Date.now();
    if (runQs.every((x) => answeredIds.current.has(x.id))) {
      complete(r);
      setRun({ ...r, status: 'completed' });
      setView('review');
    }
  }

  async function startOver() {
    if (!window.confirm('Abandon this diagnostic? Answers already given stay in your history.')) return;
    try {
      await depsRef.current.setRunStatus(run!.id, 'abandoned');
      if (alive.current) { resetRun(null, []); setView('home'); }
    } catch (e) { toast.show(`Could not start over: ${(e as Error).message}`, startOver); }
  }

  if (view === 'question' && current) return (
    <div className="card">
      {progress}
      <p>{current.stem}</p>
      <ItemImage src={current.image_url} credit={current.image_credit} />
      {current.choices.map((c, i) => <div key={i}><button onClick={() => choose(current, i)}>{c}</button></div>)}
      <p><button onClick={() => { setShowPt(false); setView('review'); }}>Pause</button></p>
    </div>
  );

  if (view === 'review') return (
    <div className="card">
      <h2>This sitting: {sitting.length} answered</h2>
      {sitting.some((a) => byId.get(a.questionId)?.explanation_pt) && !showPt &&
        <button onClick={() => setShowPt(true)}>Ver em português</button>}
      {sitting.map((a) => {
        const q = byId.get(a.questionId)!;
        return (
          <div key={q.id}>
            <p>{q.stem}</p>
            <p>Your answer: {q.choices[a.chosen]}</p>
            <p>Correct answer: {q.choices[q.correct]}</p>
            <p><Rich text={q.explanation} /></p>
            {showPt && q.explanation_pt && <p lang="pt-BR"><Rich text={q.explanation_pt} /></p>}
          </div>
        );
      })}
      {run?.status === 'completed'
        ? <button onClick={() => setView('results')}>See results</button>
        : <button onClick={() => { setSitting([]); setView('home'); }}>Back</button>}
    </div>
  );

  if (view === 'results' && run) {
    const s = summarizeRun(runQs, answered);
    return (
      <div className="card">
        <h2>{s.correct} of {s.total} correct</h2>
        <ul>{s.bySystem.map((r) => (
          <li key={r.system}>
            {r.system}: {r.accuracy === null ? 'not answered' : `${r.correct} of ${r.answered} correct (${pct(r.accuracy)})`}
            {r.lowConfidence && ' · low confidence'}
          </li>
        ))}</ul>
        <button onClick={start}>Start another diagnostic</button>
      </div>
    );
  }

  if (run) return (
    <div className="card">
      {progress}
      <button onClick={() => {
        // Every answer saved but the completion call never landed (closed tab): finish it now.
        if (!current) { complete(run); setRun({ ...run, status: 'completed' }); setView('results'); return; }
        setSitting([]); setShowPt(false); shownAt.current = Date.now(); setView('question');
      }}>Resume</button>{' '}
      <button onClick={startOver}>Start over</button>
    </div>
  );

  return (
    <div className="card">
      <p>The diagnostic samples about 100 questions across systems to find where you stand. Answer in short sittings: pause any time and resume later. Explanations appear when you pause or finish.</p>
      {data.questions.length ? <button onClick={start}>Start diagnostic</button> : <p>No questions yet.</p>}
    </div>
  );
}
