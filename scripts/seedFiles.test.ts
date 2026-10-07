import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedFileSchema } from './seedSchema';

const dir = 'supabase/seed';
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('there is at least one seed file', () => expect(files.length).toBeGreaterThan(0));

test.each(files)('%s parses and passes seedFileSchema', (file) => {
  const parsed = seedFileSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
});
