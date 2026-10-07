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
