import { seedFileSchema } from './seedSchema';

const base = { slug: 's', track: 'step1', system: 'cardio', discipline: 'path', tags: [] };
const q = { ...base, stem: 'S', choices: ['a', 'b', 'c'], correct: 1, explanation: 'E' };

test('valid file passes', () => {
  expect(seedFileSchema.safeParse({ questions: [q] }).success).toBe(true);
});

test('correct index out of range fails', () => {
  expect(seedFileSchema.safeParse({ questions: [{ ...q, correct: 3 }] }).success).toBe(false);
});

test('fewer than two choices fails', () => {
  expect(seedFileSchema.safeParse({ questions: [{ ...q, choices: ['a'], correct: 0 }] }).success).toBe(false);
});

test('missing explanation fails', () => {
  const { explanation, ...rest } = q;
  expect(seedFileSchema.safeParse({ questions: [rest] }).success).toBe(false);
});

test('empty card front fails', () => {
  expect(seedFileSchema.safeParse({ cards: [{ ...base, front: '', back: 'b' }] }).success).toBe(false);
});

test('duplicate slugs within a file fail', () => {
  const c = { ...base, front: 'f', back: 'b' };
  expect(seedFileSchema.safeParse({ cards: [c, c] }).success).toBe(false);
});

test('duplicate question slugs within a file fail', () => {
  expect(seedFileSchema.safeParse({ questions: [q, q] }).success).toBe(false);
});

test('duplicate note slugs within a file fail', () => {
  const n = { ...base, title: 't', body_md: 'b' };
  expect(seedFileSchema.safeParse({ notes: [n, n] }).success).toBe(false);
});

test('the same slug across different tables is fine', () => {
  const n = { ...base, title: 't', body_md: 'b' };
  expect(seedFileSchema.safeParse({ notes: [n], questions: [q] }).success).toBe(true);
});
