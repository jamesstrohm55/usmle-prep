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

describe('images', () => {
  const card = { ...base, front: 'f', back: 'b' };
  const ok = (extra: object) => seedFileSchema.safeParse({ cards: [{ ...card, ...extra }] }).success;
  const credit = 'Jane Doe, CC BY-SA 4.0, https://commons.wikimedia.org/x';
  test('valid relative path with credit', () => expect(ok({ image_url: 'images/ecg/afib-1.jpg', image_credit: credit })).toBe(true));
  test.each(['../x.jpg', '/images/x.jpg', 'images/ECG/x.jpg', 'images/x.gif', 'images/../x.jpg', 'x.jpg'])('rejects %s', (p) =>
    expect(ok({ image_url: p, image_credit: credit })).toBe(false));
  test('https url with valid credit accepted', () => expect(ok({ image_url: 'https://a.org/x.jpg', image_credit: 'Public domain (NIH)' })).toBe(true));
  test('credit required with image', () => expect(ok({ image_url: 'images/x.jpg' })).toBe(false));
  test('credit without permissive license rejected', () => expect(ok({ image_url: 'images/x.jpg', image_credit: 'Jane Doe, all rights reserved' })).toBe(false));
  test('questions enforce the same rules', () => {
    expect(seedFileSchema.safeParse({ questions: [{ ...q, image_url: 'images/x.jpg' }] }).success).toBe(false);
    expect(seedFileSchema.safeParse({ questions: [{ ...q, image_url: 'images/x.jpg', image_credit: 'CC0' }] }).success).toBe(true);
  });
  test('items without images unaffected', () => expect(ok({})).toBe(true));
  test.each(['Jane Doe, CC BY-SA 4.0, https://commons.wikimedia.org/x', 'CC BY 4.0', 'CC0 1.0', 'Public domain', 'public domain (CDC PHIL)', 'CC-BY-SA-3.0'])('accepts credit %s', (c) =>
    expect(ok({ image_url: 'images/x.jpg', image_credit: c })).toBe(true));
  test.each(['CC BY-NC 4.0', 'CC BY-ND', 'CC BY-NC-SA 4.0', 'CC-BY-NC', 'CC BY-NC-ND 4.0', 'All rights reserved', 'not public domain', ''])('rejects credit "%s"', (c) =>
    expect(ok({ image_url: 'images/x.jpg', image_credit: c })).toBe(false));
  test.each(['images/a//b.jpg', 'images/a/.jpg', 'images/.a/b.jpg', 'images/a/b/.png'])('rejects path %s', (p) =>
    expect(ok({ image_url: p, image_credit: 'CC0' })).toBe(false));
});
