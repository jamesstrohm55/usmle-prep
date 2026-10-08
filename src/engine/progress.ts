import type { Attempt, Review, Task } from './planner';

export type Done = { cards: number; questions: Record<string, number> };
// `base` is what was already done today when the plan was made: progress counts only work done since.
export type Snapshot = { minutes: number; tasks: Task[]; base: Done; hasCompletedRun: boolean };

// Distinct cards reviewed and distinct questions answered (per system) during the local calendar day of `now`.
export function doneToday(attempts: Attempt[], reviews: Review[], qSystem: Map<string, string>, now: Date): Done {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const today = (iso: string) => { const t = Date.parse(iso); return t >= start && t < end; };
  const cards = new Set(reviews.filter((r) => today(r.reviewed_at)).map((r) => r.card_id));
  const seen = new Set<string>();
  const questions: Record<string, number> = {};
  for (const a of attempts) {
    const system = qSystem.get(a.question_id);
    if (!system || seen.has(a.question_id) || !today(a.answered_at)) continue;
    seen.add(a.question_id);
    questions[system] = (questions[system] ?? 0) + 1;
  }
  return { cards: cards.size, questions };
}

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
const isDone = (d: unknown): d is Done => {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return isCount(o.cards) && !!o.questions && typeof o.questions === 'object' && !Array.isArray(o.questions)
    && Object.values(o.questions).every(isCount);
};

export function sinceBase(now: Done, base: Done): Done {
  const questions: Record<string, number> = {};
  for (const [s, n] of Object.entries(now.questions)) questions[s] = Math.max(0, n - (base.questions[s] ?? 0));
  return { cards: Math.max(0, now.cards - base.cards), questions };
}
const isTask = (t: unknown): t is Task => {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (typeof o.minutes !== 'number' || !Number.isFinite(o.minutes)) return false;
  if (o.kind === 'cards') return isCount(o.count);
  if (o.kind === 'note') return typeof o.system === 'string';
  if (o.kind === 'questions') return typeof o.system === 'string' && isCount(o.count);
  return false;
};

// A saved day plan, or null when missing, corrupt, or made for other minutes or before/after the diagnostic changed.
export function parseSnapshot(raw: string | null, minutes: number, hasCompletedRun: boolean): Snapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && s.minutes === minutes && s.hasCompletedRun === hasCompletedRun && isDone(s.base)
      && Array.isArray(s.tasks) && s.tasks.every(isTask) ? { minutes, tasks: s.tasks, base: s.base, hasCompletedRun } : null;
  } catch { return null; }
}
