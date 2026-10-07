import { importCards, importQuestions, buildBackup, type UpsertClient, type TableSpec } from './transfer';

type Call = { table: string; rows: { slug: string }[]; opts: unknown };
// Fake: "existing" slugs are skipped (ignoreDuplicates returns only newly inserted rows).
function fakeClient(opts: { existing?: Set<string>; failOnCall?: number } = {}) {
  const calls: Call[] = [];
  const stored = new Set(opts.existing ?? []);
  const client: UpsertClient = {
    from: (table) => ({
      upsert: (rows, o) => ({
        select: async () => {
          calls.push({ table, rows: rows as { slug: string }[], opts: o });
          if (opts.failOnCall === calls.length) return { data: null, error: { message: 'boom' } };
          const fresh = (rows as { slug: string }[]).filter((r) => !stored.has(r.slug));
          fresh.forEach((r) => stored.add(r.slug));
          return { data: fresh.map((r) => ({ id: r.slug })), error: null };
        },
      }),
    }),
  };
  return { client, calls, stored };
}
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ front: `f${i}`, back: `b${i}` }));

test('chunks 1200 rows into 500/500/200 requests with ignoreDuplicates', async () => {
  const { client, calls } = fakeClient();
  const r = await importCards(client, 'u1', cards(1200));
  expect(calls.map((c) => c.rows.length)).toEqual([500, 500, 200]);
  expect(calls[0].opts).toEqual({ onConflict: 'owner_key,slug', ignoreDuplicates: true });
  expect(r).toMatchObject({ total: 1200, inserted: 1200, existing: 0, processed: 1200 });
  expect(r.error).toBeUndefined();
  expect(calls[0].rows[0]).toMatchObject({ owner_id: 'u1', track: 'step1', front: 'f0' });
});

test('reports inserted vs already-existing counts', async () => {
  const first = fakeClient();
  await importCards(first.client, 'u1', cards(3));
  const again = fakeClient({ existing: first.stored });
  const r = await importCards(again.client, 'u1', cards(5));
  expect(r).toMatchObject({ total: 5, inserted: 2, existing: 3 });
});

test('partial failure reports saved count and resume continues from the failed chunk', async () => {
  const { client, calls } = fakeClient({ failOnCall: 2 });
  const r = await importCards(client, 'u1', cards(1200));
  expect(r.error).toBe('boom');
  expect(r.processed).toBe(500);
  expect(r.inserted).toBe(500);
  const healthy = fakeClient();
  const r2 = await importCards(healthy.client, 'u1', cards(1200), r);
  expect(healthy.calls.map((c) => c.rows.length)).toEqual([500, 200]);
  expect(healthy.calls[0].rows[0].slug).toBe(calls[1].rows[0].slug); // same chunk retried
  expect(r2).toMatchObject({ processed: 1200, inserted: 1200 });
  expect(r2.error).toBeUndefined();
});

test('empty input makes no requests', async () => {
  const { client, calls } = fakeClient();
  expect(await importCards(client, 'u1', [])).toMatchObject({ total: 0, inserted: 0, existing: 0 });
  expect(calls).toHaveLength(0);
});

test('importQuestions maps fields and defaults', async () => {
  const { client, calls } = fakeClient();
  const r = await importQuestions(client, 'u1', [{ stem: 's', choices: ['a', 'b'], correct: 1, explanation: 'e' }]);
  expect(r.inserted).toBe(1);
  expect(calls[0].table).toBe('questions');
  expect(calls[0].rows[0]).toMatchObject({ owner_id: 'u1', system: 'imported', discipline: 'imported', explanation_pt: null, correct: 1 });
});

test('a thrown error from the client is reported, not propagated', async () => {
  const client: UpsertClient = { from: () => ({ upsert: () => ({ select: async () => { throw new Error('network'); } }) }) };
  const r = await importCards(client, 'u1', cards(2));
  expect(r.error).toBe('network');
  expect(r.processed).toBe(0);
});

test('backup pages past 1000 rows and includes only the expected tables', async () => {
  const big = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const seen: TableSpec[] = [];
  const fetchTable = async (spec: TableSpec) => {
    seen.push(spec);
    return spec.name === 'review_log' ? big : [];
  };
  const out = await buildBackup(fetchTable);
  expect((out.review_log as unknown[]).length).toBe(2500);
  expect(Object.keys(out).sort()).toEqual(
    ['attempts', 'card_state', 'exported_at', 'item_reviews', 'my_cards', 'my_notes', 'my_questions', 'review_log'].sort());
  const by = Object.fromEntries(seen.map((s) => [s.name, s]));
  expect(by.review_log.order).toEqual(['id']);
  expect(by.attempts.order).toEqual(['id']);
  expect(by.card_state.order).toEqual(['card_id']);
  expect(by.item_reviews.order).toEqual(['item_kind', 'item_id']);
  expect(by.cards.ownedOnly && by.questions.ownedOnly && by.notes.ownedOnly).toBe(true);
  expect(by.review_log.ownedOnly).toBeFalsy();
});

test('backup propagates a fetch failure instead of producing a partial file', async () => {
  await expect(buildBackup(async (s) => { if (s.name === 'attempts') throw new Error('fail'); return []; })).rejects.toThrow('fail');
});
