import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAttempts, fetchCards, fetchCardStates, fetchNotes, fetchQuestions, fetchReviews, fetchRuns, fetchSettings, saveSettings,
  type Settings as StudySettings,
} from '../../db/queries';
import { useToast } from '../../ui/Toast';
import { Settings } from './Settings';
import {
  buildPlan, daysLeft, DEFAULT_SEC_PER_CARD, DEFAULT_SEC_PER_QUESTION, lastStudyBySystem, latestPerQuestion, masteryBySystem,
  medianSeconds, minutesDoneThisWeek, pickNote, rankSystems, todayMinutes, type Task,
} from '../../engine/planner';
import { doneToday, parseSnapshot } from '../../engine/progress';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function loadToday() {
  const [questions, cards, states, notes, attempts, reviews, settings, runs] = await Promise.all([
    fetchQuestions(), fetchCards(), fetchCardStates(), fetchNotes(), fetchAttempts(), fetchReviews(), fetchSettings(),
    fetchRuns().catch(() => null),
  ]);
  return { questions, cards, states, notes, attempts, reviews, settings, hasCompletedRun: runs ? runs.some((r) => r.status === 'completed') : null };
}
export type TodayData = Awaited<ReturnType<typeof loadToday>>;

const readKey = (key: string): string => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
// Storage may be unavailable: the value then lasts for this visit only.
const writeKey = (key: string, v: string) => {
  try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* visit only */ }
};
// Empty, non-numeric or negative input means "use the weekday default".
const parseOverride = (v: string): number | null => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.min(600, n) : null; };
const lastDurations = (rows: { duration_ms: number }[]) => rows.slice(-200).map((r) => r.duration_ms);

function daysLeftText(n: number | null) {
  if (n === null) return 'Set a target date in Plan settings to see your countdown.';
  if (n < 0) return 'Your target date passed. Set a new one in Plan settings.';
  return n === 1 ? '1 day left' : `${n} days left`;
}

