import { weightOf } from './blueprint';
import type { QLite } from './diagnostic';
import { pickBlock } from './mcq';

export type Attempt = { question_id: string; correct: boolean; duration_ms: number; answered_at: string };
export type Review = { card_id: string; duration_ms: number; reviewed_at: string };
export type Task =
  | { kind: 'cards'; count: number; minutes: number }
  | { kind: 'note'; system: string; minutes: number }
  | { kind: 'questions'; system: string; count: number; minutes: number };

export const DAY_MS = 86_400_000;
export const DEFAULT_SEC_PER_CARD = 20;
export const DEFAULT_SEC_PER_QUESTION = 90;
// Floors on the measured pace: rapid test-clicking must not shrink the pace and balloon the plan.
export const MIN_SEC_PER_CARD = 8;
export const MIN_SEC_PER_QUESTION = 30;
export const NOTE_MINUTES = 6;
export const MIN_SET = 5;
const OUTLIER_MS = 600_000; // a tab left open must not skew her pace

const ts = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? -Infinity : t; };

export function latestPerQuestion(attempts: Attempt[]): Map<string, Attempt> {
  const m = new Map<string, Attempt>();
  for (const a of attempts) {
    const p = m.get(a.question_id);
    if (!p || ts(a.answered_at) > ts(p.answered_at)) m.set(a.question_id, a);
  }
  return m;
}

export function masteryBySystem(questions: QLite[], latest: Map<string, Attempt>) {
  const out: Record<string, { answered: number; correct: number; mastery: number }> = {};
  for (const q of questions) {
    const r = (out[q.system] ??= { answered: 0, correct: 0, mastery: 0.5 });
    const a = latest.get(q.id);
    if (a) { r.answered++; if (a.correct) r.correct++; }
  }
  for (const r of Object.values(out)) r.mastery = (r.correct + 2) / (r.answered + 4);
  return out;
}

export function lastStudyBySystem(qSystem: Map<string, string>, cSystem: Map<string, string>, attempts: Attempt[], reviews: Review[]) {
  const last = new Map<string, number>();
  const bump = (system: string | undefined, iso: string) => {
    if (!system) return;
    const t = Date.parse(iso);
    if (t > (last.get(system) ?? -Infinity)) last.set(system, t);
  };
  for (const a of attempts) bump(qSystem.get(a.question_id), a.answered_at);
  for (const r of reviews) bump(cSystem.get(r.card_id), r.reviewed_at);
  return last;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rankSystems(
  systems: string[], mastery: Record<string, { mastery: number }>, last: Map<string, number>, now: number,
) {
  return systems
    .map((system) => {
      const days = last.has(system) ? (now - last.get(system)!) / DAY_MS : 7;
      const recency = clamp(0.5 + days / 4, 0.5, 1.5);
      return { system, priority: weightOf(system) * (1 - (mastery[system]?.mastery ?? 0.5)) * recency };
    })
    .sort((a, b) => b.priority - a.priority || a.system.localeCompare(b.system));
}

export function medianSeconds(durationsMs: number[], fallback: number): number {
  const d = durationsMs.filter((x) => x > 0 && x <= OUTLIER_MS).sort((a, b) => a - b);
  if (!d.length) return fallback;
  const mid = Math.floor(d.length / 2);
  return Math.max(1, Math.round((d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2) / 1000));
}

export function buildPlan(i: {
  minutes: number; dueCards: number; secPerCard: number; secPerQuestion: number;
  ranked: string[]; available: Record<string, number>;
}): Task[] {
  i = { ...i, secPerCard: Math.max(MIN_SEC_PER_CARD, i.secPerCard), secPerQuestion: Math.max(MIN_SEC_PER_QUESTION, i.secPerQuestion) };
  const tasks: Task[] = [];
  if (i.minutes <= 0) return tasks;
  let left = i.minutes;
  const cardCount = Math.min(i.dueCards, Math.floor((0.4 * i.minutes * 60) / i.secPerCard));
  if (cardCount > 0) {
    const m = (cardCount * i.secPerCard) / 60;
    tasks.push({ kind: 'cards', count: cardCount, minutes: m });
    left -= m;
  }
  const [focus, second] = i.ranked;
  if (!focus) return tasks;
  const fit = (mins: number, system: string) => Math.min(Math.floor((mins * 60) / i.secPerQuestion), i.available[system] ?? 0);
  const set = (system: string, count: number): Task => ({ kind: 'questions', system, count, minutes: (count * i.secPerQuestion) / 60 });
  if (left < 20 || !second) {
    const count = fit(left, focus);
    if (count > 0) tasks.push(set(focus, count));
    return tasks;
  }
  const rest = left - NOTE_MINUTES;
  let focusCount = fit(rest * 0.6, focus);
  let secondCount = fit(rest * 0.4, second);
  if (secondCount < MIN_SET) { focusCount = fit(rest, focus); secondCount = 0; }
  if (focusCount <= 0) return tasks; // no lone note without a focus set
  tasks.push({ kind: 'note', system: focus, minutes: NOTE_MINUTES }, set(focus, focusCount));
  if (secondCount > 0) tasks.push(set(second, secondCount));
  return tasks;
}

// Local calendar: weeks run Monday (0) to Sunday (6).
export const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;
export function weekStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekdayIndex(now));
}

