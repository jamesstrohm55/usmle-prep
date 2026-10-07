import { gradeAnswer, summarize, canShowExplanation, timedLimitMs } from './mcq';

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
