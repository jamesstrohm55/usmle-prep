import { useEffect, useRef, useState } from 'react';
import { fetchQuestions, saveAttempts, setItemStatus, type AttemptInsert } from '../../db/queries';
import type { Question } from '../../db/models';
import { gradeAnswer, canShowExplanation, timedLimitMs, type Answer, type Mode } from '../../engine/mcq';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';

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
  const [mode, setMode] = useState<Mode | null>(null);
  const [session, setSession] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [finished, setFinished] = useState(false);
  const [showPt, setShowPt] = useState(false);
  const [, tick] = useState(0);
  const shownAt = useRef(Date.now());
  const sessionId = useRef(crypto.randomUUID());
  // Refs mirror state so two same-tick events can't act on stale values.
  const answersRef = useRef<Answer[]>([]);
  const finishedRef = useRef(false);
  const persistedRef = useRef(false);
  const deadlineRef = useRef(0);
  const modeRef = useRef<Mode | null>(null);

  useEffect(() => { load().then(setBank).catch((e) => toast.show(`Could not load questions: ${e.message}`)); }, [load]);

  useEffect(() => {
    if (mode !== 'timed' || finished) return;
    const t = setInterval(() => { tick((n) => n + 1); if (Date.now() > deadlineRef.current) finish(); }, 1000);
    return () => clearInterval(t);
  }, [mode, finished]);

  function start(m: Mode, pool: Question[]) {
    if (!pool.length) return;
    modeRef.current = m; answersRef.current = []; finishedRef.current = false; persistedRef.current = false;
    deadlineRef.current = Date.now() + timedLimitMs(pool.length);
    setMode(m); setSession(pool); setIdx(0); setAnswers([]); setFinished(false); setShowPt(false);
    sessionId.current = crypto.randomUUID(); shownAt.current = Date.now();
  }

  async function persist(final: Answer[]) {
    if (persistedRef.current || !final.length) return;
    const rows: AttemptInsert[] = final.map((a) => ({
      question_id: a.questionId, chosen: a.chosen, correct: a.correct, duration_ms: a.durationMs, mode: modeRef.current!, session_id: sessionId.current,
    }));
    try { await save(rows); persistedRef.current = true; } catch (e) { toast.show(`Could not save results: ${(e as Error).message}`, () => persist(final)); }
  }

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true); persist(answersRef.current);
  }

  if (!bank) return <p>Loading…</p>;
  if (!bank.length) return <p>No questions yet.</p>;

  if (!mode) return (
    <div className="card">
      <p>{bank.length} questions available.</p>
      <button onClick={() => start('tutor', bank)}>Start tutor session</button>{' '}
      <button onClick={() => start('timed', bank)}>Start timed session</button>
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
      {q.image_url && <figure><img src={q.image_url} alt="" style={{ maxWidth: '100%' }} /><figcaption>{q.image_credit}</figcaption></figure>}
      {q.choices.map((c, i) => (
        <div key={i}><button onClick={() => choose(i)} disabled={!!answered && mode === 'tutor'}>{c}</button>
          {answered && mode === 'tutor' && (i === q.correct ? ' ✓' : answered.chosen === i ? ' ✗' : '')}</div>
      ))}
      {answered && canShowExplanation(mode, finished, true) && (
        <>
          <p><Rich text={q.explanation} /></p>
          {q.explanation_pt && (showPt ? <p lang="pt-BR"><Rich text={q.explanation_pt} /></p> : <button onClick={() => setShowPt(true)}>Ver em português</button>)}
          <p>
            <button onClick={() => setItemStatus('question', q.id, 'flagged').then(() => toast.show('Flagged for review.'))}>Flag as wrong</button>{' '}
            <button onClick={() => setItemStatus('question', q.id, 'verified').then(() => toast.show('Marked verified.'))}>Mark verified</button>
          </p>
        </>
      )}
      {answered && (last ? <button onClick={finish}>Finish</button> : <button onClick={next}>Next</button>)}
    </div>
  );
}
