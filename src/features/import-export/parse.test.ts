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
  expect(r.rejected).toEqual([{ index: 2, reason: expect.any(String) }]); // 1-based
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

test('duplicate fronts within one file keep the first and are reported, not silently dropped', () => {
  const r = parseCardsCsv('a,1\na,2\nb,3\n');
  expect(r.rows).toEqual([{ front: 'a', back: '1' }, { front: 'b', back: '3' }]);
  expect(r.rejected).toEqual([{ row: 2, reason: 'duplicate front' }]);
});

test('tab-separated file without header lines and quoted tab content', () => {
  const r = parseCardsCsv('x\ty\n"p\tq"\tz\n');
  expect(r.rows).toEqual([{ front: 'x', back: 'y' }, { front: 'p\tq', back: 'z' }]);
});

const ANKI = [
  '#separator:tab', '#html:true', '#guid column:1', '#notetype column:2', '#deck column:3', '#tags column:4',
  'k8$Zq1\tBasic\tStep1::Cardio\thigh-yield cardio\tWhat is <b>Beck&#39;s</b> triad?<br>(3 signs)\tHypotension&nbsp;&amp; JVD<div>muffled heart sounds</div>',
  'm2Xp9\tBasic\tStep1::Cardio\t\tWhat is <i>tamponade</i>?\t<p>Fluid in the pericardium</p>',
].join('\n');

test('Anki export: drops guid/notetype/deck/tags columns and converts HTML to text', () => {
  const r = parseCardsCsv(ANKI);
  expect(r.rejected).toEqual([]);
  expect(r.rows).toEqual([
    { front: "What is Beck's triad?\n(3 signs)", back: 'Hypotension & JVD\nmuffled heart sounds' },
    { front: 'What is tamponade?', back: 'Fluid in the pericardium' },
  ]);
});

test('Anki columns are dropped even when only some directives are present and not in order', () => {
  const r = parseCardsCsv('#separator:tab\n#tags column:1\n#guid column:3\nt\tF\tg\tB\n');
  expect(r.rows).toEqual([{ front: 'F', back: 'B' }]);
});

test.each([
  ['#separator:Tab', '\t'], ['#separator:semicolon', ';'], ['#separator:pipe', '|'],
  ['#separator:comma', ','], ['#separator:space', ' '], ['#separator:;', ';'],
])('separator directive %s', (dir, sep) => {
  const r = parseCardsCsv(`${dir}\nfront${sep}back\nx${sep}y\n`);
  expect(r.rows).toEqual([{ front: 'x', back: 'y' }]);
});

test('separator directive wins over auto-detection when fields contain other delimiters', () => {
  const r = parseCardsCsv('#separator:semicolon\nBeck, triad;hypotension, JVD\n');
  expect(r.rows).toEqual([{ front: 'Beck, triad', back: 'hypotension, JVD' }]);
});

test('html:false leaves tags and entities as typed', () => {
  const r = parseCardsCsv('#html:false\n<b>x</b> &amp;\ty\n');
  expect(r.rows).toEqual([{ front: '<b>x</b> &amp;', back: 'y' }]);
});

test('HTML is never executed: script/style content is dropped, tags stripped', () => {
  const r = parseCardsCsv('#separator:tab\n#html:true\n<script>alert(1)</script><img src=x onerror=alert(1)>hi\t<style>p{}</style>ok\n');
  expect(r.rows).toEqual([{ front: 'hi', back: 'ok' }]);
});

test('rejections say "row N" using data-row numbers; duplicates are reported', () => {
  const r = parseCardsCsv('#separator:tab\n\na\t1\n\nb\t\na\t2\n\t3\n');
  expect(r.rows).toEqual([{ front: 'a', back: '1' }]);
  expect(r.rejected).toEqual([
    { row: 2, reason: 'missing back' }, { row: 3, reason: 'duplicate front' }, { row: 4, reason: 'missing front' },
  ]);
});

test('whole-file question JSON problems use index 0, item problems are 1-based', () => {
  expect(parseQuestionsJson('{}').rejected).toEqual([{ index: 0, reason: 'expected a JSON array' }]);
  expect(parseQuestionsJson('[{}]').rejected[0].index).toBe(1);
});
