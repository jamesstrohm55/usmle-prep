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

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function loadToday() {
  const [questions, cards, states, notes, attempts, reviews, settings, runs] = await Promise.all([
    fetchQuestions(), fetchCards(), fetchCardStates(), fetchNotes(), fetchAttempts(), fetchReviews(), fetchSettings(),
    fetchRuns().catch(() => null),
  ]);
  return { questions, cards, states, notes, attempts, reviews, settings, hasCompletedRun: runs ? runs.some((r) => r.status === 'completed') : null };
}
export type TodayData = Awaited<ReturnType<typeof loadToday>>;

const readOverride = (key: string): string => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const writeOverride = (key: string, v: string) => {
  try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* storage unavailable: override lasts for this visit only */ }
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
  const override = stored && stored.day === today ? stored.v : readOverride(`today-minutes:${today}`);
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
    const last = lastStudyBySystem(new Map(questions.map((q) => [q.id, q.system])), new Map(cards.map((c) => [c.id, c.system])), attempts, reviews);
    const ranked = rankSystems(Object.keys(available), mastery, last, at.getTime()).map((r) => r.system);
    const dueCards = cards.filter((c) => { const s = states.get(c.id); return s && new Date(s.due) <= at; }).length;
    const minutes = todayMinutes(settings.minutes_by_weekday, at, parseOverride(override));
    const tasks = buildPlan({
      minutes, dueCards, ranked, available,
      secPerCard: medianSeconds(lastDurations(reviews), DEFAULT_SEC_PER_CARD),
      secPerQuestion: medianSeconds(lastDurations(attempts), DEFAULT_SEC_PER_QUESTION),
    });
    return {
      minutes, tasks, latest,
      left: daysLeft(settings.target_date, at),
      done: minutesDoneThisWeek(attempts, reviews, at),
      planned: settings.minutes_by_weekday.reduce((a, b) => a + b, 0),
    };
  }, [data, override, today]);

  if (error) return <p role="alert">Could not load your plan: {error} <button onClick={refresh}>Retry</button></p>;
  if (!data || !view) return <p role="status">Loading…</p>;

  const onOverride = (v: string) => { setStored({ day: today, v }); writeOverride(`today-minutes:${today}`, v); };
  async function onSave(s: StudySettings) {
    await save(s);
    setData((d) => (d ? { ...d, settings: s } : d));
    toast.show('Saved');
  }
  const renderTask = (t: Task) => {
    const mins = `(~${Math.round(t.minutes)} min)`;
    if (t.kind === 'cards') return <><Link to="/cards">Review {t.count} flashcards</Link> {mins}</>;
    if (t.kind === 'note') {
      const n = pickNote(data.notes, data.questions, view.latest, t.system);
      return <>Read <Link to="/notes">{n ? n.title : `a note in ${t.system}`}</Link> {mins}</>;
    }
    return <><Link to={`/questions?system=${encodeURIComponent(t.system)}&n=${t.count}`}>Answer {t.count} {t.system} questions</Link> {mins}</>;
  };

  return (
    <div>
      <div className="card">
        <p>{daysLeftText(view.left)}</p>
        {data.hasCompletedRun === false && <p><Link to="/diagnostic">Take the diagnostic</Link> to calibrate your plan.</p>}
        <label>Minutes today <input type="number" min={0} max={600} value={override} placeholder={String(view.minutes)}
          onChange={(e) => onOverride(e.target.value)} /></label>
        {view.minutes <= 0 ? <p>No study time set for today.</p> : !view.tasks.length ? <p>Nothing to do today.</p> : (
          <ol>{view.tasks.map((t, i) => <li key={i}>{renderTask(t)}</li>)}</ol>
        )}
        <p>{view.done} of {view.planned} min this week</p>
        <progress aria-label="Minutes this week" max={view.planned || 1} value={Math.min(view.done, view.planned)} />
      </div>
      <details><summary>Plan settings</summary><Settings value={data.settings} onSave={onSave} /></details>
    </div>
  );
}
