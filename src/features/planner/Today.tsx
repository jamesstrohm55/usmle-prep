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
  medianSeconds, minutesByDayThisWeek, minutesDoneThisWeek, pickNote, rankSystems, todayMinutes, weekdayIndex, type Task,
} from '../../engine/planner';
import { systemLabel } from '../../ui/systemLabel';
import { doneToday, parseSnapshot, type Snapshot } from '../../engine/progress';
import { getLastUserId } from '../../db/lastUser';

// Stagger index for the tiles' blur-fade entrance (see .tile in styles.css).
const at = (i: number) => ({ '--i': i }) as React.CSSProperties;

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
const storedRun = (raw: string): boolean => { try { return JSON.parse(raw)?.hasCompletedRun === true; } catch { return false; } };
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
  const user = getLastUserId() ?? 'anon'; // browser-stored day state is per signed-in user
  const [stored, setStored] = useState<{ day: string; v: string } | null>(null);
  // Override belongs to a day: after midnight, read the new day's value instead of reusing yesterday's.
  const overrideKey = `${user}:today-minutes:${today}`;
  const override = stored && stored.day === overrideKey ? stored.v : readKey(overrideKey);
  const [noteRead, setNoteRead] = useState<Record<string, boolean>>({});
  const [rebuilds, setRebuilds] = useState(0);
  const handledRebuilds = useRef(0);
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
    // Progress counts distinct items reviewed/answered since the plan was made (`since`), so a mid-day rebuild starts at 0.
    const planKey = `${user}:plan:${today}`;
    // null = runs failed to load (offline): accept the stored plan and never overwrite its stored run state.
    const run = data.hasCompletedRun;
    const raw = readKey(planKey);
    // After Rebuild, ignore the stored plan; it is overwritten (or removed when the new plan is empty).
    const forced = rebuilds !== handledRebuilds.current;
    handledRebuilds.current = rebuilds;
    let plan: Snapshot | null = forced ? null : parseSnapshot(raw, minutes, run);
    if (!plan) {
      const tasks = buildPlan({
        minutes, dueCards, ranked, available,
        secPerCard: medianSeconds(lastDurations(reviews), DEFAULT_SEC_PER_CARD),
        secPerQuestion: medianSeconds(lastDurations(attempts), DEFAULT_SEC_PER_QUESTION),
      });
      plan = { minutes, tasks, since: at.getTime(), hasCompletedRun: run ?? storedRun(raw) };
      if (tasks.length) writeKey(planKey, JSON.stringify(plan));
      else if (forced) writeKey(planKey, ''); // an empty rebuilt plan must not let the old one come back
    }
    return {
      minutes, tasks: plan.tasks, latest, progress: doneToday(attempts, reviews, qSystem, at, plan.since),
      left: daysLeft(settings.target_date, at),
      done: minutesDoneThisWeek(attempts, reviews, at),
      byDay: minutesByDayThisWeek(attempts, reviews, at), byWeekday: settings.minutes_by_weekday, dayIdx: weekdayIndex(at), mastery,
      planned: settings.minutes_by_weekday.reduce((a, b) => a + b, 0),
    };
  }, [data, override, today, user, rebuilds]);

  if (error) return <p role="alert">Could not load your plan: {error} <button onClick={refresh}>Retry</button></p>;
  if (!data || !view) return <p role="status">Loading…</p>;

  const onOverride = (v: string) => { setStored({ day: overrideKey, v }); writeKey(overrideKey, v); };
  const onRebuild = () => setRebuilds((n) => n + 1);
  const noteKey = (system: string) => `${user}:note-done:${today}:${system}`;
  const isRead = (system: string) => noteRead[noteKey(system)] ?? readKey(noteKey(system)) === '1';
  const setRead = (system: string, read: boolean) => {
    setNoteRead((r) => ({ ...r, [noteKey(system)]: read }));
    writeKey(noteKey(system), read ? '1' : '');
  };
  // Progress shown and judged against the planned count, never above it.
  const progressOf = (t: Exclude<Task, { kind: 'note' }>) =>
    Math.min(t.count, t.kind === 'cards' ? view.progress.cards : view.progress.questions[t.system] ?? 0);
  const isDone = (t: Task) => (t.kind === 'note' ? isRead(t.system) : progressOf(t) >= t.count);
  const progressText = (t: Exclude<Task, { kind: 'note' }>) => <>
    <b className="task-count" aria-hidden="true">{progressOf(t)}/{t.count}</b><span className="sr-only">{progressOf(t)} of {t.count} done</span></>;
  const allDone = view.tasks.length > 0 && view.tasks.every(isDone);
  const overMax = (parseOverride(override) ?? 0) < Number(override);
  async function onSave(s: StudySettings) {
    await save(s);
    setData((d) => (d ? { ...d, settings: s } : d));
    toast.show('Saved');
  }
  const renderTask = (t: Task) => {
    const mins = <span className="meta">(~{Math.round(t.minutes)} min)</span>;
    if (t.kind === 'cards') return <><div className="task-main"><Link to="/cards">Review {t.count} flashcards</Link> {mins}</div>{progressText(t)}</>;
    if (t.kind === 'note') {
      const n = pickNote(data.notes, data.questions, view.latest, t.system);
      return <div className="task-main"><span>Read <Link to="/notes">{n ? n.title : `a note in ${systemLabel(t.system)}`}</Link></span>
        <span className="meta">{mins}{' '}<label><input type="checkbox" checked={isRead(t.system)} onChange={(e) => setRead(t.system, e.target.checked)} /> Mark read</label></span></div>;
    }
    // Link and text reflect the remaining work; a finished task offers extra practice instead.
    const done = progressOf(t), left = t.count - done, base = `/questions?system=${encodeURIComponent(t.system)}`;
    const [to, text] = done >= t.count ? [`${base}&n=${t.count}&practice=1`, `Practice ${t.count} more ${systemLabel(t.system)} questions`]
      : done > 0 ? [`${base}&n=${left}&done=${done}`, `Answer ${left} more ${systemLabel(t.system)} questions`]
      : [`${base}&n=${t.count}`, `Answer ${t.count} ${systemLabel(t.system)} questions`];
    return <><div className="task-main"><Link to={to}>{text}</Link> {mins}</div>{progressText(t)}</>;
  };

  const focus = new Set(view.tasks.flatMap((t) => (t.kind === 'questions' ? [t.system] : [])));
  const started = Object.entries(view.mastery).filter(([, m]) => m.answered > 0).sort((a, b) => a[1].mastery - b[1].mastery);
  const fresh = Object.entries(view.mastery).filter(([, m]) => m.answered === 0).sort((a, b) => a[0].localeCompare(b[0]));
  const weekMax = Math.max(1, ...view.byDay, ...view.byWeekday);
  const heading = now().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const tasksDone = view.tasks.filter(isDone).length;
  return (
    <div className="today">
      <div className="today-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>{heading}</p>
          <h1>Your plan</h1>
        </div>
      </div>
      <p role="status" className="warn-line">{overMax ? 'Maximum is 600 minutes, using 600.' : ''}</p>
      {data.hasCompletedRun === false && <p className="callout"><span><Link to="/diagnostic">Take the diagnostic</Link> to calibrate your plan.</span></p>}
      <div className="bento">
        <section className="tile t-count" style={at(0)}>
          <h2>Exam countdown</h2>
          <p className={view.left !== null && view.left >= 0 ? 'big' : 'muted'}>{daysLeftText(view.left)}</p>
          {data.settings.target_date && <p className="meta">Target date: {new Date(`${data.settings.target_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
        </section>
        <section className="tile t-prog" style={at(1)}>
          <h2>Today</h2>
          <p className="big">{view.tasks.length ? `${tasksDone} of ${view.tasks.length} done` : `${view.minutes} min`}</p>
          <label className="minutes-field">Minutes today <input type="number" min={0} max={600} value={override} placeholder={String(view.minutes)}
            onChange={(e) => onOverride(e.target.value)} /></label>
        </section>
        <section className="tile t-week" style={at(2)}>
          <div className="panel-head"><h2>This week</h2><span className="meta">Monday to Sunday</span></div>
          <div className="week" aria-hidden="true">{view.byDay.map((m, i) => (
            <div key={i} className={`day${i === view.dayIdx ? ' now' : ''}`}>
              <div className="col"><div className="plan" style={{ height: `${(view.byWeekday[i] / weekMax) * 100}%` }} /><div className="did" style={{ height: `${(m / weekMax) * 100}%` }} /></div>
              <span className="lbl">{'MTWTFSS'[i]}</span>
            </div>))}</div>
          <p className="week-total">{view.done} of {view.planned} min this week</p>
          <progress aria-label="Minutes this week" max={view.planned || 1} value={Math.min(view.done, view.planned)} />
        </section>
        <section className="tile t-plan" style={at(3)}>
          <div className="panel-head"><h2>Your tasks</h2><span className="meta">{view.minutes} min planned</span></div>
          {view.minutes <= 0 ? <p className="empty">No study time set for today.</p> : !view.tasks.length ? <p className="empty">Nothing to do today.</p> : (<>
            <ol className="today-tasks">{view.tasks.map((t, i) => {
              const done = isDone(t);
              return <li key={i} className={done ? 'done' : ''}>
                {done ? <span className="task-status" role="img" aria-label="done">✓</span> : <span className="task-status" aria-hidden="true" />}
                {renderTask(t)}</li>;
            })}</ol>
            {allDone && <p className="all-done">All done for today.</p>}
            <div className="plan-foot"><span className="meta">Plans update with your answers.</span><button onClick={onRebuild}>Rebuild plan</button></div>
          </>)}
        </section>
        <section className="tile t-mastery" style={at(4)}>
          <div className="panel-head"><h2>Where you stand</h2><span className="meta">Weakest first</span></div>
          <ul className="mastery">
            {started.map(([sys, m]) => (
              <li key={sys}>
                <span className="name">{systemLabel(sys)}{focus.has(sys) && <span className="focus">In plan</span>}</span>
                <span className="num">{Math.round(m.mastery * 100)}% · {m.answered} answered</span>
                <span className="bar"><i className={m.mastery < 0.5 ? 'low' : m.mastery < 0.7 ? 'mid' : ''} style={{ width: `${Math.round(m.mastery * 100)}%` }} /></span>
              </li>))}
            {fresh.map(([sys]) => (
              <li key={sys} className="fresh">
                <span className="name">{systemLabel(sys)}{focus.has(sys) && <span className="focus">In plan</span>}</span>
                <span className="num">Not started</span>
                <span className="bar" />
              </li>))}
          </ul>
        </section>
        <section className="tile t-settings" style={at(5)}>
          <details><summary>Plan settings</summary><Settings value={data.settings} onSave={onSave} /></details>
        </section>
      </div>
    </div>
  );
}
