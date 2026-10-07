import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedFileSchema } from './seedSchema';

const force = process.argv.includes('--force');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');

const db = createClient(url, key, { auth: { persistSession: false } });
const dir = 'supabase/seed';
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const parsed = seedFileSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!parsed.success) {
    console.error(`INVALID ${file}:`, parsed.error.issues);
    failed = true;
    continue;
  }
  for (const table of ['cards', 'questions', 'notes'] as const) {
    const rows = parsed.data[table];
    if (!rows.length) continue;
    // Seed rows are curated: owner_id stays null (default).
    const { error } = await db.from(table).upsert(rows as Record<string, unknown>[], { onConflict: 'owner_key,slug', ignoreDuplicates: !force });
    if (error) { console.error(`${file}/${table}:`, error.message); failed = true; }
    else console.log(`${file}/${table}: ${rows.length} rows (${force ? 'upsert' : 'insert-new-only'})`);
  }
}
process.exit(failed ? 1 : 0);
