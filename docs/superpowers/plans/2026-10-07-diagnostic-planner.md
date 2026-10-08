# Diagnostic and Daily Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pausable ~100-question diagnostic and a "Today" screen that builds each day's study list from her minutes, weak systems and due flashcards.

**Architecture:** Pure planning and sampling logic in `src/engine/` (test-first); two small additive tables plus one unique index in one migration; two feature folders (`diagnostic`, `planner`) using the existing `cachedRead` query pattern; one preset prop on `Questions`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library, Supabase (RLS), react-router-dom HashRouter. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-diagnostic-planner-design.md`

## Global Constraints

- Step 1 only (`track = 'step1'` content is all that exists). No runtime AI. No new npm dependencies.
- Online-first with the read cache (`cachedRead`); writes need a connection and show a clear toast on failure.
- Local calendar: "today" and "this week" use the browser's local date; weeks run Monday to Sunday (Monday = index 0).
- Never print `.env` values or write secrets to files. Applying the migration to the live Supabase project requires explicit approval from James at execution time (Task 9). Do not push or seed without that approval.
- Verification: after each task run `npx vitest run` and `npx tsc --noEmit` and read the exit codes directly (no pipes that hide them).
- Match the surrounding code: small components with `load`/`save` props defaulting to the real queries, `useToast` for errors, `alive` refs on async saves.

## Clarifications to the spec (apply these; they override the spec text)

1. A question set has at least 5 questions only when time allows. Rule used by `buildPlan`: if time left after cards is under 20 minutes (or only one system exists) the day is one question set in the top system, sized to the time left (any count from 1 up); with 20+ minutes left it is note (6 min) + focus set + second set, and a second set smaller than 5 questions is merged into the focus set.
2. Duplicate diagnostic answers are prevented in the database too: a unique index on `attempts(session_id, question_id)` (additive; precheck for existing duplicates in Task 3).
3. The planner's note suggestion links to `/notes` (the notes screen is unchanged); it names a specific note title chosen by `pickNote`.

## Review Focus (each line has a test in the owning task)

1. Resuming a diagnostic run never double-counts an answer (Task 6; DB unique index Task 3).
2. A weekday with 0 minutes, or all zeros, gives an empty plan without errors (Task 2, Task 5).
3. A system with fewer than 3 questions does not break sampling (Task 1).
4. Week and day boundaries use local time; Sunday belongs to the week that started on the previous Monday (Task 2).
5. A brand-new user (no attempts, no card states, no settings row) sees a sensible Today (Task 5).

## File structure

- Create `src/engine/blueprint.ts`, `src/engine/diagnostic.ts`, `src/engine/planner.ts` and their `.test.ts` files.
- Create `supabase/migrations/20261007000001_planner.sql`; modify `supabase/tests/rls.test.ts`.
- Modify `src/db/queries.ts` (settings, attempts, reviews, runs); add tests in `src/db/queries.test.ts`.
- Create `src/features/planner/Today.tsx`, `Settings.tsx` (+ tests), `src/features/diagnostic/Diagnostic.tsx` (+ test).
- Modify `src/features/questions/Questions.tsx` (+ test), `src/App.tsx`.

---

### Task 1: Blueprint and diagnostic sampling

**Files:**
- Create: `src/engine/blueprint.ts`, `src/engine/diagnostic.ts`
- Test: `src/engine/diagnostic.test.ts`

**Interfaces:**
- Produces: `SYSTEM_WEIGHTS`, `weightOf(system): number`; `type QLite = { id: string; system: string }`; `DIAGNOSTIC_SIZE = 100`, `LOW_CONFIDENCE_BELOW = 5`; `seededRng(seed): () => number`; `allocate(available: Record<string, number>, total?: number, minPer?: number): Record<string, number>`; `sampleDiagnostic(questions: QLite[], seen: ReadonlySet<string>, seed: string, total?: number): string[]`; `summarizeRun(run: QLite[], attempts: {question_id: string; correct: boolean}[])` returning `{ total, answered, correct, bySystem: SystemResult[] }`.
- Consumes: `pickBlock` from `src/engine/mcq.ts` (a Fisher-Yates copy returning up to n items; pass `Infinity` to shuffle all).

- [ ] **Step 1: Write the failing tests** in `src/engine/diagnostic.test.ts`

```ts
import { SYSTEM_WEIGHTS, weightOf } from './blueprint';
import { allocate, sampleDiagnostic, summarizeRun, seededRng, DIAGNOSTIC_SIZE } from './diagnostic';

const bank = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([system, n]) => Array.from({ length: n }, (_, i) => ({ id: `${system}-${i}`, system })));
const full = Object.fromEntries(Object.keys(SYSTEM_WEIGHTS).map((s) => [s, 40]));

