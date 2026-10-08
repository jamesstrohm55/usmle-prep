import { translate } from './lang';
import { PT } from './pt';

test('English renders as written, with placeholders filled', () => {
  expect(translate('en', 'Answer {n} {s} questions', { n: 5, s: 'Renal' })).toBe('Answer 5 Renal questions');
  expect(translate('en', 'No placeholders')).toBe('No placeholders');
});

test('Portuguese uses the dictionary and falls back to English for a missing entry', () => {
  expect(translate('pt', 'Rebuild plan')).toBe('Refazer plano');
  expect(translate('pt', 'Answer {n} {s} questions', { n: 5, s: 'Renal' })).toBe('Responder 5 questões de Renal');
  expect(translate('pt', 'Something not translated yet')).toBe('Something not translated yet');
});

test('every Portuguese entry keeps the same placeholders as its English key', () => {
  const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const [en, pt] of Object.entries(PT)) expect([en, names(pt)]).toEqual([en, names(en)]);
});

test('every text passed to tr() in the source has a Portuguese entry', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files: string[] = [];
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'pt.ts') files.push(p);
  });
  walk('src');
  // tr() is also called with variables (weekday names, card grades, item kinds, error subjects): listed here.
  const dynamic = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Again', 'Hard', 'Good', 'Easy', 'card', 'question', 'note', 'Google account', 'email', 'Could not save your answer', 'Could not save results',
    // body-system names as produced by systemLabel()
    'Cardiovascular', 'Respiratory', 'Renal', 'Gastrointestinal', 'Endocrine', 'Reproductive', 'Nervous', 'Hematology & oncology', 'Psychiatry',
    'Behavioral science', 'Biostatistics & epidemiology', 'Musculoskeletal & dermatology', 'Biochemistry & genetics', 'Immunology', 'Microbiology', 'General principles'];
  const used = new Set<string>(dynamic);
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\btr\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) used.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  }
  const missing = [...used].filter((k) => !(k in PT));
  expect(missing).toEqual([]);
});
