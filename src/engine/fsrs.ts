import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade, type ReviewLog } from 'ts-fsrs';

export { Rating };

// ponytail: fuzz off so scheduling is deterministic; enable_fuzz if card pile-ups appear.
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export type CardStateRow = {
  due: string; stability: number; difficulty: number; elapsed_days: number;
  scheduled_days: number; learning_steps: number; reps: number; lapses: number;
  state: number; last_review: string | null;
};

export const newCard = (now: Date): Card => createEmptyCard(now);

export const rateCard = (card: Card, rating: Grade, now: Date): { card: Card; log: ReviewLog } =>
  scheduler.next(card, now, rating);

export const toRow = (c: Card): CardStateRow => ({
  due: c.due.toISOString(), stability: c.stability, difficulty: c.difficulty,
  elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state,
  last_review: c.last_review ? c.last_review.toISOString() : null,
});

export const fromRow = (r: CardStateRow): Card => ({
  due: new Date(r.due), stability: r.stability, difficulty: r.difficulty,
  elapsed_days: r.elapsed_days, scheduled_days: r.scheduled_days,
  learning_steps: r.learning_steps, reps: r.reps, lapses: r.lapses, state: r.state,
  last_review: r.last_review ? new Date(r.last_review) : undefined,
});
