import { useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

type Cb = (e: string, s: unknown) => void;
let cb: Cb;
const getSession = vi.fn();
vi.mock('../../db/client', () => ({
  supabase: { auth: {
    getSession: () => getSession(),
    onAuthStateChange: (f: Cb) => { cb = f; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithOtp: vi.fn(),
  } },
}));
const clearCache = vi.fn();
vi.mock('../../db/queries', () => ({ clearCache: () => clearCache() }));

import { AuthGate } from './AuthGate';
import { getLastUserId, setLastUserId, markExplicitSignOut } from '../../db/lastUser';

const sess = (id: string) => ({ user: { id } });
let mounts = 0;
function Child() {
  const [n] = useState(() => ++mounts);
  return <p>child-{n}</p>;
}
const ui = <AuthGate><Child /></AuthGate>;

beforeEach(() => { localStorage.clear(); mounts = 0; clearCache.mockReset(); getSession.mockReset(); });

test('no session and no lastUserId shows Login', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(ui);
  expect(await screen.findByText(/sign-in link/i)).toBeTruthy();
  expect(screen.queryByText(/child-/)).toBeNull();
});

test('a session renders children and remembers the user', async () => {
  getSession.mockResolvedValue({ data: { session: sess('u1') }, error: null });
  render(ui);
  expect(await screen.findByText('child-1')).toBeTruthy();
  expect(getLastUserId()).toBe('u1');
});

test('session expiry keeps children mounted and overlays Login; same user returns without remount', async () => {
  getSession.mockResolvedValue({ data: { session: sess('u1') }, error: null });
  render(ui);
  await screen.findByText('child-1');
  act(() => cb('SIGNED_OUT', null));
  expect(screen.getByText(/sign-in link/i)).toBeTruthy();
  expect(screen.getByText('child-1', { exact: false })).toBeTruthy();
  expect(getLastUserId()).toBe('u1');
  expect(clearCache).not.toHaveBeenCalled();
  act(() => cb('SIGNED_IN', sess('u1')));
  expect(screen.queryByText(/sign-in link/i)).toBeNull();
  expect(screen.getByText('child-1')).toBeTruthy();
  expect(mounts).toBe(1);
});

test('a different user signing back in remounts children and clears the cache', async () => {
  getSession.mockResolvedValue({ data: { session: sess('u1') }, error: null });
  render(ui);
  await screen.findByText('child-1');
  act(() => cb('SIGNED_OUT', null));
  act(() => cb('SIGNED_IN', sess('u2')));
  expect(await screen.findByText('child-2')).toBeTruthy();
  expect(clearCache).toHaveBeenCalled();
  expect(getLastUserId()).toBe('u2');
});

test('offline with a lastUserId renders children and a banner', async () => {
  setLastUserId('u1');
  getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  render(ui);
  expect(await screen.findByText('child-1')).toBeTruthy();
  expect(screen.getByText(/Offline — showing saved content/)).toBeTruthy();
  expect(screen.queryByText(/sign-in link/i)).toBeNull();
});

test('retryable error without a lastUserId still shows Login', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  render(ui);
  expect(await screen.findByText(/sign-in link/i)).toBeTruthy();
});

test('explicit sign-out clears lastUserId and the cache and unmounts children', async () => {
  getSession.mockResolvedValue({ data: { session: sess('u1') }, error: null });
  render(ui);
  await screen.findByText('child-1');
  markExplicitSignOut();
  act(() => cb('SIGNED_OUT', null));
  await waitFor(() => expect(screen.queryByText(/child-/)).toBeNull());
  expect(getLastUserId()).toBeNull();
  expect(clearCache).toHaveBeenCalled();
  expect(screen.getByText(/sign-in link/i)).toBeTruthy();
});

test('coming back online with no session leaves offline mode and shows Login (no banner)', async () => {
  setLastUserId('u1');
  getSession.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  render(ui);
  await screen.findByText(/Offline — showing saved content/);
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  act(() => { window.dispatchEvent(new Event('online')); });
  expect(await screen.findByText(/sign-in link/i)).toBeTruthy();
  expect(screen.queryByText(/Offline — showing saved content/)).toBeNull();
});
