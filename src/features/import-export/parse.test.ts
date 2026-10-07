import { parseCardsCsv, parseQuestionsJson, slugFor } from './parse';

test('parses tab-separated Anki export, skipping # header lines and blanks', () => {
  const text = '#separator:tab\n#html:false\nFront one\tBack one\n\nFront two\tBack two\n';
  expect(parseCardsCsv(text).rows).toEqual([
    { front: 'Front one', back: 'Back one' }, { front: 'Front two', back: 'Back two' },
  ]);
});

test('handles BOM, CRLF, and quoted commas and newlines in CSV', () => {
  const text = '﻿front,back\r\n"Beck, triad","hypotension,\nJVD"\r\n';
  const r = parseCardsCsv(text);
  expect(r.rows).toEqual([{ front: 'Beck, triad', back: 'hypotension,\nJVD' }]);
});

test('skips a literal header row and rejects rows missing a side', () => {
  const r = parseCardsCsv('front,back\nonly-front,\nok,fine\n');
  expect(r.rows).toEqual([{ front: 'ok', back: 'fine' }]);
  expect(r.rejected).toHaveLength(1);
  expect(r.rejected[0].reason).toMatch(/back/i);
});

test('empty file yields nothing and no crash', () => {
  expect(parseCardsCsv('')).toEqual({ rows: [], rejected: [] });
});

test('questions JSON: valid and invalid items reported separately', () => {
  const good = { stem: 's', choices: ['a', 'b'], correct: 1, explanation: 'e' };
  const bad = { stem: 's', choices: ['a'], correct: 0, explanation: 'e' };
  const r = parseQuestionsJson(JSON.stringify([good, bad]));
  expect(r.rows).toHaveLength(1);
  expect(r.rejected).toEqual([{ index: 1, reason: expect.any(String) }]);
});

test('questions JSON: not JSON gives one rejection, not a throw', () => {
  expect(parseQuestionsJson('not json').rejected).toHaveLength(1);
});

test('slugFor is deterministic and prefix-scoped', async () => {
  expect(await slugFor('card', 'hello')).toBe(await slugFor('card', 'hello'));
  expect(await slugFor('card', 'hello')).not.toBe(await slugFor('card', 'world'));
  expect(await slugFor('card', 'hello')).toMatch(/^card-[0-9a-f]{40}$/);
});

// Review focus: re-import, same-front duplicates inside one file, mixed quirks
test('same file parsed twice yields identical rows', () => {
  const t = '﻿#x\r\nfront,back\r\na,b\r\n\r\nc,d\r\n';
  expect(parseCardsCsv(t)).toEqual(parseCardsCsv(t));
  expect(parseCardsCsv(t).rows).toHaveLength(2);
});

test('duplicate fronts within one file collapse to the first', () => {
  const r = parseCardsCsv('a,1\na,2\nb,3\n');
  expect(r.rows).toEqual([{ front: 'a', back: '1' }, { front: 'b', back: '3' }]);
});

test('tab-separated file without header lines and quoted tab content', () => {
  const r = parseCardsCsv('x\ty\n"p\tq"\tz\n');
  expect(r.rows).toEqual([{ front: 'x', back: 'y' }, { front: 'p\tq', back: 'z' }]);
});
