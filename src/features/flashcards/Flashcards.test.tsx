import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Flashcards } from './Flashcards';
import { ToastProvider } from '../../ui/Toast';

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
