import Papa from 'papaparse';
import { z } from 'zod';

const SEPARATORS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };

// Anki "Notes in Plain Text" exports open with "#key:value" / "#key column:N" lines.
function readDirectives(lines: string[]) {
  const d = { separator: undefined as string | undefined, html: false, drop: new Set<number>() };
  for (const line of lines) {
    const m = /^#\s*([a-z ]+?)\s*:\s*(.*?)\s*$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2];
    if (key === 'separator') d.separator = SEPARATORS[val.toLowerCase()] ?? (val.length === 1 ? val : undefined);
    else if (key === 'html') d.html = val.toLowerCase() === 'true';
    else if (/^(guid|notetype|deck|tags) column$/.test(key) && Number(val) > 0) d.drop.add(Number(val));
  }
  return d;
}

// HTML -> plain text. Parsed inertly with DOMParser and read back via textContent; never inserted as HTML.
// ponytail: runs of newlines collapse to one, so a deliberate blank line between paragraphs is lost.
function htmlToText(html: string) {
  const withBreaks = html.replace(/<br\s*\/?>|<\/?(div|p)\b[^>]*>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('script,style').forEach((n) => n.remove());
  return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n\s*/g, '\n').trim();
}

export function parseCardsCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  let n = 0;
  while (n < lines.length && lines[n].startsWith('#')) n++;
  const dir = readDirectives(lines.slice(0, n));
  const body = lines.slice(n).join('\n');
  const result = Papa.parse<string[]>(body, { skipEmptyLines: 'greedy', comments: '#', ...(dir.separator ? { delimiter: dir.separator } : {}) });
  const rows: { front: string; back: string }[] = [];
  const rejected: { row: number; reason: string }[] = [];
  // Slugs derive from the front, so a repeated front would put the same key twice in one upsert (Postgres error).
  const seen = new Set<string>();
  result.data.forEach((all, i) => {
    const cols = dir.drop.size ? all.filter((_, c) => !dir.drop.has(c + 1)) : all;
    const tidy = (v: string | undefined) => (dir.html ? htmlToText(v ?? '') : (v ?? '').trim());
    const front = tidy(cols[0]);
    const back = tidy(cols[1]);
    const row = i + 1; // data-row number (blank and # lines don't count)
    if (i === 0 && front.toLowerCase() === 'front' && back.toLowerCase() === 'back') return;
    if (!front) return rejected.push({ row, reason: 'missing front' });
    if (!back) return rejected.push({ row, reason: 'missing back' });
    if (seen.has(front)) return rejected.push({ row, reason: 'duplicate front' });
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
  const rejected: { index: number; reason: string }[] = []; // index is 1-based; 0 = whole-file problem
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return { rows, rejected: [{ index: 0, reason: 'file is not valid JSON' }] }; }
  if (!Array.isArray(data)) return { rows, rejected: [{ index: 0, reason: 'expected a JSON array' }] };
  const seen = new Set<string>();
  data.forEach((item, index) => {
    const r = questionSchema.safeParse(item);
    if (!r.success) return rejected.push({ index: index + 1, reason: r.error.issues.map((i) => i.message).join('; ') });
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