export function minutesDoneThisWeek(attempts: Attempt[], reviews: Review[], now: Date): number {
  const s = weekStart(now);
  const start = s.getTime();
  const end = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7).getTime();
  const inWeek = (iso: string) => { const t = Date.parse(iso); return t >= start && t < end; };
  const ms = attempts.filter((a) => inWeek(a.answered_at)).reduce((n, a) => n + a.duration_ms, 0)
    + reviews.filter((r) => inWeek(r.reviewed_at)).reduce((n, r) => n + r.duration_ms, 0);
  return Math.round(ms / 60_000);
}

// Minutes studied on each local weekday (Monday first) of the week containing `now`.
export function minutesByDayThisWeek(attempts: Attempt[], reviews: Review[], now: Date): number[] {
  const start = weekStart(now).getTime();
  const ms = [0, 0, 0, 0, 0, 0, 0];
  const add = (iso: string, d: number) => {
    const t = Date.parse(iso);
    const day = Math.floor((new Date(t).setHours(0, 0, 0, 0) - start) / DAY_MS + 0.5); // +0.5: a 23/25 h DST day still maps to its own index
    if (day >= 0 && day < 7) ms[day] += d;
  };
  attempts.forEach((a) => add(a.answered_at, a.duration_ms));
  reviews.forEach((r) => add(r.reviewed_at, r.duration_ms));
  return ms.map((m) => Math.round(m / 60_000));
}
export function daysLeft(target: string | null, now: Date): number | null {
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
  const [y, m, d] = target.split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(y, m - 1, d).getTime() - today) / DAY_MS);
}

export const todayMinutes = (byWeekday: number[], now: Date, override?: number | null) =>
  override ?? byWeekday[weekdayIndex(now)] ?? 0;

export function pickNote<N extends { id: string; title: string; system: string; tags: string[] }>(
  notes: N[], questions: { id: string; system: string; tags: string[] }[], latest: Map<string, Attempt>, system: string,
): N | null {
  const answered = new Map<string, number>();
  for (const q of questions) if (q.system === system && latest.has(q.id)) answered.set(q.tags[0], (answered.get(q.tags[0]) ?? 0) + 1);
  const mine = notes.filter((n) => n.system === system).sort((a, b) => a.title.localeCompare(b.title));
  if (!mine.length) return null;
  return mine.reduce((best, n) => ((answered.get(n.tags[0]) ?? 0) < (answered.get(best.tags[0]) ?? 0) ? n : best));
}

export function selectForTask<Q extends { id: string; system: string }>(
  questions: Q[], latest: Map<string, Attempt>, system: string, n: number, rng: () => number = Math.random,
): Q[] {
  const mine = questions.filter((q) => q.system === system);
  const unseen = mine.filter((q) => !latest.has(q.id));
  const missed = mine.filter((q) => latest.get(q.id)?.correct === false);
  const rest = mine.filter((q) => latest.get(q.id)?.correct === true);
  return [...pickBlock(unseen, Infinity, rng), ...pickBlock(missed, Infinity, rng), ...pickBlock(rest, Infinity, rng)].slice(0, Math.max(0, n));
}
