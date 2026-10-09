import { pickBlock } from './mcq';
import { weightOf } from './blueprint';

export type QLite = { id: string; system: string };
export const DIAGNOSTIC_SIZE = 100;
export const LOW_CONFIDENCE_BELOW = 5;

// Small deterministic PRNG (mulberry32 over a string hash) so a stored seed reproduces a draw.
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Questions per system: a floor of `minPer` (or all there are), the rest by weight (largest remainder), capped by supply.
export function allocate(available: Record<string, number>, total = DIAGNOSTIC_SIZE, minPer = 3): Record<string, number> {
  const systems = Object.keys(available).filter((s) => available[s] > 0);
  const out: Record<string, number> = {};
  for (const s of systems) out[s] = Math.min(minPer, available[s]);
  const supply = systems.reduce((n, s) => n + available[s], 0);
  let left = Math.min(total, supply) - systems.reduce((n, s) => n + out[s], 0);
  while (left > 0) {
    const open = systems.filter((s) => out[s] < available[s]);
    if (!open.length) break;
    const wsum = open.reduce((n, s) => n + weightOf(s), 0);
    const shares = open.map((s) => ({ s, exact: (left * weightOf(s)) / wsum }));
    let rest = left;
    for (const x of shares) {
      const add = Math.min(Math.floor(x.exact), available[x.s] - out[x.s]);
      out[x.s] += add; rest -= add;
    }
    shares.sort((a, b) => (b.exact % 1) - (a.exact % 1) || weightOf(b.s) - weightOf(a.s) || a.s.localeCompare(b.s));
    for (const x of shares) {
      if (rest <= 0) break;
      if (out[x.s] < available[x.s]) { out[x.s]++; rest--; }
    }
    left = rest;
  }
  return out;
}

export function sampleDiagnostic(questions: QLite[], seen: ReadonlySet<string>, seed: string, total = DIAGNOSTIC_SIZE): string[] {
  const rng = seededRng(seed);
  const bySystem = new Map<string, QLite[]>();
  for (const q of questions) bySystem.set(q.system, [...(bySystem.get(q.system) ?? []), q]);
  const counts = allocate(Object.fromEntries([...bySystem].map(([s, qs]) => [s, qs.length])), total);
  const picked: QLite[] = [];
  for (const [system, qs] of bySystem) {
    const fresh = pickBlock(qs.filter((q) => !seen.has(q.id)), Infinity, rng);
    const old = pickBlock(qs.filter((q) => seen.has(q.id)), Infinity, rng);
    picked.push(...[...fresh, ...old].slice(0, counts[system] ?? 0));
  }
  return pickBlock(picked, Infinity, rng).map((q) => q.id);
}

export type SystemResult = { system: string; total: number; answered: number; correct: number; accuracy: number | null; lowConfidence: boolean };

export function summarizeRun(run: QLite[], attempts: { question_id: string; correct: boolean }[]) {
  const answers = new Map(attempts.map((a) => [a.question_id, a.correct]));
  const rows = new Map<string, SystemResult>();
  for (const q of run) {
    const r = rows.get(q.system) ?? { system: q.system, total: 0, answered: 0, correct: 0, accuracy: null, lowConfidence: true };
    r.total++;
    if (answers.has(q.id)) { r.answered++; if (answers.get(q.id)) r.correct++; }
    rows.set(q.system, r);
  }
  const bySystem = [...rows.values()]
    .map((r) => ({ ...r, accuracy: r.answered ? r.correct / r.answered : null, lowConfidence: r.answered < LOW_CONFIDENCE_BELOW }))
    .sort((a, b) => weightOf(b.system) - weightOf(a.system) || a.system.localeCompare(b.system));
  return {
    total: run.length,
    answered: bySystem.reduce((n, r) => n + r.answered, 0),
    correct: bySystem.reduce((n, r) => n + r.correct, 0),
    bySystem,
  };
}

// Results order for the student: systems with enough answers by accuracy (weakest first), then the low-confidence ones,
// then systems she never reached. Ties go to the system that counts more on the exam, then by name.
export function weakestFirst(rows: SystemResult[]): SystemResult[] {
  const group = (r: SystemResult) => (r.answered === 0 ? 2 : r.lowConfidence ? 1 : 0);
  return [...rows].sort((a, b) =>
    group(a) - group(b) || (a.accuracy ?? 0) - (b.accuracy ?? 0) || weightOf(b.system) - weightOf(a.system) || a.system.localeCompare(b.system));
}
