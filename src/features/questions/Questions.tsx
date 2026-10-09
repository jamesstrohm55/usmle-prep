import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAttempts, fetchQuestions, saveAttempts, setItemStatus, type AttemptInsert } from '../../db/queries';
import type { Question } from '../../db/models';
import { gradeAnswer, canShowExplanation, timedLimitMs, pickBlock, type Answer, type Mode } from '../../engine/mcq';
import { latestPerQuestion, selectForTask } from '../../engine/planner';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';
import { ItemImage } from '../../ui/ItemImage';
import { uuid } from '../../ui/uuid';
import { systemLabel } from '../../ui/systemLabel';
import { Loading } from '../../ui/Loading';
import { useT } from '../../ui/lang';
import { errMsg } from '../../ui/errMsg';

// One answer's row, built once when answered so a Retry re-sends it unchanged and never reads another session's state.
// rejected = the server refused this row for good (integrity error): it is never re-sent and offers no Retry.
type Pending = { row: AttemptInsert; n: number; done: boolean; inFlight: Promise<void> | null; rejected?: string };

const BLOCK = 40;

// Total = session length: unanswered (e.g. timer expiry) count as missed.
export function sessionSummary(session: Question[], answers: Answer[]) {
  const correctIds = new Set(answers.filter((a) => a.correct).map((a) => a.questionId));
  const total = session.length;
  const correct = session.filter((q) => correctIds.has(q.id)).length;
  return { total, correct, pct: total ? Math.round((correct / total) * 100) : 0, missed: session.filter((q) => !correctIds.has(q.id)) };
}

