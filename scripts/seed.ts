import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedFileSchema, type SeedFile } from './seedSchema';

const force = process.argv.includes('--force');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');

const db = createClient(url, key, { auth: { persistSession: false } });
const dir = 'supabase/seed';
let failed = false;

// Validate every file before writing anything, so one bad file can't leave a half-seeded database.
const files: { file: string; data: SeedFile }[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  let json: unknown;
  try { json = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch (e) {
    console.error(`INVALID ${file}: ${(e as Error).message}`);
    failed = true;
    continue;
  }
  const parsed = seedFileSchema.safeParse(json);
  if (!parsed.success) {
    console.error(`INVALID ${file}:`, parsed.error.issues);
    failed = true;
    continue;
  }
  files.push({ file, data: parsed.data });
}
if (failed) { console.error('No files were written.'); process.exit(1); }

for (const { file, data } of files) {
  for (const table of ['cards', 'questions', 'notes'] as const) {
    const rows = data[table];
    if (!rows.length) continue;
    // Seed rows are curated: owner_id stays null (default).
    const { error } = await db.from(table).upsert(rows as Record<string, unknown>[], { onConflict: 'owner_key,slug', ignoreDuplicates: !force });
    if (error) { console.error(`${file}/${table}:`, error.message); failed = true; }
    else console.log(`${file}/${table}: ${rows.length} rows (${force ? 'upsert' : 'insert-new-only'})`);
  }
}
process.exit(failed ? 1 : 0);
