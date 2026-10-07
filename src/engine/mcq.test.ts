import { gradeAnswer, summarize, canShowExplanation, timedLimitMs, pickBlock } from './mcq';

test('gradeAnswer marks correct and incorrect', () => {
  expect(gradeAnswer({ id: 'q1', correct: 2 }, 2, 5000).correct).toBe(true);
  expect(gradeAnswer({ id: 'q1', correct: 2 }, 1, 5000).correct).toBe(false);
});

test('summarize counts and lists missed ids', () => {
  const a = [
    gradeAnswer({ id: 'q1', correct: 0 }, 0, 1),
    gradeAnswer({ id: 'q2', correct: 1 }, 0, 1),
  ];
  expect(summarize(a)).toEqual({ total: 2, correct: 1, pct: 50, missedIds: ['q2'] });
});

test('summarize of empty session is zeros, not NaN', () => {
  expect(summarize([])).toEqual({ total: 0, correct: 0, pct: 0, missedIds: [] });
});

test('tutor shows explanation once answered; timed only after finish', () => {
  expect(canShowExplanation('tutor', false, true)).toBe(true);
  expect(canShowExplanation('tutor', false, false)).toBe(false);
  expect(canShowExplanation('timed', false, true)).toBe(false);
  expect(canShowExplanation('timed', true, true)).toBe(true);
});

test('a 40-question block is 60 minutes', () => {
  expect(timedLimitMs(40)).toBe(60 * 60 * 1000);
});

describe('pickBlock', () => {
  const bank = Array.from({ length: 100 }, (_, i) => i);
  const seeded = (seed = 1) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  test('caps at n, keeps items distinct, does not mutate the input', () => {
    const copy = [...bank];
    const out = pickBlock(bank, 40);
    expect(out).toHaveLength(40);
    expect(new Set(out).size).toBe(40);
    expect(out.every((x) => bank.includes(x))).toBe(true);
    expect(bank).toEqual(copy);
  });
  test('is deterministic with an injected rng, and actually shuffles', () => {
    expect(pickBlock(bank, 40, seeded())).toEqual(pickBlock(bank, 40, seeded()));
    expect(pickBlock(bank, 40, seeded())).not.toEqual(bank.slice(0, 40));
  });
  test('n larger than the bank returns every item', () => {
    expect([...pickBlock([1, 2, 3], 40)].sort()).toEqual([1, 2, 3]);
  });
  test('rng at the extremes stays in range', () => {
    expect([...pickBlock([1, 2, 3], 3, () => 0.999999)].sort()).toEqual([1, 2, 3]);
    expect([...pickBlock([1, 2, 3], 3, () => 0)].sort()).toEqual([1, 2, 3]);
  });
  test('empty bank / n=0', () => {
    expect(pickBlock([], 5)).toEqual([]);
    expect(pickBlock([1, 2], 0)).toEqual([]);
  });
});
