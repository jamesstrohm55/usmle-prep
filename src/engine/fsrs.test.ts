import { newCard, rateCard, toRow, fromRow, Rating } from './fsrs';

const t0 = new Date('2026-11-01T09:00:00Z');

test('new card is due immediately', () => {
  expect(newCard(t0).due.getTime()).toBe(t0.getTime());
});

test('Good on a new card schedules it in the future', () => {
  const { card } = rateCard(newCard(t0), Rating.Good, t0);
  expect(card.due.getTime()).toBeGreaterThan(t0.getTime());
  expect(card.reps).toBe(1);
});

test('Again on a mature card increments lapses', () => {
  let c = rateCard(newCard(t0), Rating.Good, t0).card;
  c = rateCard(c, Rating.Good, c.due).card;
  const lapsed = rateCard(c, Rating.Again, c.due).card;
  expect(lapsed.lapses).toBe(c.lapses + 1);
});

test('row round trip preserves dates and numbers', () => {
  const c = rateCard(newCard(t0), Rating.Easy, t0).card;
  const back = fromRow(toRow(c));
  expect(back.due.getTime()).toBe(c.due.getTime());
  expect(back.stability).toBe(c.stability);
  expect(back.last_review?.getTime()).toBe(c.last_review?.getTime());
});

test('new card round trips with null last_review', () => {
  const back = fromRow(toRow(newCard(t0)));
  expect(back.last_review).toBeUndefined();
});
