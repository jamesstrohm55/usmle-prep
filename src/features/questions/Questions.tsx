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

// One answer's row, built once when answered so a Retry re-sends it unchanged and never reads another session's state.
type Pending = { row: AttemptInsert; done: boolean; inFlight: Promise<void> | null };

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
  const pendingRef = useRef<Pending[]>([]); // this session's answer rows; start() swaps in a fresh array
  const plannedRef = useRef(false); // current session came from the planned-set button
  // Once used, the planned button's Resume numbers are stale for this visit, so it is hidden.
  const [plannedUsed, setPlannedUsed] = useState(false);

  const refresh = useCallback(() => {
    setLoadError(null);
    load().then(setBank).catch((e) => setLoadError(e.message));
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

  function start(m: Mode, pool: Question[], planned = false) {
    if (!pool.length) return;
    plannedRef.current = planned;
    if (planned) setPlannedUsed(true);
    modeRef.current = m; answersRef.current = []; finishedRef.current = false; pendingRef.current = [];
    deadlineRef.current = Date.now() + timedLimitMs(pool.length);
    setMode(m); setSession(pool); setIdx(0); setAnswers([]); setFinished(false); setShowPt(false);
    sessionId.current = uuid(); shownAt.current = Date.now();
  }

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
    const todo = ps.filter((p) => !p.done && !p.inFlight);
    if (!todo.length) return Promise.resolve();
    const run = save(todo.map((p) => p.row)).then(() => ({ ok: true as const }), (e: unknown) => ({ ok: false as const, e })).then((r): Promise<unknown> | void => {
      todo.forEach((p) => { p.inFlight = null; });
      if (r.ok) { todo.forEach((p) => { p.done = true; }); return; }
      const err = r.e as { code?: string; message?: string } | null | undefined;
      // A multi-row insert is all-or-nothing. A server rejection (any error code: 23505 duplicate, 23503
      // deleted question, ...) may be one bad row, so retry one row at a time and let the good rows land.
      // Codeless network errors keep the batch: per-row sends while offline only multiply failures.
      if (err?.code && todo.length > 1) return Promise.all(todo.map((p) => send([p], failMsg, retryPs)));
      // 23505 = unique (session_id, question_id): an earlier insert committed but its response was lost.
      if (err?.code === '23505') { todo[0].done = true; return; }
      const msg = err?.message || (err ? String(err) : 'unknown error');
      if (alive.current) toast.show(`${failMsg}: ${msg}`, () => send(retryPs, failMsg));
    }).then(() => {});
    todo.forEach((p) => { p.inFlight = run; });
    return run;
  }

  function setStatus(id: string, status: 'flagged' | 'verified', ok: string, note?: string) {
    if (!alive.current) return;
    setItemStatus('question', id, status, note).then(() => toast.show(ok)).catch((e) => toast.show(`Could not update question: ${(e as Error).message}`, () => setStatus(id, status, ok, note)));
  }
  function flag(id: string) {
    const note = window.prompt('What is wrong? (optional)');
    if (note === null) return; // cancelled: do not flag
    setStatus(id, 'flagged', 'Flagged for review.', note.trim() || undefined);
  }

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true);
    // Answers were saved as given; once in-flight saves settle, retry only the ones that failed.
    const ps = pendingRef.current;
    const planned = plannedRef.current;
    Promise.all(ps.map((p) => p.inFlight)).then(() => send(ps, 'Could not save results')).then(() => { if (planned) reloadHistory(); });
  }

  // After a planned set, re-read history so it reflects the answers just saved; a failure keeps the old one.
  function reloadHistory() {
    if (!alive.current) return;
    setReady(false);
    loadAttempts()
      .then((a) => { if (alive.current) setLatest(latestPerQuestion(a)); }, () => {})
      .finally(() => { if (alive.current) setReady(true); });
  }

  if (loadError) return <p>Could not load questions: {loadError} <button onClick={refresh}>Retry</button></p>;
  if (!bank) return <p>Loading…</p>;
  if (!bank.length) return <p>No questions yet.</p>;

  const blockSize = Math.min(BLOCK, bank.length);
  const plannedCount = preset ? Math.min(preset.n, bank.filter((q) => q.system === preset.system).length) : 0;
  const qWord = plannedCount === 1 ? 'question' : 'questions';
  const plannedLabel = preset?.practice ? `Start practice set (${plannedCount} ${qWord} in ${preset.system})`
    : preset?.done ? `Resume planned set (${plannedCount} ${qWord} left in ${preset.system}, ${preset.done} done)`
    : `Start planned set (${plannedCount} ${qWord} in ${preset?.system})`;
  if (!mode) return (
    <div className="card">
      <p>{bank.length} questions available.</p>
      {preset && plannedCount > 0 && !plannedUsed && <p><button disabled={!ready} onClick={() => start('tutor', selectForTask(bank, latest, preset.system, preset.n), true)}>{plannedLabel}{!ready && ' (loading history…)'}</button></p>}
      <button onClick={() => start('tutor', pickBlock(bank, BLOCK))}>Start tutor session ({blockSize} questions)</button>{' '}
      <button onClick={() => start('timed', pickBlock(bank, BLOCK))}>Start timed session ({blockSize} questions, {Math.round(timedLimitMs(blockSize) / 60000)} min)</button>
    </div>
  );

  if (finished) {
    const s = sessionSummary(session, answers);
    return (
      <div className="card">
        <h2>{s.correct} of {s.total} correct ({s.pct}%)</h2>
        {s.missed.length > 0 && <button onClick={() => start('tutor', s.missed)}>Review {s.missed.length} missed</button>}{' '}
        <button onClick={() => setMode(null)}>Done</button>
        {preset && <>{' '}<a href="#/today">Back to Today</a></>}
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
    const p: Pending = { row: { question_id: a.questionId, chosen: a.chosen, correct: a.correct, duration_ms: a.durationMs, mode: modeRef.current!, session_id: sessionId.current }, done: false, inFlight: null };
    pendingRef.current.push(p);
    send(pendingRef.current, 'Could not save your answer'); // also carries earlier rows whose save failed
  }
  function next() { setIdx((n) => Math.min(n + 1, session.length - 1)); setShowPt(false); shownAt.current = Date.now(); }

  return (
    <div className="card">
      <p><small>Q{idx + 1}/{session.length}{mode === 'timed' && ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`}</small></p>
      <p>{q.stem}</p>
      <ItemImage src={q.image_url} credit={q.image_credit} />
      {q.choices.map((c, i) => (
        <div key={i}><button onClick={() => choose(i)} disabled={!!answered && mode === 'tutor'} aria-pressed={mode === 'timed' ? answered?.chosen === i : undefined}
          style={mode === 'timed' && answered?.chosen === i ? { fontWeight: 'bold', outline: '2px solid currentColor' } : undefined}>{c}</button>
          {answered && mode === 'tutor' && (i === q.correct ? ' ✓' : answered.chosen === i ? ' ✗' : '')}</div>
      ))}
      {answered && canShowExplanation(mode, finished, true) && (
        <>
          <p><Rich text={q.explanation} /></p>
          {q.explanation_pt && (showPt ? <p lang="pt-BR"><Rich text={q.explanation_pt} /></p> : <button onClick={() => setShowPt(true)}>Ver em português</button>)}
          <p>
            <button onClick={() => flag(q.id)}>Flag as wrong</button>{' '}
            <button onClick={() => setStatus(q.id, 'verified', 'Marked verified.')}>Mark verified</button>
          </p>
        </>
      )}
      {answered && (last ? <button onClick={finish}>Finish</button> : <button onClick={next}>Next</button>)}
    </div>
  );
}

export function QuestionsRoute() {
  const [p] = useSearchParams();
  const system = p.get('system') ?? '';
  const n = Number(p.get('n'));
  const ok = system && Number.isInteger(n) && n >= 1;
  const d = Number(p.get('done'));
  const done = Number.isInteger(d) && d >= 0 && d <= 100 ? d : 0; // missing/garbled => 0
  return <Questions preset={ok ? { system, n: Math.min(100, n), done, practice: p.get('practice') === '1' } : undefined} />;
}
