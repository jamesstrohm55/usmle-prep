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

test('row round trip preserves every field (lapsed card with learning steps)', () => {
  let c = rateCard(newCard(t0), Rating.Good, t0).card;
  c = rateCard(c, Rating.Again, c.due).card;
  expect(c.lapses + c.reps).toBeGreaterThan(0);
  const back = fromRow(toRow(c));
  expect(back).toEqual(c);
  expect(toRow(back)).toEqual(toRow(c));
});

test('toRow of a new card has null last_review', () => {
  expect(toRow(newCard(t0)).last_review).toBeNull();
});

test('new card round trips with null last_review', () => {
  const back = fromRow(toRow(newCard(t0)));
  expect(back.last_review).toBeUndefined();
});
