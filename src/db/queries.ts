import { get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import { supabase } from './client';
import { getLastUserId } from './lastUser';
import type { Card, Question, Note, ItemStatus } from './models';
import type { CardStateRow } from '../engine/fsrs';

type Res<T> = { data: T | null; error: { message: string; code?: string } | null; status?: number };

export const queryError = (e: { message: string; code?: string; status?: number }) =>
  Object.assign(new Error(e.message), { code: e.code, status: e.status });

const must = <T>(r: Res<T>): T => {
  if (r.error) throw queryError({ ...r.error, status: r.status });
  return r.data as T;
};

// Auth/permission problems must surface, never be masked by stale cache.
const isAuthError = (e: unknown) => {
  const { status, code, message } = (e ?? {}) as { status?: number; code?: string; message?: string };
  return status === 401 || status === 403 || code === '42501' || /^PGRST30[1-3]$/.test(code ?? '') || /jwt/i.test(message ?? '');
};

const PAGE = 1000; // PostgREST default row cap
export async function pageAll<T>(page: (from: number, to: number) => PromiseLike<Res<T[]>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await page(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function cachedRead<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  const { data } = await supabase.auth.getSession(); // local; works offline
  // After expiry (refresh failed offline) there is no session; fall back to who last signed in.
  const key = `${data.session?.user.id ?? getLastUserId() ?? 'anon'}:${name}`;
  try {
    const result = await fetcher();
    try { await idbSet(key, result instanceof Map ? { __map: [...result] } : result); } catch { /* cache is best-effort */ }
    return result;
  } catch (e) {
    if (isAuthError(e)) throw e;
    const hit = (await idbGet(key).catch(() => undefined)) as unknown;
    if (hit === undefined) throw e;
    return (hit && typeof hit === 'object' && '__map' in hit ? new Map((hit as { __map: [unknown, unknown][] }).__map) : hit) as T;
  }
}

export const clearCache = () => idbClear();

export const fetchCards = () =>
  cachedRead('cards', () => pageAll<Card>((a, b) => supabase.from('cards').select('*').order('created_at').order('id').range(a, b)));
export const fetchQuestions = () =>
  cachedRead('questions', () => pageAll<Question>((a, b) => supabase.from('questions').select('*').order('created_at').order('id').range(a, b)));
export const fetchNotes = () =>
  cachedRead('notes', () => pageAll<Note>((a, b) => supabase.from('notes').select('*').order('title').order('id').range(a, b)));

export const fetchCardStates = () =>
  cachedRead('card_state', async () => {
    const rows = await pageAll<CardStateRow & { card_id: string }>((a, b) => supabase.from('card_state').select('*').order('card_id').range(a, b));
    return new Map<string, CardStateRow & { due: string }>(rows.map((r) => [r.card_id, r as CardStateRow & { due: string }]));
  });

export async function saveReview(cardId: string, row: CardStateRow, rating: number, durationMs: number) {
  must(await supabase.from('card_state').upsert({ card_id: cardId, ...row }, { onConflict: 'user_id,card_id' }).select());
  must(await supabase.from('review_log').insert({ card_id: cardId, rating, duration_ms: durationMs }).select());
}

export type AttemptInsert = { question_id: string; chosen: number; correct: boolean; duration_ms: number; mode: 'tutor' | 'timed'; session_id: string };
export async function saveAttempts(rows: AttemptInsert[]) {
  must(await supabase.from('attempts').insert(rows).select());
}

export async function search(q: string) {
  return must(await supabase.rpc('search_content', { q })) as { kind: 'card' | 'question' | 'note'; id: string; title: string; track: string; system: string }[];
}

export async function setItemStatus(kind: 'card' | 'question' | 'note', id: string, status: ItemStatus, note?: string) {
  must(await supabase.from('item_reviews').upsert({ item_kind: kind, item_id: id, status, note: note ?? null }, { onConflict: 'user_id,item_kind,item_id' }).select());
}
