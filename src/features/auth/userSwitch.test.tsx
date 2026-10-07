import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../ui/Toast';

type Cb = (e: string, s: unknown) => void;
let cb: Cb;
vi.mock('../../db/client', () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }),
    onAuthStateChange: (f: Cb) => { cb = f; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithOtp: vi.fn(),
  } },
}));
vi.mock('../../db/queries', async (orig) => ({ ...(await orig<typeof import('../../db/queries')>()), clearCache: vi.fn() }));

import { AuthGate } from './AuthGate';
import { Flashcards } from '../flashcards/Flashcards';
import { Questions } from '../questions/Questions';

beforeEach(() => localStorage.clear());

const card = { id: 'c1', slug: 'c1', owner_id: null, track: 'step1' as const, system: 's', discipline: 'd', tags: [], front: 'Q1', back: 'b', back_pt: null, image_url: null, image_credit: null };
const question = { id: 'q1', slug: 'q1', owner_id: null, track: 'step1' as const, system: 's', discipline: 'd', tags: [], stem: 'stem', choices: ['A1', 'B1'], correct: 1, explanation: 'e', explanation_pt: null, image_url: null, image_credit: null };

test("user A's failed rating Retry cannot write under user B", async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'));
  render(<ToastProvider><AuthGate><Flashcards load={async () => ({ cards: [card], states: new Map() })} save={save} /></AuthGate></ToastProvider>);
  fireEvent.click(await screen.findByText('Show answer'));
  fireEvent.click(screen.getByText('Good'));
  await screen.findByText('Retry');
  act(() => cb('SIGNED_OUT', null));
  act(() => cb('SIGNED_IN', { user: { id: 'u2' } }));
  await screen.findByText('Show answer'); // remounted for u2
  expect(screen.queryByText('Retry')).toBeNull();
  await new Promise((r) => setTimeout(r, 20));
  expect(save).toHaveBeenCalledTimes(1);
});

test("user A's failed results save Retry cannot write under user B", async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'));
  render(<ToastProvider><AuthGate><Questions load={async () => [question]} save={save} /></AuthGate></ToastProvider>);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  await screen.findByText('Retry');
  act(() => cb('SIGNED_OUT', null));
  act(() => cb('SIGNED_IN', { user: { id: 'u2' } }));
  await waitFor(() => expect(screen.queryByText('Retry')).toBeNull());
  expect(save).toHaveBeenCalledTimes(1);
});