test('weights sum to 100 and unknown systems get a small default', () => {
  expect(Object.values(SYSTEM_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  expect(weightOf('made-up')).toBe(3);
});

test('allocate: total is 100, every system has at least 3, cap respected', () => {
  const a = allocate(full);
  expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(100);
  expect(Math.min(...Object.values(a))).toBeGreaterThanOrEqual(3);
  const small = allocate({ ...full, renal: 2, psychiatry: 0 });
  expect(small.renal).toBe(2);
  expect(small.psychiatry).toBeUndefined();
  expect(Object.values(small).reduce((x, y) => x + y, 0)).toBe(100);
});

test('allocate: fewer questions than the total gives everything available', () => {
  const a = allocate({ renal: 4, nervous: 5 });
  expect(a).toEqual({ renal: 4, nervous: 5 });
});

test('sampleDiagnostic is deterministic for a seed and differs across seeds', () => {
  const qs = bank(full);
  const a = sampleDiagnostic(qs, new Set(), 'seed-1');
  expect(a).toHaveLength(DIAGNOSTIC_SIZE);
  expect(new Set(a).size).toBe(DIAGNOSTIC_SIZE);
  expect(sampleDiagnostic(qs, new Set(), 'seed-1')).toEqual(a);
  expect(sampleDiagnostic(qs, new Set(), 'seed-2')).not.toEqual(a);
});

test('sampleDiagnostic prefers unseen questions', () => {
  const qs = bank({ renal: 20, nervous: 20 });
  const seen = new Set(qs.filter((q) => q.system === 'renal').slice(0, 10).map((q) => q.id));
  const picked = sampleDiagnostic(qs, seen, 's', 20);
  const renalPicked = picked.filter((id) => id.startsWith('renal'));
  expect(renalPicked.every((id) => !seen.has(id))).toBe(true);
});

test('sampleDiagnostic uses seen questions when unseen run out, and survives tiny systems', () => {
  const qs = bank({ renal: 2, nervous: 30 });
  const picked = sampleDiagnostic(qs, new Set(['renal-0', 'renal-1']), 's', 20);
  expect(picked.filter((id) => id.startsWith('renal'))).toHaveLength(2);
});

test('seededRng is in [0,1)', () => {
  const r = seededRng('x');
  for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});

test('summarizeRun: per-system accuracy, low confidence under 5 answered, dedupes repeats', () => {
  const run = [...bank({ renal: 6, nervous: 3 })];
  const attempts = [
    ...Array.from({ length: 5 }, (_, i) => ({ question_id: `renal-${i}`, correct: i < 4 })),
    { question_id: 'nervous-0', correct: true }, { question_id: 'nervous-0', correct: true },
  ];
  const s = summarizeRun(run, attempts);
  const renal = s.bySystem.find((r) => r.system === 'renal')!;
  const nervous = s.bySystem.find((r) => r.system === 'nervous')!;
  expect(renal).toMatchObject({ total: 6, answered: 5, correct: 4, lowConfidence: false });
  expect(renal.accuracy).toBeCloseTo(0.8);
  expect(nervous).toMatchObject({ answered: 1, correct: 1, lowConfidence: true });
  expect(s).toMatchObject({ total: 9, answered: 6, correct: 5 });
});

test('summarizeRun: unanswered system has null accuracy', () => {
  const s = summarizeRun(bank({ renal: 3 }), []);
  expect(s.bySystem[0].accuracy).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/diagnostic.test.ts; echo "exit=$?"`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** `src/engine/blueprint.ts`

```ts
// Approximate Step 1 emphasis per system, used only to size the diagnostic and rank study priority.
// Not official figures; edit freely (weights should sum to about 100).
export const SYSTEM_WEIGHTS: Record<string, number> = {
  cardiovascular: 9, respiratory: 8, renal: 7, gastrointestinal: 7, endocrine: 6, reproductive: 7,
  nervous: 9, 'hematology-oncology': 6, psychiatry: 5, 'behavioral-science': 4,
  'biostatistics-epidemiology': 5, 'musculoskeletal-dermatology': 7, 'biochemistry-genetics': 6,
  immunology: 5, microbiology: 6, 'general-principles': 3,
};
export const weightOf = (system: string) => SYSTEM_WEIGHTS[system] ?? 3;
```

`src/engine/diagnostic.ts`

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/diagnostic.test.ts; echo "exit=$?"` then `npx tsc --noEmit; echo "exit=$?"`
Expected: all tests pass, both exit 0. (Fix `pickBlock`'s `n` parameter type if tsc rejects `Infinity`: it is typed `number`, so it should accept it.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/blueprint.ts src/engine/diagnostic.ts src/engine/diagnostic.test.ts
git commit -m "feat: diagnostic sampling and run summary (engine)"
```

---

### Task 2: Planner engine

**Files:**
- Create: `src/engine/planner.ts`
- Test: `src/engine/planner.test.ts`

**Interfaces:**
- Consumes: `weightOf` (blueprint), `QLite` (diagnostic), `pickBlock` (mcq).
- Produces:
  - Types `Attempt = { question_id; correct; duration_ms; answered_at }`, `Review = { card_id; duration_ms; reviewed_at }`, `Task` (union below), constants `DAY_MS`, `DEFAULT_SEC_PER_CARD = 20`, `DEFAULT_SEC_PER_QUESTION = 90`, `NOTE_MINUTES = 6`, `MIN_SET = 5`.
  - `latestPerQuestion(attempts): Map<string, Attempt>`
  - `masteryBySystem(questions: QLite[], latest): Record<string, { answered: number; correct: number; mastery: number }>`
  - `lastStudyBySystem(qSystem: Map<string,string>, cSystem: Map<string,string>, attempts, reviews): Map<string, number>` (epoch ms)
  - `rankSystems(systems: string[], mastery, last, now: number): { system: string; priority: number }[]` (highest first)
  - `medianSeconds(durationsMs: number[], fallback: number): number`
  - `buildPlan(i: { minutes; dueCards; secPerCard; secPerQuestion; ranked: string[]; available: Record<string, number> }): Task[]`
  - `weekdayIndex(d)`, `weekStart(now)`, `minutesDoneThisWeek(attempts, reviews, now)`, `daysLeft(target: string | null, now)`, `todayMinutes(byWeekday: number[], now, override?: number | null)`
  - `pickNote(notes: {id; title; system; tags: string[]}[], questions: {id; system; tags: string[]}[], latest, system)`
  - `selectForTask(questions: {id; system}[], latest, system, n, rng?)`

- [ ] **Step 1: Write the failing tests** in `src/engine/planner.test.ts`

```ts
import {
  latestPerQuestion, masteryBySystem, lastStudyBySystem, rankSystems, medianSeconds, buildPlan,
  weekdayIndex, weekStart, minutesDoneThisWeek, daysLeft, todayMinutes, pickNote, selectForTask, DAY_MS,
} from './planner';

const at = (q: string, correct: boolean, when: string, ms = 60_000) => ({ question_id: q, correct, duration_ms: ms, answered_at: when });

test('latestPerQuestion keeps the newest attempt by time, not by order', () => {
  const m = latestPerQuestion([at('a', true, '2026-10-02T10:00:00Z'), at('a', false, '2026-10-01T10:00:00Z')]);
  expect(m.get('a')!.correct).toBe(true);
});

test('masteryBySystem: neutral prior of 4, only the latest attempt per question counts', () => {
  const qs = [{ id: 'a', system: 'renal' }, { id: 'b', system: 'renal' }, { id: 'c', system: 'nervous' }];
  const latest = latestPerQuestion([at('a', false, '2026-10-01T00:00:00Z'), at('a', true, '2026-10-02T00:00:00Z'), at('b', true, '2026-10-02T00:00:00Z')]);
  const m = masteryBySystem(qs, latest);
  expect(m.renal).toEqual({ answered: 2, correct: 2, mastery: (2 + 2) / (2 + 4) });
  expect(m.nervous).toEqual({ answered: 0, correct: 0, mastery: 0.5 });
});

test('rankSystems: weak, heavy and neglected systems rank higher', () => {
  const mastery = { cardiovascular: { answered: 10, correct: 9, mastery: 0.8 }, renal: { answered: 10, correct: 3, mastery: 0.3 } };
  const now = Date.parse('2026-10-10T12:00:00Z');
  const last = new Map([['cardiovascular', now - DAY_MS], ['renal', now - DAY_MS]]);
  expect(rankSystems(['cardiovascular', 'renal'], mastery, last, now)[0].system).toBe('renal');
  // equal mastery: the more neglected system wins
  const eq = { cardiovascular: { answered: 0, correct: 0, mastery: 0.5 }, renal: { answered: 0, correct: 0, mastery: 0.5 } };
  const last2 = new Map([['cardiovascular', now], ['renal', now - 6 * DAY_MS]]);
  expect(rankSystems(['cardiovascular', 'renal'], eq, last2, now)[0].system).toBe('renal');
  // never studied counts as 7 days
  expect(rankSystems(['renal'], eq, new Map(), now)[0].priority).toBeCloseTo(7 * 0.5 * 1.5);
});

test('medianSeconds ignores zero and absurd durations and falls back when empty', () => {
  expect(medianSeconds([], 90)).toBe(90);
  expect(medianSeconds([0, 30_000, 50_000, 70_000, 3_600_000], 90)).toBe(50);
});

test('lastStudyBySystem maps attempts and reviews to systems', () => {
  const last = lastStudyBySystem(new Map([['q1', 'renal']]), new Map([['c1', 'nervous']]),
    [at('q1', true, '2026-10-02T00:00:00Z'), at('zz', true, '2026-10-09T00:00:00Z')],
    [{ card_id: 'c1', duration_ms: 1, reviewed_at: '2026-10-03T00:00:00Z' }]);
  expect(last.get('renal')).toBe(Date.parse('2026-10-02T00:00:00Z'));
  expect(last.get('nervous')).toBe(Date.parse('2026-10-03T00:00:00Z'));
  expect(last.size).toBe(2);
});

const base = { dueCards: 0, secPerCard: 20, secPerQuestion: 90, ranked: ['renal', 'nervous'], available: { renal: 100, nervous: 100 } };
const total = (p: ReturnType<typeof buildPlan>) => p.reduce((n, t) => n + t.minutes, 0);

test('buildPlan: zero or negative minutes gives an empty plan', () => {
  expect(buildPlan({ ...base, minutes: 0 })).toEqual([]);
  expect(buildPlan({ ...base, minutes: -5, dueCards: 10 })).toEqual([]);
});

test('buildPlan: no ranked systems still schedules cards only', () => {
  const p = buildPlan({ ...base, minutes: 60, dueCards: 5, ranked: [] });
  expect(p).toEqual([{ kind: 'cards', count: 5, minutes: (5 * 20) / 60 }]);
});

test('buildPlan: cards are capped at 40% of the time', () => {
  const p = buildPlan({ ...base, minutes: 60, dueCards: 1000 });
  const cards = p.find((t) => t.kind === 'cards')!;
  expect(cards.minutes).toBeLessThanOrEqual(0.4 * 60 + 1e-9);
  expect(total(p)).toBeLessThanOrEqual(60 + 1e-9);
});

test('buildPlan: 3 hours gives cards, a note, a focus set and a second set within budget', () => {
  const p = buildPlan({ ...base, minutes: 180, dueCards: 30 });
  expect(p.map((t) => t.kind)).toEqual(['cards', 'note', 'questions', 'questions']);
  expect(total(p)).toBeLessThanOrEqual(180 + 1e-9);
  const [, note, q1, q2] = p as [unknown, { system: string }, { system: string }, { system: string }];
  expect([note.system, q1.system, q2.system]).toEqual(['renal', 'renal', 'nervous']);
});

test('buildPlan: a short day is one question set in the top system, no note', () => {
  const p = buildPlan({ ...base, minutes: 15 });
  expect(p).toEqual([{ kind: 'questions', system: 'renal', count: 10, minutes: 15 }]);
  const tiny = buildPlan({ ...base, minutes: 2 });
  expect(tiny).toEqual([{ kind: 'questions', system: 'renal', count: 1, minutes: 1.5 }]);
});

test('buildPlan: a second set under 5 questions is merged into the focus set', () => {
  const p = buildPlan({ ...base, minutes: 25 });
  expect(p.map((t) => t.kind)).toEqual(['note', 'questions']);
});

test('buildPlan: counts never exceed the questions available', () => {
  const p = buildPlan({ ...base, minutes: 180, available: { renal: 7, nervous: 0 } });
  const q = p.filter((t) => t.kind === 'questions') as { count: number }[];
  expect(q).toHaveLength(1);
  expect(q[0].count).toBe(7);
});

test('week helpers: Monday-first, Sunday belongs to the week that began Monday', () => {
  expect(weekdayIndex(new Date(2026, 9, 5))).toBe(0); // Mon 5 Oct 2026
  expect(weekdayIndex(new Date(2026, 9, 11))).toBe(6); // Sun 11 Oct 2026
  expect(weekStart(new Date(2026, 9, 11, 23, 30)).getDate()).toBe(5);
});

test('minutesDoneThisWeek sums attempts and reviews inside the local week only', () => {
  const now = new Date(2026, 9, 7, 12); // Wed
  const inWeek = new Date(2026, 9, 6, 9).toISOString();
  const before = new Date(2026, 9, 4, 9).toISOString(); // previous Sunday
  const done = minutesDoneThisWeek(
    [{ question_id: 'a', correct: true, duration_ms: 120_000, answered_at: inWeek }, { question_id: 'b', correct: true, duration_ms: 999_000, answered_at: before }],
    [{ card_id: 'c', duration_ms: 60_000, reviewed_at: inWeek }], now);
  expect(done).toBe(3);
});

test('daysLeft and todayMinutes', () => {
  const now = new Date(2026, 9, 7, 15);
  expect(daysLeft(null, now)).toBeNull();
  expect(daysLeft('2026-10-10', now)).toBe(3);
  expect(daysLeft('2026-10-05', now)).toBe(-2);
  expect(todayMinutes([10, 20, 30, 40, 50, 60, 70], now)).toBe(30); // Wednesday = index 2
  expect(todayMinutes([10, 20, 30, 40, 50, 60, 70], now, 5)).toBe(5);
  expect(todayMinutes([], now)).toBe(0);
});

test('pickNote picks the note of the block with the fewest answered questions', () => {
  const notes = [
    { id: 'n1', title: 'A', system: 'renal', tags: ['acid-base'] },
    { id: 'n2', title: 'B', system: 'renal', tags: ['stones'] },
    { id: 'n3', title: 'C', system: 'nervous', tags: ['x'] },
  ];
  const qs = [{ id: 'q1', system: 'renal', tags: ['acid-base'] }, { id: 'q2', system: 'renal', tags: ['stones'] }];
  const latest = latestPerQuestion([at('q1', true, '2026-10-01T00:00:00Z')]);
  expect(pickNote(notes, qs, latest, 'renal')!.id).toBe('n2');
  expect(pickNote(notes, qs, latest, 'immunology')).toBeNull();
});

test('selectForTask: unseen first, then missed, then the rest; only the system; at most n', () => {
  const qs = ['a', 'b', 'c', 'd'].map((id) => ({ id, system: 'renal' })).concat([{ id: 'z', system: 'nervous' }]);
  const latest = latestPerQuestion([at('a', true, '2026-10-01T00:00:00Z'), at('b', false, '2026-10-01T00:00:00Z')]);
  const ids = selectForTask(qs, latest, 'renal', 3, () => 0.3).map((q) => q.id);
  expect(ids.slice(0, 2).sort()).toEqual(['c', 'd']);
  expect(ids[2]).toBe('b');
  expect(selectForTask(qs, latest, 'renal', 0)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/planner.test.ts; echo "exit=$?"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/engine/planner.ts`

```ts
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
export const NOTE_MINUTES = 6;
export const MIN_SET = 5;
const OUTLIER_MS = 600_000; // a tab left open must not skew her pace

export function latestPerQuestion(attempts: Attempt[]): Map<string, Attempt> {
  const m = new Map<string, Attempt>();
  for (const a of attempts) {
    const p = m.get(a.question_id);
    if (!p || Date.parse(a.answered_at) > Date.parse(p.answered_at)) m.set(a.question_id, a);
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
  return Math.round((d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2) / 1000);
}

export function buildPlan(i: {
  minutes: number; dueCards: number; secPerCard: number; secPerQuestion: number;
  ranked: string[]; available: Record<string, number>;
}): Task[] {
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
  tasks.push({ kind: 'note', system: focus, minutes: NOTE_MINUTES });
  const rest = left - NOTE_MINUTES;
  let focusCount = fit(rest * 0.6, focus);
  let secondCount = fit(rest * 0.4, second);
  if (secondCount < MIN_SET) { focusCount = fit(rest, focus); secondCount = 0; }
  if (focusCount > 0) tasks.push(set(focus, focusCount));
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

export function daysLeft(target: string | null, now: Date): number | null {
  if (!target) return null;
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/planner.test.ts; echo "exit=$?"`; `npx tsc --noEmit; echo "exit=$?"`
Expected: PASS, exit 0. If the `rankSystems` priority assertion `7 * 0.5 * 1.5` fails, check the default weight: `weightOf('renal')` is 7, mastery 0.5, never studied: days 7 gives recency clamp(0.5+1.75, 0.5, 1.5) = 1.5, so priority = 7 × 0.5 × 1.5.

- [ ] **Step 5: Commit**

```bash
git add src/engine/planner.ts src/engine/planner.test.ts
git commit -m "feat: planner engine (mastery, priority, plan, week helpers)"
```

---

### Task 3: Migration and RLS tests (local only)

**Files:**
- Create: `supabase/migrations/20261007000001_planner.sql`
- Modify: `supabase/tests/rls.test.ts` (add tests inside the existing `describe`)

**Interfaces:**
- Produces tables `study_settings(user_id pk, target_date, minutes_by_weekday int[7], updated_at)` and `diagnostic_runs(id, user_id, started_at, completed_at, status, question_ids uuid[], seed)`; a unique index `attempts_session_question` on `attempts(session_id, question_id)`.

- [ ] **Step 1: Write the failing RLS tests** (append inside the describe in `supabase/tests/rls.test.ts`; they skip unless `LOCAL_API_URL` is set)

```ts
  test('study_settings: own row only, bad minutes rejected', async () => {
    const ok = await vanessa.client.from('study_settings').insert({ target_date: '2027-01-15' });
    expect(ok.error).toBeNull();
    expect((await other.client.from('study_settings').select('*')).data).toEqual([]);
    const forged = await other.client.from('study_settings').insert({ user_id: vanessa.id });
    expect(forged.error).not.toBeNull();
    const bad = await other.client.from('study_settings').insert({ minutes_by_weekday: [1, 2, 3] });
    expect(bad.error).not.toBeNull();
    const big = await other.client.from('study_settings').insert({ minutes_by_weekday: [0, 0, 0, 0, 0, 0, 601] });
    expect(big.error).not.toBeNull();
  });

  test('diagnostic_runs: private, one in-progress run per user, status can move to completed', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const a = await vanessa.client.from('diagnostic_runs').insert({ question_ids: ids, seed: 's1' }).select('id').single();
    expect(a.error).toBeNull();
    const second = await vanessa.client.from('diagnostic_runs').insert({ question_ids: ids, seed: 's2' });
    expect(second.error).not.toBeNull();
    expect((await other.client.from('diagnostic_runs').select('*')).data).toEqual([]);
    const done = await vanessa.client.from('diagnostic_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', a.data!.id).select();
    expect(done.data).toHaveLength(1);
    const again = await vanessa.client.from('diagnostic_runs').insert({ question_ids: ids, seed: 's3' });
    expect(again.error).toBeNull();
  });

  test('attempts: the same question cannot be answered twice in one session', async () => {
    const { data: q } = await admin.from('questions').insert({ track: 'step1', system: 'cardio', discipline: 'path', slug: `dq-${run}`, stem: 's', choices: ['a', 'b'], correct: 0, explanation: 'e' }).select('id').single();
    const session_id = crypto.randomUUID();
    const row = { question_id: q!.id, chosen: 0, correct: true, mode: 'timed', session_id };
    expect((await vanessa.client.from('attempts').insert(row)).error).toBeNull();
    expect((await vanessa.client.from('attempts').insert(row)).error?.code).toBe('23505');
  });
```

- [ ] **Step 2: Precheck the live database for duplicates** (read-only; use the Supabase MCP `execute_sql` tool)

```sql
select session_id, question_id, count(*) from attempts group by 1, 2 having count(*) > 1;
```
Expected: zero rows. If any rows come back, STOP and report to James: the unique index cannot be created until they are resolved.

- [ ] **Step 3: Write the migration** `supabase/migrations/20261007000001_planner.sql`

```sql
-- Diagnostic and planner: per-user settings and diagnostic runs (additive).
create table study_settings (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  target_date date,
  minutes_by_weekday int[] not null default '{60,60,60,60,60,180,180}'
    check (array_length(minutes_by_weekday, 1) = 7 and 0 <= all (minutes_by_weekday) and 600 >= all (minutes_by_weekday)),
  updated_at timestamptz not null default now()
);

create table diagnostic_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  question_ids uuid[] not null,
  seed text not null
);
create unique index diagnostic_runs_one_active on diagnostic_runs (user_id) where status = 'in_progress';

alter table study_settings enable row level security;
alter table diagnostic_runs enable row level security;
create policy study_settings_own on study_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy diagnostic_runs_own on diagnostic_runs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A question can be answered once per session (protects diagnostic resume from double counting).
create unique index attempts_session_question on attempts (session_id, question_id);
```

- [ ] **Step 4: Run the RLS tests against a local stack**

Run (needs Docker): `supabase start`, then `supabase db reset`, then export the local API URL and keys that `supabase status` prints as `LOCAL_API_URL`, `LOCAL_ANON_KEY`, `LOCAL_SERVICE_KEY` and run `npx vitest run supabase/tests/rls.test.ts; echo "exit=$?"`.
Expected: all pass including the three new tests. If Docker is unavailable, say so in the report and do NOT claim the RLS tests passed; Task 9 will not apply the migration until they have been run.

- [ ] **Step 5: Commit** (migration file and tests only; do NOT run `supabase db push` yet)

```bash
git add supabase/migrations/20261007000001_planner.sql supabase/tests/rls.test.ts
git commit -m "feat: study_settings and diagnostic_runs tables, unique answer per session"
```

---

### Task 4: Query helpers

**Files:**
- Modify: `src/db/queries.ts`
- Test: `src/db/queries.test.ts` (extend; read it first and follow its supabase-mock style)

**Interfaces:**
- Produces in `queries.ts`:
  - `type Settings = { target_date: string | null; minutes_by_weekday: number[] }`, `DEFAULT_SETTINGS`
  - `fetchSettings(): Promise<Settings>` (cached read, default when no row), `saveSettings(s: Settings): Promise<void>`
  - `fetchAttempts(): Promise<Attempt[]>` and `fetchReviews(): Promise<Review[]>` (both cached, all rows via `pageAll`, using the `Attempt`/`Review` types from `../engine/planner`)
  - `type Run = { id: string; started_at: string; completed_at: string | null; status: 'in_progress' | 'completed' | 'abandoned'; question_ids: string[]; seed: string }`
  - `fetchRuns(): Promise<Run[]>` (not cached, newest first), `createRun(question_ids: string[], seed: string): Promise<Run>`, `setRunStatus(id: string, status: 'completed' | 'abandoned'): Promise<void>`
  - `fetchRunAttempts(runId: string): Promise<{ question_id: string; chosen: number; correct: boolean }[]>` (not cached)

- [ ] **Step 1: Write the failing tests** that exercise each helper against a mocked `supabase` client (same style as the existing tests in `src/db/queries.test.ts`): `fetchSettings` returns `DEFAULT_SETTINGS` when `maybeSingle` returns `{ data: null, error: null }`; `saveSettings` upserts `{ target_date, minutes_by_weekday }` with `onConflict: 'user_id'`; `createRun` inserts `{ question_ids, seed }` and returns the row; `setRunStatus('completed')` also sends a `completed_at` timestamp, `'abandoned'` does not; `fetchRunAttempts` filters on `session_id`; every helper throws when the client returns an error.

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/db/queries.test.ts; echo "exit=$?"` (new tests fail, old ones pass).

- [ ] **Step 3: Implement** (append to `src/db/queries.ts`; import the two types at the top with the other type imports)

```ts
import type { Attempt, Review } from '../engine/planner';

export type Settings = { target_date: string | null; minutes_by_weekday: number[] };
export const DEFAULT_SETTINGS: Settings = { target_date: null, minutes_by_weekday: [60, 60, 60, 60, 60, 180, 180] };

export const fetchSettings = () =>
  cachedRead('study_settings', async () =>
    (must(await supabase.from('study_settings').select('target_date,minutes_by_weekday').maybeSingle()) as Settings | null) ?? DEFAULT_SETTINGS);

export async function saveSettings(s: Settings) {
  must(await supabase.from('study_settings').upsert(
    { target_date: s.target_date, minutes_by_weekday: s.minutes_by_weekday, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }).select());
}

export const fetchAttempts = () =>
  cachedRead('attempts', () => pageAll<Attempt>((a, b) =>
    supabase.from('attempts').select('question_id,correct,duration_ms,answered_at').order('id').range(a, b)));
export const fetchReviews = () =>
  cachedRead('review_log', () => pageAll<Review>((a, b) =>
    supabase.from('review_log').select('card_id,duration_ms,reviewed_at').order('id').range(a, b)));

export type Run = {
  id: string; started_at: string; completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned'; question_ids: string[]; seed: string;
};
export async function fetchRuns(): Promise<Run[]> {
  return must(await supabase.from('diagnostic_runs').select('*').order('started_at', { ascending: false })) as Run[];
}
export async function createRun(question_ids: string[], seed: string): Promise<Run> {
  return must(await supabase.from('diagnostic_runs').insert({ question_ids, seed }).select('*').single()) as Run;
}
export async function setRunStatus(id: string, status: 'completed' | 'abandoned') {
  const patch = status === 'completed' ? { status, completed_at: new Date().toISOString() } : { status };
  must(await supabase.from('diagnostic_runs').update(patch).eq('id', id).select());
}
export async function fetchRunAttempts(runId: string) {
  return must(await supabase.from('attempts').select('question_id,chosen,correct').eq('session_id', runId).order('id')) as
    { question_id: string; chosen: number; correct: boolean }[];
}
```

- [ ] **Step 4: Run to verify pass**: `npx vitest run; echo "exit=$?"` and `npx tsc --noEmit; echo "exit=$?"`.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts src/db/queries.test.ts
git commit -m "feat: queries for settings, attempts, reviews and diagnostic runs"
```

---

### Task 5: Today screen and Settings

**Files:**
- Create: `src/features/planner/Today.tsx`, `src/features/planner/Settings.tsx`
- Test: `src/features/planner/Today.test.tsx`, `src/features/planner/Settings.test.tsx`

**Interfaces:**
- Consumes: Task 1 and 2 engine functions; Task 4 queries; `fetchCards`, `fetchCardStates`, `fetchQuestions`, `fetchNotes`; `useToast`; `Link` from `react-router-dom` (tests wrap in `MemoryRouter`).
- Produces: `Today({ load = loadToday, save = saveSettings, now = () => new Date() })`; `Settings({ value, onSave })` where `value: Settings`, `onSave(s: Settings): Promise<void>`; `loadToday()` returning `{ questions, cards, states, notes, attempts, reviews, settings, hasCompletedRun: boolean | null }`.

- [ ] **Step 1: Write the failing tests**
  - `Settings.test.tsx`: shows the target date and seven weekday inputs from `value`; typing 90 into Monday and clicking Save calls `onSave` with `minutes_by_weekday[0] === 90`; an empty date saves `target_date: null`; a value above 600 or below 0 is clamped, and non-numeric input becomes 0; a rejected `onSave` shows an error message and re-enables the button.
  - `Today.test.tsx` (inject `load` and `now`, wrap in `ToastProvider` and `MemoryRouter`):
    1. New user: no attempts, no card states, default settings, 20 cards of one system and 10 questions, Wednesday: renders a plan, no error, shows "Set a target date" and, when `hasCompletedRun` is false, a link to `/diagnostic`.
    2. With `target_date` 3 days away it shows "3 days left"; past dates show "target date passed".
    3. A weekday with 0 minutes shows "No study time set for today" and no tasks; the override box changes the plan (type 30 -> a plan fitting 30 minutes) and is remembered in `localStorage` under `today-minutes:<YYYY-MM-DD>`; a throwing `localStorage` does not crash it.
    4. Due cards: with 12 due cards and 60 minutes the first task reads "Review 12 flashcards" linking to `/cards`; questions tasks link to `/questions?system=<system>&n=<count>`; the note task shows the picked note title and links to `/notes`.
    5. The weekly bar shows "<done> of <planned> min this week" using `minutesDoneThisWeek` and the sum of the seven weekday minutes.
    6. Load failure shows "Could not load" with a Retry button that reloads.

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/features/planner; echo "exit=$?"` (FAIL: modules not found).

- [ ] **Step 3: Implement** `Settings.tsx`

```tsx
import { useState } from 'react';
import type { Settings as StudySettings } from '../../db/queries';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const clampMin = (v: string) => Math.min(600, Math.max(0, Math.round(Number(v)) || 0));

export function Settings({ value, onSave }: { value: StudySettings; onSave: (s: StudySettings) => Promise<void> }) {
  const [date, setDate] = useState(value.target_date ?? '');
  const [mins, setMins] = useState(value.minutes_by_weekday.map(String));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try { await onSave({ target_date: date || null, minutes_by_weekday: mins.map(clampMin) }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <label>Target exam date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {DAYS.map((d, i) => (
        <div key={d}><label>{d} (minutes) <input type="number" min={0} max={600} value={mins[i]}
          onChange={(e) => setMins(mins.map((m, j) => (j === i ? e.target.value : m)))} /></label></div>
      ))}
      <button onClick={save} disabled={busy}>Save</button>
      {error && <p role="alert">Could not save: {error}</p>}
    </div>
  );
}
```

`Today.tsx` (structure; keep each helper small and use the engine, no planning math in the component)

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAttempts, fetchCards, fetchCardStates, fetchNotes, fetchQuestions, fetchReviews, fetchRuns, fetchSettings, saveSettings, DEFAULT_SETTINGS, type Settings as StudySettings } from '../../db/queries';
import { useToast } from '../../ui/Toast';
import { Settings } from './Settings';
import {
  buildPlan, daysLeft, DEFAULT_SEC_PER_CARD, DEFAULT_SEC_PER_QUESTION, lastStudyBySystem, latestPerQuestion, masteryBySystem,
  medianSeconds, minutesDoneThisWeek, pickNote, rankSystems, todayMinutes,
} from '../../engine/planner';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
async function loadToday() {
  const [questions, cards, states, notes, attempts, reviews, settings, runs] = await Promise.all([
    fetchQuestions(), fetchCards(), fetchCardStates(), fetchNotes(), fetchAttempts(), fetchReviews(), fetchSettings(),
    fetchRuns().catch(() => null),
  ]);
  return { questions, cards, states, notes, attempts, reviews, settings, hasCompletedRun: runs ? runs.some((r) => r.status === 'completed') : null };
}
```
Component rules: load once via a `loadRef` (as `Notes` does); `now` evaluated per render of the plan via `useMemo` keyed on data and override; compute `dueCards` as the number of card ids whose state exists and `new Date(due) <= now` (new, never-reviewed cards are NOT counted as due); `available[system]` = number of questions per system; `ranked` = `rankSystems(systems, masteryBySystem(...), lastStudyBySystem(...), now.getTime()).map(r => r.system)`; `secPerCard` / `secPerQuestion` = `medianSeconds(last 200 durations, default)`; override minutes read and written in `localStorage` inside `try/catch`; weekly bar uses `minutesDoneThisWeek` and `settings.minutes_by_weekday.reduce(sum)`; the settings form sits in `<details><summary>Plan settings</summary>` and on save calls `save`, updates local state and toasts "Saved". Task rendering: cards -> `<Link to="/cards">`, note -> title of `pickNote(...)` (fall back to "a note in <system>") linking to `/notes`, questions -> `<Link to={`/questions?system=${encodeURIComponent(system)}&n=${count}`}>`. System names are shown as they are stored.

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/features/planner; echo "exit=$?"`; `npx tsc --noEmit; echo "exit=$?"`.

- [ ] **Step 5: Commit**

```bash
git add src/features/planner
git commit -m "feat: Today planner screen and plan settings"
```

---

### Task 6: Diagnostic screen

**Files:**
- Create: `src/features/diagnostic/Diagnostic.tsx`
- Test: `src/features/diagnostic/Diagnostic.test.tsx`

**Interfaces:**
- Consumes: Task 1 engine (`sampleDiagnostic`, `summarizeRun`, `DIAGNOSTIC_SIZE`), `latestPerQuestion` (Task 2), Task 4 queries (`fetchQuestions`, `fetchAttempts`, `fetchRuns`, `createRun`, `setRunStatus`, `fetchRunAttempts`, `saveAttempts`, `queryError` code `'23505'`), `gradeAnswer` from `engine/mcq`, `Rich`, `ItemImage`, `useToast`.
- Produces: `Diagnostic({ load?, deps? })` where `deps` bundles `{ createRun, setRunStatus, fetchRunAttempts, saveAttempts }` for tests (defaults are the real functions).

Behavior (all covered by tests below):
- No run yet: intro text and a "Start diagnostic" button. Starting draws `sampleDiagnostic(questions, seenIds, seed)` where `seed` is a fresh uuid and `seenIds` = ids with an attempt (from `fetchAttempts`), calls `createRun(ids, seed)`, then shows the first question.
- In progress: shows "N of M answered", the first unanswered question in run order (answers already saved in the database for this run are skipped), choices, no explanation and no correctness mark. Choosing an answer saves it immediately with `saveAttempts([{ question_id, chosen, correct, duration_ms, mode: 'timed', session_id: run.id }])`; a save error with code `23505` counts as already saved; any other error shows a toast with Retry and keeps the question unanswered; a ref guards double clicks.
- "Pause" ends the sitting: shows the questions answered in this sitting with the chosen answer, the correct answer and the explanation (plus pt-BR toggle), then "Back" returns to the run home with a "Resume" button.
- When the last question is answered: `setRunStatus(run.id, 'completed')`, then the sitting review, then the results.
- Results (completed run): overall "X of Y correct", a per-system list from `summarizeRun` showing answered, correct, percent or "not answered", and "low confidence" for fewer than 5 answered; a "Start another diagnostic" button.
- "Start over" (in progress) asks `window.confirm`, then `setRunStatus(run.id, 'abandoned')` and returns to the intro.
- Load failure shows "Could not load" and a Retry button.

- [ ] **Step 1: Write the failing tests** (inject `load` returning `{ questions, attempts, runs }`; inject `deps` with `vi.fn()` mocks):
  1. Start creates a run of the right size (use 12 questions and `DIAGNOSTIC_SIZE` capped to the supply) and shows the first question with no explanation.
  2. Answering saves one row with `mode: 'timed'` and `session_id` equal to the run id.
  3. Resume: `runs` has an in-progress run and `fetchRunAttempts` returns two answered ids; the screen says "2 of N answered" and starts at the first unanswered question; no answer is saved twice (`saveAttempts` not called for the two).
  4. Double click on one choice calls `saveAttempts` once.
  5. A `23505` error is treated as saved (the screen moves on, no toast); another error shows a toast, keeps the question, and Retry saves it.
  6. Pause shows the sitting review with the explanation; "Back" then shows "Resume".
  7. Answering the last question calls `setRunStatus(id, 'completed')` and shows results with the correct per-system numbers and a "low confidence" label for a system with fewer than 5 answers.
  8. "Start over" with confirm=false does nothing; with confirm=true calls `setRunStatus(id, 'abandoned')`.
  9. A completed latest run with no active run shows its results and the "Start another diagnostic" button.
  10. A system with 2 questions: the draw includes both and starting does not error.

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/features/diagnostic; echo "exit=$?"`.

- [ ] **Step 3: Implement** `Diagnostic.tsx` following the behavior list. Reuse the `uuid()` helper pattern from `Questions.tsx`: either move it to a tiny exported `src/ui/uuid.ts` and import it from both files (update `Questions.tsx` to import it; no behavior change) or duplicate the ten lines, preferring the shared helper. Keep state in small pieces (`view: 'home' | 'question' | 'review' | 'results'`, `run`, `answeredIds: Set<string>`, `sitting: Answer[]`), keep refs for the in-flight guard and `alive`, and compute results with `summarizeRun(runQuestions, fetchRunAttempts rows)`.

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/features/diagnostic; echo "exit=$?"`; `npx tsc --noEmit; echo "exit=$?"`; also `npx vitest run src/features/questions` (the shared uuid change must not break it).

- [ ] **Step 5: Commit**

```bash
git add src/features/diagnostic src/ui/uuid.ts src/features/questions/Questions.tsx
git commit -m "feat: pausable diagnostic with resume, sitting review and results"
```

---

### Task 7: Questions preset (planner links)

**Files:**
- Modify: `src/features/questions/Questions.tsx`, `src/App.tsx` (route wrapper only here)
- Test: `src/features/questions/Questions.test.tsx` (add), `src/features/questions/QuestionsRoute.test.tsx` (new)

**Interfaces:**
- `Questions` gains optional props `preset?: { system: string; n: number }` and `loadAttempts?: typeof fetchAttempts` (default `fetchAttempts`; only called when `preset` is set).
- New exported `QuestionsRoute()` in `Questions.tsx`: reads `system` and `n` from `useSearchParams()`; passes `preset` only when `system` is non-empty and `n` is an integer from 1 to 100; otherwise renders `<Questions />` unchanged.

- [ ] **Step 1: Write the failing tests**: with `preset` and attempts loaded, the start screen shows a "Start planned set" button (tutor mode) first; clicking it starts a session of exactly the selected questions (unseen first, only that system, at most `n`); without a preset the screen is unchanged; `loadAttempts` failing falls back to the plain selection without crashing (shows the planned button using all questions in the system); `QuestionsRoute` inside `MemoryRouter initialEntries={['/questions?system=renal&n=3']}` passes the preset; `n=abc`, `n=0`, `n=500` and a missing system render without a preset.

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/features/questions; echo "exit=$?"` (new tests fail, existing pass).

- [ ] **Step 3: Implement.** In `Questions.tsx`: import `useSearchParams` from `react-router-dom`, `fetchAttempts`, and `latestPerQuestion`, `selectForTask` from `../../engine/planner`. Keep a `latest` state loaded once when `preset` is set (`loadAttempts().then(a => setLatest(latestPerQuestion(a))).catch(() => setLatest(new Map()))`). On the start screen, when `preset` is set and the bank has questions in that system, render above the existing buttons:
  `<button onClick={() => start('tutor', selectForTask(bank, latest, preset.system, preset.n))}>Start planned set ({count} questions in {preset.system})</button>` where `count = Math.min(preset.n, bank.filter(q => q.system === preset.system).length)`; if that count is 0 show no planned button. Add:

```tsx
export function QuestionsRoute() {
  const [p] = useSearchParams();
  const system = p.get('system') ?? '';
  const n = Number(p.get('n'));
  const ok = system && Number.isInteger(n) && n >= 1 && n <= 100;
  return <Questions preset={ok ? { system, n } : undefined} />;
}
```
In `App.tsx` replace the questions route element with `<QuestionsRoute />` (import it). Do not change the nav in this task.

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/features/questions; echo "exit=$?"`; `npx vitest run; echo "exit=$?"`; `npx tsc --noEmit; echo "exit=$?"`.

- [ ] **Step 5: Commit**

```bash
git add src/features/questions src/App.tsx
git commit -m "feat: planned question set via URL preset"
```

---

### Task 8: App wiring and landing

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx` (new; mock the feature screens and `fetchRuns`)

**Interfaces:**
- Routes: `/` -> `Home`; `/today` -> `Today`; `/diagnostic` -> `Diagnostic`; `/cards` -> `Flashcards` (moved from `/`); `/questions` -> `QuestionsRoute`; `/notes`, `/search`, `/data` unchanged.
- Nav order: Today, Diagnostic, Cards, Questions, Notes, Search, Import / Export, Sign out.
- `Home`: loads `fetchRuns()`; while loading shows "Loading…"; redirects (`<Navigate replace>`) to `/today` when any run is completed, otherwise to `/diagnostic`; on error redirects to `/today` (the Today screen works without a diagnostic).

- [ ] **Step 1: Write the failing tests**: with a completed run `/` ends on Today; with none it ends on Diagnostic; on a `fetchRuns` rejection it ends on Today; the nav shows the eight links in order; `/cards` renders Flashcards. Search the repo for other references to the old `/` Flashcards route (`grep -rn "NavLink to=\"/\"" src` and tests) and update them.

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/App.test.tsx; echo "exit=$?"`.

- [ ] **Step 3: Implement** the routes, nav and `Home` as described. Because `AuthGate` wraps the router, tests mock `./features/auth/AuthGate` to render children directly (as the other app-level tests do, or add a minimal mock).

- [ ] **Step 4: Run to verify pass**: `npx vitest run; echo "exit=$?"`; `npx tsc --noEmit; echo "exit=$?"`; `npm run build; echo "exit=$?"`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: Today and Diagnostic in the app shell, landing redirect"
```

---

### Task 9: Whole-diff verification, review, release (needs James's approval)

- [ ] **Step 1: Verification** (superpowers:verification-before-completion): `npx vitest run; echo "exit=$?"`, `npx tsc --noEmit; echo "exit=$?"`, `npm run build; echo "exit=$?"`. Read the real output. Confirm the Review Focus tests exist and pass (grep the test names).
- [ ] **Step 2: `/code-review`** on `git diff 1f978d1...HEAD` (spec: the design spec and this plan; standards: `docs/content-guide.md` does not apply to code, so use the plan's Global Constraints and the repo's existing code style). Verify each finding against the code before acting (superpowers:receiving-code-review), fix, re-run Step 1.
- [ ] **Step 3: Manual check in a browser** (`npm run dev`, with James's `.env`): sign in, take the first few diagnostic questions, pause, resume, finish a small run if the content allows, open Today with and without a target date, follow a task link. Report what was and was not exercised.
- [ ] **Step 4: Ask James for approval, in these words:** "Ready to apply the migration to the live Supabase project (two new tables, a unique index on attempts) and push to main so the app deploys. The local RLS tests <passed / were not run because Docker is unavailable>. Approve?" Do nothing further until he says yes.
- [ ] **Step 5: After approval:** apply the migration (`supabase db push`, or the Supabase MCP `apply_migration` with the file's SQL), verify with read-only SQL that both tables, the policies and the index exist, `git push origin main`, wait for the deploy to turn green (`gh run list --limit 1`), and smoke-test the live site. Update the project memory file and the ledger with the new state.
