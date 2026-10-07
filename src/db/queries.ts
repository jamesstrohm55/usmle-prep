import { supabase } from './client';
import type { Card, Question, Note, ItemStatus } from './models';
import type { CardStateRow } from '../engine/fsrs';

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export const fetchCards = async () => must(await supabase.from('cards').select('*').order('created_at')) as Card[];
export const fetchQuestions = async () => must(await supabase.from('questions').select('*').order('created_at')) as Question[];
export const fetchNotes = async () => must(await supabase.from('notes').select('*').order('title')) as Note[];

export async function fetchCardStates(): Promise<Map<string, CardStateRow & { due: string }>> {
  const rows = must(await supabase.from('card_state').select('*')) as (CardStateRow & { card_id: string })[];
  return new Map(rows.map((r) => [r.card_id, r]));
}

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