export function Questions({ load = fetchQuestions, save = saveAttempts, preset, loadAttempts = fetchAttempts }: {
  load?: typeof fetchQuestions; save?: typeof saveAttempts;
  preset?: { system: string; n: number; done?: number; practice?: boolean }; loadAttempts?: typeof fetchAttempts;
}) {
  const toast = useToast();
  const tr = useT();
  const [bank, setBank] = useState<Question[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [session, setSession] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [finished, setFinished] = useState(false);
  const [showPt, setShowPt] = useState(false);
  const [, tick] = useState(0);
  const shownAt = useRef(Date.now());
  const sessionId = useRef('');
  // Refs mirror state so two same-tick events can't act on stale values.
  const answersRef = useRef<Answer[]>([]);
  const finishedRef = useRef(false);
  const deadlineRef = useRef(0);
  const modeRef = useRef<Mode | null>(null);
  const stemRef = useRef<HTMLParagraphElement>(null);
  const pendingRef = useRef<Pending[]>([]); // this session's answer rows; start() swaps in a fresh array
  // Once used, the planned button's Resume numbers are stale for this visit, so it is hidden.
  const [plannedUsed, setPlannedUsed] = useState(false);

  const refresh = useCallback(() => {
    setLoadError(null);
    load().then(setBank).catch((e) => setLoadError(errMsg(e)));
  }, [load]);
  useEffect(refresh, [refresh]);

  // Planned set: history only picks which questions; a failed load just treats all as unseen.
  const [latest, setLatest] = useState<ReturnType<typeof latestPerQuestion>>(new Map());
  const hasPreset = !!preset;
  const [ready, setReady] = useState(!preset);
  useEffect(() => {
    if (!hasPreset) return;
    let live = true;
    loadAttempts()
      .then((a) => { if (live) { setLatest(latestPerQuestion(a)); setReady(true); } })
      .catch(() => { if (live) { setLatest(new Map()); setReady(true); } });
    return () => { live = false; };
  }, [hasPreset, loadAttempts]);

  useEffect(() => {
    if (mode !== 'timed' || finished) return;
    const t = setInterval(() => { tick((n) => n + 1); if (Date.now() > deadlineRef.current) finish(); }, 1000);
    return () => clearInterval(t);
  }, [mode, finished]);

  function start(m: Mode, pool: Question[]) {
    if (!pool.length) return;
    modeRef.current = m; answersRef.current = []; finishedRef.current = false; pendingRef.current = [];
    deadlineRef.current = Date.now() + timedLimitMs(pool.length);
    setMode(m); setSession(pool); setIdx(0); setAnswers([]); setFinished(false); setShowPt(false);
    sessionId.current = uuid(); shownAt.current = Date.now();
  }

  // Move focus to the question text whenever a new question is shown (keyboard and screen-reader users).
  const shownIdx = mode && !finished ? idx : -1;
  useEffect(() => { if (shownIdx >= 0) stemRef.current?.focus(); }, [shownIdx, session]);

  const alive = useRef(true);
  // Unmount dismisses the toast: its Retry could no longer send (see send), so it must not linger.
  const { dismiss } = toast;
  useEffect(() => { alive.current = true; return () => { alive.current = false; dismiss(); }; }, [dismiss]);

  // Inserts the rows of ps not yet saved or in flight, in one call. Touches no component state, so a
  // Retry for an old session cannot reach the current one. Nothing new is sent or offered after unmount:
  // a user switch remounts this screen, and a late Retry would write under the new user.
  // retryPs is what a failure's Retry re-sends (the outer list, also from the 23505 fallback).
  function send(ps: Pending[], failMsg: string, retryPs = ps): Promise<void> {
    if (!alive.current) return Promise.resolve();
    const todo = ps.filter((p) => !p.done && !p.inFlight && !p.rejected);
    if (!todo.length) return Promise.resolve();
    const run = save(todo.map((p) => p.row)).then(() => ({ ok: true as const }), (e: unknown) => ({ ok: false as const, e })).then((r): Promise<unknown> | void => {
      todo.forEach((p) => { p.inFlight = null; });
      if (r.ok) { todo.forEach((p) => { p.done = true; }); return; }
      const err = r.e as { code?: string; message?: string } | null | undefined;
      // A multi-row insert is all-or-nothing. An integrity or data rejection (SQLSTATE class 23 or 22: 23505 duplicate,
      // 23503 deleted question, ...) may be one bad row, so retry one row at a time and let the good rows land.
      // Other errors (network, auth/RLS, 5xx) would fail every row alike: per-row sends only multiply requests.
      const integrity = !!err?.code && /^2[23]/.test(err.code); // 22 data exception (e.g. out-of-range duration) is also one bad row
      if (integrity && todo.length > 1) return Promise.all(todo.map((p) => send([p], failMsg, retryPs)));
      // 23505 = unique (session_id, question_id): an earlier insert committed but its response was lost.
      if (err?.code === '23505') { todo[0].done = true; return; }
      const msg = err?.message || (err ? String(err) : 'unknown error');
      if (integrity) {
        todo[0].rejected = msg;
        if (!alive.current) return;
        // The toast holds one message, so keep a Retry for any other row that still can be saved.
        const others = retryPs.some((r) => !r.done && !r.rejected && !r.inFlight);
        // The number only means something in the session on screen (a row from an earlier session is unnamed).
        const where = todo[0].row.session_id === sessionId.current ? ` (Q${todo[0].n})` : '';
        toast.show(`${tr(failMsg)}: ${msg}${where}`, others ? () => send(retryPs, failMsg) : undefined);
        return;
      }
      if (alive.current) toast.show(`${tr(failMsg)}: ${msg}`, () => send(retryPs, failMsg));
    }).then(() => {});
    todo.forEach((p) => { p.inFlight = run; });
    return run;
  }

  function setStatus(id: string, status: 'flagged' | 'verified', ok: string, note?: string) {
    if (!alive.current) return;
    setItemStatus('question', id, status, note).then(() => toast.show(ok)).catch((e) => toast.show(tr('Could not update question: {m}', { m: errMsg(e) }), () => setStatus(id, status, ok, note)));
  }
  function flag(id: string) {
    const note = window.prompt(tr('What is wrong? (optional)'));
    if (note === null) return; // cancelled: do not flag
    setStatus(id, 'flagged', tr('Flagged for review.'), note.trim() || undefined);
  }

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true);
    // Answers were saved as given; once in-flight saves settle, retry only the ones that failed.
    const ps = pendingRef.current;
    const sid = sessionId.current;
    const report = () => {
      // A new session may have begun, and a late Retry may have put rows back in flight: wait, then count.
      if (sessionId.current !== sid) return;
      if (ps.some((p) => p.inFlight)) { Promise.all(ps.map((p) => p.inFlight)).then(report); return; }
      const unsaved = ps.filter((p) => !p.done && !p.rejected).length;
      const rejected = ps.filter((p) => p.rejected);
      // One plain failure keeps its own toast (it names the reason); a summary only adds counts for several or rejected rows.
      if (!alive.current || (!unsaved && !rejected.length) || (unsaved === 1 && !rejected.length)) return;
      const parts = [unsaved && tr('{n} not saved', { n: unsaved }), rejected.length && tr('{n} rejected by the server', { n: rejected.length })].filter(Boolean).join(', ');
      const which = rejected.length ? tr('. Rejected: {list}.', { list: rejected.map((p) => `Q${p.n}`).join(', ') }) : '';
      toast.show(`${tr('Could not save results')}: ${parts} (${tr('of {n}', { n: ps.length })})${which}`, unsaved ? () => send(ps, 'Could not save results').then(report) : undefined);
    };
    Promise.all(ps.map((p) => p.inFlight)).then(() => send(ps, 'Could not save results')).then(report);
  }

  if (loadError) return <p role="alert">{tr('Could not load questions:')} {loadError} <button onClick={refresh}>{tr('Retry')}</button></p>;
  if (!bank) return <Loading />;
  if (!bank.length) return <p>{tr('No questions yet.')}</p>;

  const blockSize = Math.min(BLOCK, bank.length);
  const plannedCount = preset ? Math.min(preset.n, bank.filter((q) => q.system === preset.system).length) : 0;
  const qWord = plannedCount === 1 ? tr('question') : tr('questions');
  const plannedLabel = preset?.practice ? tr('Start practice set ({n} {w} in {s})', { n: plannedCount, w: qWord, s: systemLabel(preset.system, tr) })
    : preset?.done ? tr('Resume planned set ({n} {w} left in {s}, {d} done)', { n: plannedCount, w: qWord, s: systemLabel(preset.system, tr), d: preset.done })
    : tr('Start planned set ({n} {w} in {s})', { n: plannedCount, w: qWord, s: systemLabel(preset?.system ?? '', tr) });
  if (!mode) return (
    <div className="card">
      <h2>{tr('Practice questions')}</h2>
      <p className="muted">{tr('{n} questions available.', { n: bank.length })}</p>
      {preset && plannedCount > 0 && !plannedUsed && <p><button className="primary" disabled={!ready} onClick={() => { const pool = selectForTask(bank, latest, preset.system, preset.n); if (pool.length) setPlannedUsed(true); start('tutor', pool); }}>{plannedLabel}{!ready && ` ${tr('(loading history…)')}`}</button></p>}
      <button onClick={() => start('tutor', pickBlock(bank, BLOCK))}>{tr('Start tutor session ({n} questions)', { n: blockSize })}</button>{' '}
      <button onClick={() => start('timed', pickBlock(bank, BLOCK))}>{tr('Start timed session ({n} questions, {m} min)', { n: blockSize, m: Math.round(timedLimitMs(blockSize) / 60000) })}</button>
    </div>
  );

  if (finished) {
    const s = sessionSummary(session, answers);
    return (
      <div className="card">
        <h2 className="summary-score">{tr('{c} of {t} correct ({p}%)', { c: s.correct, t: s.total, p: s.pct })}</h2>
        {s.missed.length > 0 && <button onClick={() => start('tutor', s.missed)}>{tr('Review {n} missed', { n: s.missed.length })}</button>}{' '}
        <button onClick={() => setMode(null)}>{tr('Done')}</button>
        {preset && <>{' '}<a href="#/today">{tr('Back to Today')}</a></>}
      </div>
    );
  }

  const q = session[idx];
  const answered = answers.find((a) => a.questionId === q.id);
  const last = idx === session.length - 1;
  const remaining = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));

  function choose(i: number) {
    if (finishedRef.current || answersRef.current.some((a) => a.questionId === q.id)) return;
    const a = gradeAnswer(q, i, Date.now() - shownAt.current);
    answersRef.current = [...answersRef.current, a];
    setAnswers(answersRef.current);
    const p: Pending = { n: idx + 1, row: { question_id: a.questionId, chosen: a.chosen, correct: a.correct, duration_ms: a.durationMs, mode: modeRef.current!, session_id: sessionId.current }, done: false, inFlight: null };
    pendingRef.current.push(p);
    send(pendingRef.current, 'Could not save your answer'); // also carries earlier rows whose save failed
  }
  function next() { setIdx((n) => Math.min(n + 1, session.length - 1)); setShowPt(false); shownAt.current = Date.now(); }

  return (
    <div className="card">
      <div className="q-top">
        <small>Q{idx + 1}/{session.length}{mode === 'timed' && ` · ${tr('{time} left', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` })}`}</small>
        <div className="meter" aria-hidden="true"><i style={{ width: `${((idx + (answered ? 1 : 0)) / session.length) * 100}%` }} /></div>
      </div>
      <p className="stem" ref={stemRef} tabIndex={-1}>{q.stem}</p>
      <ItemImage src={q.image_url} credit={q.image_credit} />
      <div className="choices">{q.choices.map((c, i) => (
        <div key={i} className={`choice-row${answered && mode === 'tutor' ? (i === q.correct ? ' correct' : answered.chosen === i ? ' wrong' : '') : ''}`}>
          <button className="choice" onClick={() => choose(i)} disabled={!!answered && mode === 'tutor'} aria-pressed={mode === 'timed' ? answered?.chosen === i : undefined}>{c}</button>
          {answered && mode === 'tutor' && (i === q.correct ? ' ✓' : answered.chosen === i ? ' ✗' : '')}</div>
      ))}</div>
      {answered && canShowExplanation(mode, finished, true) && (
        <>
          <div className="explain">
            <p><Rich text={q.explanation} /></p>
            {q.explanation_pt && showPt && <p className="pt" lang="pt-BR"><Rich text={q.explanation_pt} /></p>}
          </div>
          <div className="q-nav">
            {q.explanation_pt && !showPt && <button onClick={() => setShowPt(true)}>Ver em português</button>}
            <span className="item-actions">
              <button onClick={() => flag(q.id)}>{tr('Flag as wrong')}</button>
              <button onClick={() => setStatus(q.id, 'verified', tr('Marked verified.'))}>{tr('Mark verified')}</button>
            </span>
          </div>
        </>
      )}
      {answered && <p className="q-nav">{last ? <button className="primary" onClick={finish}>{tr('Finish')}</button> : <button className="primary" onClick={next}>{tr('Next')}</button>}</p>}
    </div>
  );
}

// A long day can plan hundreds of questions (600 minutes at 30 s each), so the URL accepts up to this many.
const MAX_SET = 1000;

export function QuestionsRoute() {
  const [p] = useSearchParams();
  const system = p.get('system') ?? '';
  const n = Number(p.get('n'));
  const ok = system && Number.isInteger(n) && n >= 1;
  const d = Number(p.get('done'));
  const done = Number.isInteger(d) && d >= 0 ? Math.min(MAX_SET, d) : 0; // missing/garbled => 0, huge => clamped like n
  return <Questions preset={ok ? { system, n: Math.min(MAX_SET, n), done, practice: p.get('practice') === '1' } : undefined} />;
}
