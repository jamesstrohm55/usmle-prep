import Papa from 'papaparse';
import { z } from 'zod';

export function parseCardsCsv(text: string) {
  const clean = text.replace(/^﻿/, '');
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy', comments: '#' });
  const rows: { front: string; back: string }[] = [];
  const rejected: { line: number; reason: string }[] = [];
  // Slugs derive from the front, so a repeated front would put the same key twice in one upsert (Postgres error).
  const seen = new Set<string>();
  result.data.forEach((cols, i) => {
    const front = (cols[0] ?? '').trim();
    const back = (cols[1] ?? '').trim();
    if (i === 0 && front.toLowerCase() === 'front' && back.toLowerCase() === 'back') return;
    if (!front) return rejected.push({ line: i + 1, reason: 'missing front' });
    if (!back) return rejected.push({ line: i + 1, reason: 'missing back' });
    if (seen.has(front)) return;
    seen.add(front);
    rows.push({ front, back });
  });
  return { rows, rejected };
}

const questionSchema = z.object({
  stem: z.string().min(1), choices: z.array(z.string().min(1)).min(2).max(6),
  correct: z.number().int().min(0), explanation: z.string().min(1),
  explanation_pt: z.string().optional(), system: z.string().optional(), discipline: z.string().optional(),
}).refine((q) => q.correct < q.choices.length, { message: 'correct index out of range' });
export type ParsedQuestion = z.infer<typeof questionSchema>;

export function parseQuestionsJson(text: string) {
  const rows: ParsedQuestion[] = [];
  const rejected: { index: number; reason: string }[] = [];
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return { rows, rejected: [{ index: 0, reason: 'file is not valid JSON' }] }; }
  if (!Array.isArray(data)) return { rows, rejected: [{ index: 0, reason: 'expected a JSON array' }] };
  const seen = new Set<string>();
  data.forEach((item, index) => {
    const r = questionSchema.safeParse(item);
    if (!r.success) return rejected.push({ index, reason: r.error.issues.map((i) => i.message).join('; ') });
    if (seen.has(r.data.stem)) return; // same slug twice in one upsert would error
    seen.add(r.data.stem);
    rows.push(r.data);
  });
  return { rows, rejected };
}

export async function slugFor(prefix: string, text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return `${prefix}-${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