export function Today({ load = loadToday, save = saveSettings, now = () => new Date() }: {
  load?: () => Promise<TodayData>; save?: (s: StudySettings) => Promise<void>; now?: () => Date;
}) {
  const toast = useToast();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now; // an inline `now` must not retrigger the plan memo
  const today = dayKey(now());
  const [stored, setStored] = useState<{ day: string; v: string } | null>(null);
  // Override belongs to a day: after midnight, read the new day's value instead of reusing yesterday's.
  const override = stored && stored.day === today ? stored.v : readKey(`today-minutes:${today}`);
  const [noteRead, setNoteRead] = useState<Record<string, boolean>>({});
  const [rebuilds, setRebuilds] = useState(0);
  const alive = useRef(true);
  const loadRef = useRef(load);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(() => {
    setError(null);
    loadRef.current().then((d) => { if (alive.current) setData(d); }).catch((e) => { if (alive.current) setError(e.message); });
  }, []);
  useEffect(refresh, [refresh]);

  const view = useMemo(() => {
    if (!data) return null;
    const at = nowRef.current();
    const { questions, cards, states, attempts, reviews, settings } = data;
    const latest = latestPerQuestion(attempts);
    const available: Record<string, number> = {};
    for (const q of questions) available[q.system] = (available[q.system] ?? 0) + 1;
    const mastery = masteryBySystem(questions, latest);
    const qSystem = new Map(questions.map((q) => [q.id, q.system]));
    const last = lastStudyBySystem(qSystem, new Map(cards.map((c) => [c.id, c.system])), attempts, reviews);
    const ranked = rankSystems(Object.keys(available), mastery, last, at.getTime()).map((r) => r.system);
    const dueCards = cards.filter((c) => { const s = states.get(c.id); return s && new Date(s.due) <= at; }).length;
    const minutes = todayMinutes(settings.minutes_by_weekday, at, parseOverride(override));
    // The plan is fixed for the day so finished tasks stay listed; it is rebuilt only when today's minutes change or on request.
    const planKey = `plan:${today}`;
    let tasks = parseSnapshot(readKey(planKey), minutes)?.tasks;
    if (!tasks) {
      tasks = buildPlan({
        minutes, dueCards, ranked, available,
        secPerCard: medianSeconds(lastDurations(reviews), DEFAULT_SEC_PER_CARD),
        secPerQuestion: medianSeconds(lastDurations(attempts), DEFAULT_SEC_PER_QUESTION),
      });
      if (tasks.length) writeKey(planKey, JSON.stringify({ minutes, tasks }));
    }
    return {
      minutes, tasks, latest, progress: doneToday(attempts, reviews, qSystem, at),
      left: daysLeft(settings.target_date, at),
      done: minutesDoneThisWeek(attempts, reviews, at),
      planned: settings.minutes_by_weekday.reduce((a, b) => a + b, 0),
    };
  }, [data, override, today, rebuilds]);

  if (error) return <p role="alert">Could not load your plan: {error} <button onClick={refresh}>Retry</button></p>;
  if (!data || !view) return <p role="status">Loading…</p>;

  const onOverride = (v: string) => { setStored({ day: today, v }); writeKey(`today-minutes:${today}`, v); };
  const onRebuild = () => { writeKey(`plan:${today}`, ''); setRebuilds((n) => n + 1); };
  const noteKey = (system: string) => `note-done:${today}:${system}`;
  const isRead = (system: string) => noteRead[noteKey(system)] ?? readKey(noteKey(system)) === '1';
  const setRead = (system: string, read: boolean) => {
    setNoteRead((r) => ({ ...r, [noteKey(system)]: read }));
    writeKey(noteKey(system), read ? '1' : '');
  };
  const progressOf = (t: Task) =>
    t.kind === 'cards' ? view.progress.cards : t.kind === 'questions' ? view.progress.questions[t.system] ?? 0 : null;
  const isDone = (t: Task) => (t.kind === 'note' ? isRead(t.system) : progressOf(t)! >= t.count);
  const allDone = view.tasks.length > 0 && view.tasks.every(isDone);
  const overMax = (parseOverride(override) ?? 0) < Number(override);
  async function onSave(s: StudySettings) {
    await save(s);
    setData((d) => (d ? { ...d, settings: s } : d));
    toast.show('Saved');
  }
  const renderTask = (t: Task) => {
    const mins = `(~${Math.round(t.minutes)} min)`;
    if (t.kind === 'cards') return <><Link to="/cards">Review {t.count} flashcards</Link> {mins} <b>{progressOf(t)}/{t.count}</b></>;
    if (t.kind === 'note') {
      const n = pickNote(data.notes, data.questions, view.latest, t.system);
      return <>Read <Link to="/notes">{n ? n.title : `a note in ${t.system}`}</Link> {mins}{' '}
        <label><input type="checkbox" checked={isRead(t.system)} onChange={(e) => setRead(t.system, e.target.checked)} /> Mark read</label></>;
    }
    return <><Link to={`/questions?system=${encodeURIComponent(t.system)}&n=${t.count}`}>Answer {t.count} {t.system} questions</Link> {mins} <b>{progressOf(t)}/{t.count}</b></>;
  };

  return (
    <div>
      <div className="card">
        <p>{daysLeftText(view.left)}</p>
        {data.hasCompletedRun === false && <p><Link to="/diagnostic">Take the diagnostic</Link> to calibrate your plan.</p>}
        <label>Minutes today <input type="number" min={0} max={600} value={override} placeholder={String(view.minutes)}
          onChange={(e) => onOverride(e.target.value)} /></label>
        {overMax && <p role="status">Maximum is 600 minutes, using 600.</p>}
        {view.minutes <= 0 ? <p>No study time set for today.</p> : !view.tasks.length ? <p>Nothing to do today.</p> : (<>
          <ol>{view.tasks.map((t, i) => {
            const done = isDone(t);
            return <li key={i} className={done ? 'done' : ''}>{done && <span role="img" aria-label="done">✓ </span>}{renderTask(t)}</li>;
          })}</ol>
          {allDone && <p>All done for today.</p>}
          <button onClick={onRebuild}>Rebuild plan</button>
        </>)}
        <p>{view.done} of {view.planned} min this week</p>
        <progress aria-label="Minutes this week" max={view.planned || 1} value={Math.min(view.done, view.planned)} />
      </div>
      <details><summary>Plan settings</summary><Settings value={data.settings} onSave={onSave} /></details>
    </div>
  );
}
