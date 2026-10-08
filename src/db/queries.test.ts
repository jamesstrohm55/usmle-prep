import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  clear: async () => store.clear(),
}));
let uid: string | null = 'userA';
// Chainable query-builder mock: records every call, resolves (thenable) to `result`.
type Call = [string, unknown[]];
let calls: Call[] = [];
let result: { data: unknown; error: unknown; status?: number } = { data: null, error: null };
const chain = (): unknown => new Proxy({}, {
  get: (_t, name: string) => name === 'then'
    ? (res: (v: unknown) => unknown) => res(result)
    : (...args: unknown[]) => { calls.push([name, args]); return chain(); },
});
vi.mock('./client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null } }) },
    from: (t: string) => { calls.push(['from', [t]]); return chain(); },
  },
}));

import {
  cachedRead, clearCache, queryError, DEFAULT_SETTINGS, fetchSettings, saveSettings, fetchAttempts, fetchReviews,
  fetchRuns, createRun, setRunStatus, fetchRunAttempts,
} from './queries';
import { setLastUserId, clearLastUserId } from './lastUser';

beforeEach(() => { store.clear(); uid = 'userA'; clearLastUserId(); calls = []; result = { data: null, error: null }; });

describe('cachedRead', () => {
  it('returns fetched data and caches it', async () => {
    expect(await cachedRead('cards', async () => [1, 2])).toEqual([1, 2]);
    const offline = async () => { throw new Error('Failed to fetch'); };
    expect(await cachedRead('cards', offline)).toEqual([1, 2]);
  });

  it('rethrows on failure when nothing is cached', async () => {
    await expect(cachedRead('cards', async () => { throw new Error('Failed to fetch'); })).rejects.toThrow('Failed to fetch');
  });

  it.each([
    [{ status: 401 }], [{ status: 403 }], [{ code: 'PGRST301' }], [{ code: 'PGRST303', message: 'JWT expired' }],
  ])('rethrows auth errors even with a cache: %j', async (err) => {
    await cachedRead('cards', async () => ['stale']);
    await expect(cachedRead('cards', async () => { throw queryError({ message: 'x', ...err }); })).rejects.toThrow();
  });

  it('scopes the cache per user', async () => {
    await cachedRead('cards', async () => ['A-data']);
    uid = 'userB';
    await expect(cachedRead('cards', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('uses lastUserId for the cache key when the session is gone (expired, offline)', async () => {
    await cachedRead('cards', async () => ['A-data']);
    setLastUserId('userA');
    uid = null;
    expect(await cachedRead('cards', async () => { throw new Error('offline'); })).toEqual(['A-data']);
  });

  it('keeps users isolated when falling back to lastUserId', async () => {
    await cachedRead('cards', async () => ['A-data']);
    setLastUserId('userB');
    uid = null;
    await expect(cachedRead('cards', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('still rethrows auth errors when using lastUserId', async () => {
    await cachedRead('cards', async () => ['A-data']);
    setLastUserId('userA');
    uid = null;
    await expect(cachedRead('cards', async () => { throw queryError({ message: 'x', status: 401 }); })).rejects.toThrow();
  });

  it('never writes the cache without a session (anon reads return empty, not data)', async () => {
    setLastUserId('userA');
    await cachedRead('cards', async () => ['A-data']);
    store.clear();
    uid = null;
    expect(await cachedRead('cards', async () => [])).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('round-trips Maps', async () => {
    await cachedRead('states', async () => new Map([['c1', { due: 'd' }]]));
    const got = await cachedRead<Map<string, { due: string }>>('states', async () => { throw new Error('offline'); });
    expect(got).toBeInstanceOf(Map);
    expect(got.get('c1')).toEqual({ due: 'd' });
  });

  it('clearCache empties the cache', async () => {
    await cachedRead('cards', async () => [1]);
    await clearCache();
    await expect(cachedRead('cards', async () => { throw new Error('offline'); })).rejects.toThrow();
  });
});

const args = (name: string) => calls.find(([n]) => n === name)?.[1];
const all = (name: string) => calls.filter(([n]) => n === name).map(([, a]) => a);
const fail = () => { result = { data: null, error: { message: 'boom', code: '23505' }, status: 409 }; };

describe('settings', () => {
  it('fetchSettings returns defaults when there is no row', async () => {
    expect(await fetchSettings()).toEqual(DEFAULT_SETTINGS);
    expect(args('from')).toEqual(['study_settings']);
  });
  it('fetchSettings returns the stored row', async () => {
    const row = { target_date: '2026-12-01', minutes_by_weekday: [1, 2, 3, 4, 5, 6, 7] };
    result = { data: row, error: null };
    expect(await fetchSettings()).toEqual(row);
  });
  it('saveSettings upserts with onConflict user_id and updated_at', async () => {
    await saveSettings({ target_date: '2026-12-01', minutes_by_weekday: [1, 2, 3, 4, 5, 6, 7] });
    const [row, opts] = args('upsert') as [Record<string, unknown>, unknown];
    expect(row).toMatchObject({ target_date: '2026-12-01', minutes_by_weekday: [1, 2, 3, 4, 5, 6, 7] });
    expect(typeof row.updated_at).toBe('string');
    expect(opts).toEqual({ onConflict: 'user_id' });
  });
  it('throws on client error (offline cache cannot mask it: no cache entry)', async () => {
    fail();
    await expect(saveSettings(DEFAULT_SETTINGS)).rejects.toThrow('boom');
    await expect(fetchSettings()).rejects.toThrow('boom');
  });
});

describe('attempts and reviews', () => {
  it('fetchAttempts / fetchReviews read their tables', async () => {
    result = { data: [{ question_id: 'q' }], error: null };
    expect(await fetchAttempts()).toEqual([{ question_id: 'q' }]);
    expect(args('from')).toEqual(['attempts']);
    expect(all('order')).toEqual([['id']]);
    calls = [];
    expect(await fetchReviews()).toEqual([{ question_id: 'q' }]);
    expect(args('from')).toEqual(['review_log']);
    expect(all('order')).toEqual([['id']]);
  });
  it('throw on client error', async () => {
    fail();
    await expect(fetchAttempts()).rejects.toThrow('boom');
    await expect(fetchReviews()).rejects.toThrow('boom');
  });
});

describe('diagnostic runs', () => {
  it('fetchRuns is live (not cached) and newest first', async () => {
    result = { data: [{ id: 'r1' }], error: null };
    expect(await fetchRuns()).toEqual([{ id: 'r1' }]);
    expect(args('from')).toEqual(['diagnostic_runs']);
    expect(args('order')).toEqual(['started_at', { ascending: false }]);
    expect(store.size).toBe(0);
  });
  it('createRun inserts question_ids and seed and returns the row', async () => {
    result = { data: { id: 'r1', seed: 's' }, error: null };
    expect(await createRun(['a', 'b'], 's')).toEqual({ id: 'r1', seed: 's' });
    expect(args('from')).toEqual(['diagnostic_runs']);
    expect(args('insert')).toEqual([{ question_ids: ['a', 'b'], seed: 's' }]);
  });
  it("setRunStatus('completed') sends completed_at", async () => {
    await setRunStatus('r1', 'completed');
    expect(args('from')).toEqual(['diagnostic_runs']);
    const [patch] = args('update') as [Record<string, unknown>];
    expect(patch.status).toBe('completed');
    expect(typeof patch.completed_at).toBe('string');
    expect(args('eq')).toEqual(['id', 'r1']);
  });
  it("setRunStatus('abandoned') does not send completed_at", async () => {
    await setRunStatus('r1', 'abandoned');
    expect(args('update')).toEqual([{ status: 'abandoned' }]);
  });
  it('fetchRunAttempts filters on session_id and is live', async () => {
    result = { data: [{ question_id: 'q', chosen: 1, correct: true }], error: null };
    expect(await fetchRunAttempts('r1')).toHaveLength(1);
    expect(args('from')).toEqual(['attempts']);
    expect(all('order')).toEqual([['id']]);
    expect(args('eq')).toEqual(['session_id', 'r1']);
    expect(store.size).toBe(0);
  });
  it('all throw on client error, keeping status and code', async () => {
    fail();
    for (const p of [fetchRuns(), createRun([], 's'), setRunStatus('r', 'completed'), fetchRunAttempts('r')])
      await expect(p).rejects.toMatchObject({ message: 'boom', code: '23505', status: 409 });
  });
});
