export type Mode = 'tutor' | 'timed';
export type Answer = { questionId: string; chosen: number; correct: boolean; durationMs: number };

export const gradeAnswer = (q: { id: string; correct: number }, chosen: number, durationMs: number): Answer => ({
  questionId: q.id, chosen, correct: chosen === q.correct, durationMs,
});

export function summarize(answers: Answer[]) {
  const correct = answers.filter((a) => a.correct).length;
  return {
    total: answers.length,
    correct,
    pct: answers.length ? Math.round((correct / answers.length) * 100) : 0,
    missedIds: answers.filter((a) => !a.correct).map((a) => a.questionId),
  };
}

export const canShowExplanation = (mode: Mode, sessionFinished: boolean, answered: boolean) =>
  mode === 'tutor' ? answered : sessionFinished;

export const timedLimitMs = (questionCount: number) => questionCount * 90_000;

// Unbiased Fisher–Yates over a copy; returns up to n items.
export function pickBlock<T>(bank: readonly T[], n: number, rng: () => number = Math.random): T[] {
  const a = [...bank];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, n));
}
