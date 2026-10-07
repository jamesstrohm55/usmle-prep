import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQuestions, saveAttempts, setItemStatus, type AttemptInsert } from '../../db/queries';
import type { Question } from '../../db/models';
import { gradeAnswer, canShowExplanation, timedLimitMs, pickBlock, type Answer, type Mode } from '../../engine/mcq';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';
import { ItemImage } from '../../ui/ItemImage';

// crypto.randomUUID is missing on non-secure origins (http://LAN-IP); fall back to getRandomValues.
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Everything a save needs, captured at finish time so a late Retry never reads another session's state.
type Pending = { rows: AttemptInsert[]; done: boolean; inFlight: boolean };

const BLOCK = 40;

// Total = session length: unanswered (e.g. timer expiry) count as missed.
export function sessionSummary(session: Question[], answers: Answer[]) {
  const correctIds = new Set(answers.filter((a) => a.correct).map((a) => a.questionId));
  const total = session.length;
  const correct = session.filter((q) => correctIds.has(q.id)).length;
  return { total, correct, pct: total ? Math.round((correct / total) * 100) : 0, missed: session.filter((q) => !correctIds.has(q.id)) };
}

export function Questions({ load = fetchQuestions, save = saveAttempts }: { load?: typeof fetchQuestions; save?: typeof saveAttempts }) {
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

  const refresh = useCallback(() => {
    setLoadError(null);
    load().then(setBank).catch((e) => setLoadError(e.message));
  }, [load]);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (mode !== 'timed' || finished) return;
    const t = setInterval(() => { tick((n) => n + 1); if (Date.now() > deadlineRef.current) finish(); }, 1000);
    return () => clearInterval(t);
  }, [mode, finished]);

  function start(m: Mode, pool: Question[]) {
    if (!pool.length) return;
    modeRef.current = m; answersRef.current = []; finishedRef.current = false;
    deadlineRef.current = Date.now() + timedLimitMs(pool.length);
    setMode(m); setSession(pool); setIdx(0); setAnswers([]); setFinished(false); setShowPt(false);
    sessionId.current = uuid(); shownAt.current = Date.now();
  }

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function persist(p: Pending) {
    if (!alive.current || p.done || p.inFlight) return;
    p.inFlight = true;
    try { await save(p.rows); p.done = true; } catch (e) { toast.show(`Could not save results: ${(e as Error).message}`, () => persist(p)); } finally { p.inFlight = false; }
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
    if (!answersRef.current.length) return;
    const mode = modeRef.current!, session_id = sessionId.current;
    persist({
      rows: answersRef.current.map((a) => ({ question_id: a.questionId, chosen: a.chosen, correct: a.correct, duration_ms: a.durationMs, mode, session_id })),
      done: false, inFlight: false,
    });
  }

  if (loadError) return <p>Could not load questions: {loadError} <button onClick={refresh}>Retry</button></p>;
  if (!bank) return <p>Loading…</p>;
  if (!bank.length) return <p>No questions yet.</p>;

  const blockSize = Math.min(BLOCK, bank.length);
  if (!mode) return (
    <div className="card">
      <p>{bank.length} questions available.</p>
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
      </div>
    );
  }

  const q = session[idx];
  const answered = answers.find((a) => a.questionId === q.id);
  const last = idx === session.length - 1;
  const remaining = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));

  function choose(i: number) {
    if (finishedRef.current || answersRef.current.some((a) => a.questionId === q.id)) return;
    answersRef.current = [...answersRef.current, gradeAnswer(q, i, Date.now() - shownAt.current)];
    setAnswers(answersRef.current);
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
