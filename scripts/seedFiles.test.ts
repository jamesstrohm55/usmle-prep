import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const imgDir = join(root, 'public/images');
  const walk = (d: string): string[] =>
    !existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const urls = files.flatMap((f) => {
    const data = JSON.parse(readFileSync(join(root, dir, f), 'utf8'));
    return [...(data.cards ?? []), ...(data.questions ?? [])].map((i) => i.image_url).filter((u): u is string => !!u && !/^https?:/.test(u));
  });
  const imageFiles = walk(imgDir).filter((p) => !basename(p).startsWith('.') && basename(p) !== 'ATTRIBUTION.md');

  test('every relative image_url exists under public/', () => {
    expect(urls.filter((u) => !existsSync(join(root, 'public', u)))).toEqual([]);
  });
  test('every file under public/images is referenced by a seed item', () => {
    expect(imageFiles.map((p) => relative(join(root, 'public'), p)).filter((p) => !urls.includes(p))).toEqual([]);
  });
  test('image files are jpg/jpeg/png/webp and at most 300 KB', () => {
    expect(imageFiles.filter((p) => !/\.(jpg|jpeg|png|webp)$/.test(p) || statSync(p).size > 300 * 1024)).toEqual([]);
  });
});
