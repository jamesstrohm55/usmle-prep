import type { Attempt, Review, Task } from './planner';

export type Done = { cards: number; questions: Record<string, number> };
// `since` is when the plan was made (epoch ms): progress counts only items reviewed/answered at or after it.
export type Snapshot = { minutes: number; tasks: Task[]; since: number; hasCompletedRun: boolean };

// Distinct cards reviewed and distinct questions answered (per system) during the local calendar day of `now`,
// counting only activity at or after `since`.
export function doneToday(attempts: Attempt[], reviews: Review[], qSystem: Map<string, string>, now: Date, since = -Infinity): Done {
  const start = Math.max(since, new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());
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
const isTask = (t: unknown): t is Task => {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (typeof o.minutes !== 'number' || !Number.isFinite(o.minutes)) return false;
  if (o.kind === 'cards') return isCount(o.count);
  if (o.kind === 'note') return typeof o.system === 'string';
  if (o.kind === 'questions') return typeof o.system === 'string' && isCount(o.count);
  return false;
};

// A saved day plan, or null when missing, corrupt, or made for other minutes or another diagnostic state.
// `hasCompletedRun: null` means unknown (runs failed to load): any stored state is accepted.
export function parseSnapshot(raw: string | null, minutes: number, hasCompletedRun: boolean | null): Snapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && s.minutes === minutes && typeof s.hasCompletedRun === 'boolean'
      && (hasCompletedRun === null || s.hasCompletedRun === hasCompletedRun)
      && typeof s.since === 'number' && Number.isFinite(s.since) && s.since >= 0
      && Array.isArray(s.tasks) && s.tasks.every(isTask)
      ? { minutes, tasks: s.tasks, since: s.since, hasCompletedRun: s.hasCompletedRun } : null;
  } catch { return null; }
}
