import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedFileSchema } from './seedSchema';

const dir = 'supabase/seed';
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('there is at least one seed file', () => expect(files.length).toBeGreaterThan(0));

test.each(files)('%s parses and passes seedFileSchema', (file) => {
  const parsed = seedFileSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
});

test('slugs are unique across all seed files', () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const item of [...(data.cards ?? []), ...(data.questions ?? []), ...(data.notes ?? [])]) {
      if (seen.has(item.slug)) dupes.push(`${item.slug} (${seen.get(item.slug)}, ${file})`);
      else seen.set(item.slug, file);
    }
  }
  expect(dupes).toEqual([]);
});

describe('images', () => {
  const walk = (d: string): string[] =>
    !existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const urls = files.flatMap((f) => {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return [...(data.cards ?? []), ...(data.questions ?? [])].map((i) => i.image_url).filter((u): u is string => !!u && !/^https?:/.test(u));
  });

  test('every relative image_url exists under public/', () => {
    expect(urls.filter((u) => !existsSync(join('public', u)))).toEqual([]);
  });
  test('every file under public/images is referenced or listed in ATTRIBUTION.md', () => {
    const listed = existsSync('public/images/ATTRIBUTION.md') ? readFileSync('public/images/ATTRIBUTION.md', 'utf8') : '';
    const orphans = walk('public/images').map((p) => p.replace(/^public\//, ''))
      .filter((p) => p !== 'images/ATTRIBUTION.md' && !urls.includes(p) && !listed.includes(p));
    expect(orphans).toEqual([]);
  });
});
