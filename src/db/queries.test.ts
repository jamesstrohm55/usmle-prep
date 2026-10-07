import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  clear: async () => store.clear(),
}));
let uid: string | null = 'userA';
vi.mock('./client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null } }) } },
}));

import { cachedRead, clearCache, queryError } from './queries';

beforeEach(() => { store.clear(); uid = 'userA'; });

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
