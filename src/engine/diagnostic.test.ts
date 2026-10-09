import { SYSTEM_WEIGHTS, weightOf } from './blueprint';
import { allocate, sampleDiagnostic, summarizeRun, seededRng, weakestFirst, DIAGNOSTIC_SIZE } from './diagnostic';

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

const res = (system: string, answered: number, correct: number) => ({
  system, total: answered || 4, answered, correct, accuracy: answered ? correct / answered : null, lowConfidence: answered < 5,
});

test('weakestFirst: enough-data systems by accuracy, then low-confidence ones, then unanswered; ties by exam weight', () => {
  const out = weakestFirst([
    res('endocrine', 6, 6), res('cardiovascular', 8, 4), res('renal', 2, 0), res('nervous', 8, 4), res('psychiatry', 0, 0), res('immunology', 5, 3),
  ]).map((r) => r.system);
  // 50% cardio and nervous tie (nervous and cardiovascular weights are both 9, then alphabetical), 60% immunology, 100% endocrine;
  // then the low-confidence renal; then the unanswered psychiatry.
  expect(out).toEqual(['cardiovascular', 'nervous', 'immunology', 'endocrine', 'renal', 'psychiatry']);
});

test('weakestFirst does not change its input', () => {
  const input = [res('renal', 8, 2), res('endocrine', 8, 8)];
  weakestFirst(input);
  expect(input.map((r) => r.system)).toEqual(['renal', 'endocrine']);
});
