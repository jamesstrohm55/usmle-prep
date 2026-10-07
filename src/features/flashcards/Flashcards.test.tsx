import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Flashcards } from './Flashcards';
import { ToastProvider } from '../../ui/Toast';
import { setItemStatus } from '../../db/queries';
import { newCard, rateCard, toRow, Rating } from '../../engine/fsrs';

vi.mock('../../db/queries', async (orig) => ({ ...(await orig<typeof import('../../db/queries')>()), setItemStatus: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const card = (id: string, front: string) => ({
  id, slug: id, owner_id: null, track: 'step1' as const, system: 'cardio', discipline: 'path', tags: [],
  front, back: `back-${id}`, back_pt: `pt-${id}`, image_url: null, image_credit: null,
});
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

test('shows an empty state when nothing is due', async () => {
  wrap(<Flashcards load={async () => ({ cards: [], states: new Map() })} save={async () => {}} />);
  expect(await screen.findByText(/nothing due/i)).toBeTruthy();
});

test('reveals the answer and shows the pt-BR reveal on demand', async () => {
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1')], states: new Map() })} save={async () => {}} />);
  fireEvent.click(await screen.findByText('Show answer'));
  expect(screen.getByText('back-c1')).toBeTruthy();
  expect(screen.queryByText('pt-c1')).toBeNull();
  fireEvent.click(screen.getByText('Ver em português'));
  expect(screen.getByText('pt-c1')).toBeTruthy();
});

test('a failed save keeps the card on screen, toasts, and retry succeeds', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1'), card('c2', 'Q2')], states: new Map() })} save={save} />);
  fireEvent.click(await screen.findByText('Show answer'));
  fireEvent.click(screen.getByText('Good'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Q1')).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('Q2')).toBeTruthy());
  expect(save).toHaveBeenCalledTimes(2);
});

test('double-click on a grade saves once and advances one card', async () => {
  let release!: () => void;
  const save = vi.fn(() => new Promise<void>((r) => { release = r; }));
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1'), card('c2', 'Q2'), card('c3', 'Q3')], states: new Map() })} save={save} />);
  fireEvent.click(await screen.findByText('Show answer'));
  const good = screen.getByText('Good');
  fireEvent.click(good);
  fireEvent.click(good);
  release();
  await waitFor(() => expect(screen.getByText('Q2')).toBeTruthy());
  expect(save).toHaveBeenCalledTimes(1);
});

test('a stale Retry is a no-op once the card has moved on', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1'), card('c2', 'Q2'), card('c3', 'Q3')], states: new Map() })} save={save} />);
  fireEvent.click(await screen.findByText('Show answer'));
  fireEvent.click(screen.getByText('Good'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Easy'));
  await waitFor(() => expect(screen.getByText('Q2')).toBeTruthy());
  expect(screen.queryByText('Retry')).toBeNull(); // the stale toast is dismissed after the later successful save
  await new Promise((r) => setTimeout(r, 20));
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Q2')).toBeTruthy();
});

test('failed load shows an inline error with Retry, not endless Loading', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ cards: [card('c1', 'Q1')], states: new Map() });
  wrap(<Flashcards load={load} save={async () => {}} />);
  expect(await screen.findByText(/Could not load cards: boom/)).toBeTruthy();
  expect(screen.queryByText('Loading…')).toBeNull();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText('Q1')).toBeTruthy();
});

test('rating Again re-queues the card this session; Easy does not', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1'), card('c2', 'Q2')], states: new Map() })} save={save} />);
  fireEvent.click(await screen.findByText('Show answer'));
  fireEvent.click(screen.getByText('Again'));
  await screen.findByText('Q2');
  expect(screen.getByText(/2 left/)).toBeTruthy(); // Q2 plus Q1 re-queued
  fireEvent.click(screen.getByText('Show answer'));
  fireEvent.click(screen.getByText('Easy'));
  expect(await screen.findByText('Q1')).toBeTruthy();
  expect(screen.getByText(/1 left/)).toBeTruthy();
  fireEvent.click(screen.getByText('Show answer'));
  fireEvent.click(screen.getByText('Easy'));
  expect(await screen.findByText(/nothing due/i)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(3);
});

test('existing card_state: due card first, stored state feeds the scheduler, future card excluded', async () => {
  const past = new Date(Date.now() - 3 * 86400000);
  const stored = toRow(rateCard(newCard(past), Rating.Good, past).card);
  const dueRow = { ...stored, due: new Date(Date.now() - 3600_000).toISOString() };
  const futureRow = { ...stored, due: new Date(Date.now() + 5 * 86400000).toISOString() };
  const states = new Map([['rev', dueRow], ['fut', futureRow]]);
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Flashcards load={async () => ({ cards: [card('new', 'QN'), card('fut', 'QF'), card('rev', 'QR')], states })} save={save} />);
  expect(await screen.findByText('QR')).toBeTruthy(); // due review before the new card
  expect(screen.getByText(/2 left/)).toBeTruthy(); // QF excluded
  fireEvent.click(screen.getByText('Show answer'));
  fireEvent.click(screen.getByText('Good'));
  await screen.findByText('QN');
  const saved = save.mock.calls[0][1];
  expect(saved.reps).toBe(stored.reps + 1); // continued from stored state, not a fresh card
  expect(saved.stability).not.toBe(rateCard(newCard(new Date()), Rating.Good, new Date()).card.stability);
  expect(screen.queryByText('QF')).toBeNull();
});

test('flagging asks for a note and passes it; cancel does not flag', async () => {
  const set = vi.mocked(setItemStatus);
  set.mockReset();
  set.mockResolvedValue(undefined);
  const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('wrong dose');
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1')], states: new Map() })} save={async () => {}} />);
  fireEvent.click(await screen.findByText('Show answer'));
  fireEvent.click(screen.getByText('Flag as wrong'));
  expect(set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Flag as wrong'));
  expect(prompt).toHaveBeenCalledWith('What is wrong? (optional)');
  await waitFor(() => expect(set).toHaveBeenCalledWith('card', 'c1', 'flagged', 'wrong dose'));
});

test('an old Retry cannot re-rate a requeued card that is back at the head', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Flashcards load={async () => ({ cards: [card('c1', 'Q1')], states: new Map() })} save={save} />);
  fireEvent.click(await screen.findByText('Show answer'));
  fireEvent.click(screen.getByText('Good'));
  const oldRetry = await screen.findByText('Retry');
  fireEvent.click(screen.getByText('Good')); // succeeds; Good on a new card is due in minutes, so c1 is requeued
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await screen.findByText('Show answer'); // same card back at the head
  fireEvent.click(oldRetry);
  await new Promise((r) => setTimeout(r, 20));
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Retry')).toBeNull(); // toast dismissed after a successful save
});

test('a card with a relative image_url renders the BASE_URL-prefixed image with generic alt', async () => {
  const c = { ...card('c1', 'Q1'), image_url: 'images/ecg/afib-1.jpg', image_credit: 'Jane, CC BY 4.0' };
  wrap(<Flashcards load={async () => ({ cards: [c], states: new Map() })} save={async () => {}} />);
  const img = await screen.findByAltText('Clinical image (see the question)');
  expect(img.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}images/ecg/afib-1.jpg`);
  expect(screen.getByText('Jane, CC BY 4.0')).toBeTruthy();
});
