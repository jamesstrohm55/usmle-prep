import { slugFor, type ParsedQuestion } from './parse';

export const CHUNK = 500;

type Res = { data: { id: string }[] | null; error: { message: string } | null };
/** Minimal slice of the Supabase client that imports need (injectable in tests). */
export interface UpsertClient {
  from(table: 'cards' | 'questions'): {
    upsert(rows: object[], opts: { onConflict: string; ignoreDuplicates: boolean }): { select(cols: string): PromiseLike<Res> };
  };
}

export type ImportProgress = { total: number; processed: number; inserted: number; existing: number; error?: string };

async function upsertChunked(
  client: UpsertClient, table: 'cards' | 'questions', payload: object[], resume?: ImportProgress,
): Promise<ImportProgress> {
  const p: ImportProgress = { total: payload.length, processed: resume?.processed ?? 0, inserted: resume?.inserted ?? 0, existing: resume?.existing ?? 0 };
  while (p.processed < payload.length) {
    const chunk = payload.slice(p.processed, p.processed + CHUNK);
    try {
      // With ignoreDuplicates only newly inserted rows come back, so data.length = new rows.
      const { data, error } = await client.from(table)
        .upsert(chunk, { onConflict: 'owner_key,slug', ignoreDuplicates: true }).select('id');
      if (error) return { ...p, error: error.message };
      const added = data?.length ?? 0;
      p.inserted += added;
      p.existing += chunk.length - added;
      p.processed += chunk.length;
    } catch (e) {
      return { ...p, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return p;
}

/** Pass the previous (failed) result as `resume` to continue from the failed chunk. */
export async function importCards(client: UpsertClient, ownerId: string, rows: { front: string; back: string }[], resume?: ImportProgress) {
  const payload = await Promise.all(rows.map(async (r) => ({
    slug: await slugFor('card', r.front), owner_id: ownerId, track: 'step1', system: 'imported', discipline: 'imported', front: r.front, back: r.back,
  })));
  return upsertChunked(client, 'cards', payload, resume);
}

export async function importQuestions(client: UpsertClient, ownerId: string, rows: ParsedQuestion[], resume?: ImportProgress) {
  const payload = await Promise.all(rows.map(async (r) => ({
    slug: await slugFor('q', r.stem), owner_id: ownerId, track: 'step1', system: r.system ?? 'imported', discipline: r.discipline ?? 'imported',
    stem: r.stem, choices: r.choices, correct: r.correct, explanation: r.explanation, explanation_pt: r.explanation_pt ?? null,
  })));
  return upsertChunked(client, 'questions', payload, resume);
}

export type TableSpec = { name: string; order: string[]; ownedOnly?: boolean };
// Per-user tables rely on RLS; content tables also hold shared rows, so only owner_id-not-null rows are backed up.
export const BACKUP_TABLES: TableSpec[] = [
  { name: 'card_state', order: ['card_id'] },
  { name: 'review_log', order: ['id'] },
  { name: 'attempts', order: ['id'] },
  { name: 'item_reviews', order: ['item_kind', 'item_id'] },
  { name: 'cards', order: ['id'], ownedOnly: true },
  { name: 'questions', order: ['id'], ownedOnly: true },
  { name: 'notes', order: ['id'], ownedOnly: true },
];

/** `fetchTable` must return ALL rows (paged); any rejection aborts so a partial backup is never produced. */
export async function buildBackup(fetchTable: (spec: TableSpec) => Promise<unknown[]>) {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const spec of BACKUP_TABLES) out[spec.ownedOnly ? `my_${spec.name}` : spec.name] = await fetchTable(spec);
  return out;
}

export function describeImport(noun: string, p: ImportProgress, rejected: string[]) {
  const head = `${p.inserted} new ${noun} imported, ${p.existing} already existed, ${rejected.length} rejected`;
  return head + (p.error ? `\nStopped after ${p.processed} of ${p.total} saved: ${p.error}` : '') + rejected.map((r) => `\n  ${r}`).join('');
}
