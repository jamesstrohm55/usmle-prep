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
    const flag = await vanessa.client.from('item_reviews').insert({ item_kind: 'card', item_id: curatedCardId, status: 'flagged', note: 'wrong' });
    expect(flag.error).toBeNull();
    expect((await boss.client.from('item_reviews').select('*').eq('status', 'flagged')).data!.length).toBeGreaterThan(0);
    expect((await other.client.from('item_reviews').select('*')).data).toEqual([]);
  });

  test('search_content returns visible rows only', async () => {
    const term = `zebrafish${run}`;
    const ins = await admin.from('cards').insert({ ...baseCard, slug: `s-${run}`, front: `${term}-mitral`, back: 'x' });
    expect(ins.error).toBeNull();
    expect((await vanessa.client.rpc('search_content', { q: term })).data).toHaveLength(1);
    expect((await anon.rpc('search_content', { q: term })).data ?? []).toEqual([]);
  });

  test('student cannot promote herself to admin', async () => {
    const r = await vanessa.client.from('profiles').update({ role: 'admin' }).eq('id', vanessa.id).select();
    expect(r.data ?? []).toEqual([]);
    const { data } = await admin.from('profiles').select('role').eq('id', vanessa.id).single();
    expect(data!.role).toBe('student');
  });

  test('student cannot orphan her card to curated (owner_id null)', async () => {
    const { data: mine } = await vanessa.client.from('cards').insert({ ...baseCard, slug: `orph-${run}`, owner_id: vanessa.id }).select('id').single();
    const r = await vanessa.client.from('cards').update({ owner_id: null }).eq('id', mine!.id);
    expect(r.error?.code).toBe('42501');
    const { data } = await admin.from('cards').select('owner_id').eq('id', mine!.id).single();
    expect(data!.owner_id).toBe(vanessa.id);
  });

  test("student cannot update or delete another student's private card", async () => {
    const { data: theirs } = await other.client.from('cards').insert({ ...baseCard, slug: `theirs-${run}`, owner_id: other.id, front: 'orig' }).select('id').single();
    await vanessa.client.from('cards').update({ front: 'hacked' }).eq('id', theirs!.id);
    await vanessa.client.from('cards').delete().eq('id', theirs!.id);
    const { data } = await admin.from('cards').select('front').eq('id', theirs!.id).single();
    expect(data!.front).toBe('orig');
  });

  test('anon cannot insert cards or card_state', async () => {
    const c = await anon.from('cards').insert({ ...baseCard, slug: `anon-${run}` });
    expect(c.error?.code).toBe('42501');
    const s = await anon.from('card_state').insert({
      user_id: vanessa.id, card_id: curatedCardId, due: new Date().toISOString(), stability: 1, difficulty: 5,
      elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 1,
    });
    expect(s.error?.code).toBe('42501');
  });

  test('review_log and attempts are append-only for students', async () => {
    const { data: q } = await admin.from('questions').insert({
      track: 'step1', system: 'cardio', discipline: 'path', slug: `q-${run}`, stem: 's', choices: ['a', 'b'], correct: 0, explanation: 'e',
    }).select('id').single();
    const log = await vanessa.client.from('review_log').insert({ card_id: curatedCardId, rating: 3, duration_ms: 100 });
    expect(log.error).toBeNull();
    const att = await vanessa.client.from('attempts').insert({ question_id: q!.id, chosen: 0, correct: true, duration_ms: 100, mode: 'tutor', session_id: crypto.randomUUID() });
    expect(att.error).toBeNull();
    expect((await vanessa.client.from('review_log').select('*')).data!.length).toBeGreaterThan(0);
    expect((await vanessa.client.from('attempts').select('*')).data!.length).toBeGreaterThan(0);

    await vanessa.client.from('review_log').update({ rating: 1 }).eq('card_id', curatedCardId);
    await vanessa.client.from('review_log').delete().eq('card_id', curatedCardId);
    await vanessa.client.from('attempts').update({ correct: false }).eq('question_id', q!.id);
    await vanessa.client.from('attempts').delete().eq('question_id', q!.id);
    const rl = await admin.from('review_log').select('rating').eq('user_id', vanessa.id);
    expect(rl.data!.map((r) => r.rating)).toEqual([3]);
    const at = await admin.from('attempts').select('correct').eq('user_id', vanessa.id);
    expect(at.data!.map((r) => r.correct)).toEqual([true]);
  });

  test('logged-out client reads nothing, even when per-user rows exist', async () => {
    // Runs after the tests above, so card_state, review_log, attempts, item_reviews all hold rows for vanessa.
    for (const t of ['card_state', 'review_log', 'attempts', 'item_reviews']) {
      expect((await admin.from(t).select('*').eq('user_id', vanessa.id)).data!.length).toBeGreaterThan(0);
    }
    for (const t of ['cards', 'questions', 'notes', 'profiles', 'card_state', 'review_log', 'attempts', 'item_reviews']) {
      const { data, error } = await anon.from(t).select('*');
      expect(error?.code === '42501' || (data ?? []).length === 0, `${t} leaked rows`).toBe(true);
    }
  });

  test('study_settings: own row only, bad minutes rejected', async () => {
    const ok = await vanessa.client.from('study_settings').insert({ target_date: '2027-01-15' });
    expect(ok.error).toBeNull();
    expect((await other.client.from('study_settings').select('*')).data).toEqual([]);
    const forged = await other.client.from('study_settings').insert({ user_id: vanessa.id });
    expect(forged.error?.code).toBe('42501');
    const bad = await other.client.from('study_settings').insert({ minutes_by_weekday: [1, 2, 3] });
    expect(bad.error?.code).toBe('23514');
    const big = await other.client.from('study_settings').insert({ minutes_by_weekday: [0, 0, 0, 0, 0, 0, 601] });
    expect(big.error?.code).toBe('23514');
    const nul = await other.client.from('study_settings').insert({ minutes_by_weekday: [60, null, 60, 60, 60, 180, 180] });
    expect(nul.error?.code).toBe('23514');
  });

  test('diagnostic_runs: private, one in-progress run per user, status can move to completed', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const a = await vanessa.client.from('diagnostic_runs').insert({ question_ids: ids, seed: 's1' }).select('id').single();
    expect(a.error).toBeNull();
    const second = await vanessa.client.from('diagnostic_runs').insert({ question_ids: ids, seed: 's2' });
    expect(second.error?.code).toBe('23505');
    const steal = await vanessa.client.from('diagnostic_runs').update({ user_id: other.id }).eq('id', a.data!.id).select();
    expect(steal.error !== null || steal.data!.length === 0).toBe(true);
    expect((await admin.from('diagnostic_runs').select('user_id').eq('id', a.data!.id).single()).data!.user_id).toBe(vanessa.id);
    expect((await other.client.from('diagnostic_runs').select('*')).data).toEqual([]);
    const done = await vanessa.client.from('diagnostic_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', a.data!.id).select();
    expect(done.data).toHaveLength(1);
    const again = await vanessa.client.from('diagnostic_runs').insert({ question_ids: ids, seed: 's3' });
    expect(again.error).toBeNull();
  });

  test('attempts: the same question cannot be answered twice in one session', async () => {
    const { data: q } = await admin.from('questions').insert({ track: 'step1', system: 'cardio', discipline: 'path', slug: `dq-${run}`, stem: 's', choices: ['a', 'b'], correct: 0, explanation: 'e' }).select('id').single();
    const session_id = crypto.randomUUID();
    const row = { question_id: q!.id, chosen: 0, correct: true, mode: 'timed', session_id };
    expect((await vanessa.client.from('attempts').insert(row)).error).toBeNull();
    expect((await vanessa.client.from('attempts').insert(row)).error?.code).toBe('23505');
  });
});
