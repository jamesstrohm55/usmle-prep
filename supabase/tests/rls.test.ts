import { createClient, type SupabaseClient } from '@supabase/supabase-js';

describe.skipIf(!process.env.LOCAL_API_URL)('RLS (needs local Supabase)', () => {
  const url = process.env.LOCAL_API_URL ?? 'http://skipped';
  const anonKey = process.env.LOCAL_ANON_KEY ?? 'skipped';
  const serviceKey = process.env.LOCAL_SERVICE_KEY ?? 'skipped';
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  async function userClient(email: string, role: 'student' | 'admin'): Promise<{ client: SupabaseClient; id: string }> {
    const password = 'test-password-123';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    if (role === 'admin') await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: e2 } = await client.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    return { client, id: data.user.id };
  }

  const run = Date.now();
  let vanessa: Awaited<ReturnType<typeof userClient>>;
  let other: Awaited<ReturnType<typeof userClient>>;
  let boss: Awaited<ReturnType<typeof userClient>>;
  let curatedCardId: string;
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const baseCard = { track: 'step1', system: 'cardio', discipline: 'path', front: 'f', back: 'b' };

  beforeAll(async () => {
    vanessa = await userClient(`v-${run}@test.dev`, 'student');
    other = await userClient(`o-${run}@test.dev`, 'student');
    boss = await userClient(`a-${run}@test.dev`, 'admin');
    const { data, error } = await admin.from('cards').insert({ ...baseCard, slug: `cur-${run}` }).select('id').single();
    if (error) throw error;
    curatedCardId = data.id;
  });

  test('logged-out client reads nothing', async () => {
    for (const t of ['cards', 'questions', 'notes', 'card_state', 'attempts', 'item_reviews']) {
      const { data } = await anon.from(t).select('*');
      expect(data ?? []).toEqual([]);
    }
  });

  test('student reads curated content', async () => {
    const { data } = await vanessa.client.from('cards').select('id').eq('id', curatedCardId);
    expect(data).toHaveLength(1);
  });

  test('student cannot write curated content (owner_id null)', async () => {
    const { error } = await vanessa.client.from('cards').insert({ ...baseCard, slug: `bad-${run}` });
    expect(error).not.toBeNull();
  });

  test('student cannot write content owned by someone else', async () => {
    const { error } = await vanessa.client.from('cards').insert({ ...baseCard, slug: `bad2-${run}`, owner_id: other.id });
    expect(error).not.toBeNull();
  });

  test('student cannot edit or delete curated content', async () => {
    await vanessa.client.from('cards').update({ front: 'hacked' }).eq('id', curatedCardId);
    await vanessa.client.from('cards').delete().eq('id', curatedCardId);
    const { data } = await admin.from('cards').select('front').eq('id', curatedCardId).single();
    expect(data!.front).toBe('f');
  });

  test('student can import private content and others cannot see it', async () => {
    const { error } = await vanessa.client.from('cards').insert({ ...baseCard, slug: `mine-${run}`, owner_id: vanessa.id });
    expect(error).toBeNull();
    const { data } = await other.client.from('cards').select('id').eq('slug', `mine-${run}`);
    expect(data).toEqual([]);
  });

  test('per-user progress is private', async () => {
    const row = {
      card_id: curatedCardId, due: new Date().toISOString(), stability: 1, difficulty: 5,
      elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 1,
    };
    const { error } = await vanessa.client.from('card_state').insert(row);
    expect(error).toBeNull();
    expect((await other.client.from('card_state').select('*')).data).toEqual([]);
    const forged = await other.client.from('card_state').insert({ ...row, user_id: vanessa.id });
    expect(forged.error).not.toBeNull();
  });

  test('admin can write curated content; student flags are visible to admin only', async () => {
    const { error } = await boss.client.from('cards').insert({ ...baseCard, slug: `adm-${run}` });
    expect(error).toBeNull();
    await vanessa.client.from('item_reviews').insert({ item_kind: 'card', item_id: curatedCardId, status: 'flagged', note: 'wrong' });
    expect((await boss.client.from('item_reviews').select('*').eq('status', 'flagged')).data!.length).toBeGreaterThan(0);
    expect((await other.client.from('item_reviews').select('*')).data).toEqual([]);
  });

  test('search_content returns visible rows only', async () => {
    await admin.from('cards').insert({ ...baseCard, slug: `s-${run}`, front: 'zebrafish-mitral', back: 'x' });
    expect((await vanessa.client.rpc('search_content', { q: 'zebrafish' })).data).toHaveLength(1);
    expect((await anon.rpc('search_content', { q: 'zebrafish' })).data ?? []).toEqual([]);
  });
});
