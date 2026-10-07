import { render, screen, fireEvent, act } from '@testing-library/react';
import { Questions } from './Questions';
import { ToastProvider } from '../../ui/Toast';
import type { Question } from '../../db/models';

const q = (id: string): Question => ({
  id, slug: id, owner_id: null, track: 'step1', system: 'cardio', discipline: 'path', tags: [],
  stem: `stem-${id}`, choices: ['A1', 'B1', 'C1'], correct: 1, explanation: `exp-${id}`,
  explanation_pt: `pt-${id}`, image_url: null, image_credit: null,
});
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

afterEach(() => vi.useRealTimers());

test('empty bank shows an empty state', async () => {
  wrap(<Questions load={async () => []} save={async () => {}} />);
  expect(await screen.findByText(/no questions/i)).toBeTruthy();
});

test('tutor mode shows the explanation right after answering', async () => {
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText('Start tutor session'));
  fireEvent.click(screen.getByText('B1'));
  expect(screen.getByText('exp-1')).toBeTruthy();
});

test('timed mode hides explanations until the end, then summarizes and saves', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText('Start timed session'));
  fireEvent.click(screen.getByText('A1'));
  expect(screen.queryByText('exp-1')).toBeNull();
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  expect(await screen.findByText(/1 of 2/)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toHaveLength(2);
});

test('failed save of attempts toasts with retry and keeps the results visible', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText('Start tutor session'));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(/1 of 1/)).toBeTruthy();
});

test('double-click Finish saves exactly once', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText('Start tutor session'));
  fireEvent.click(screen.getByText('B1'));
  const f = screen.getByText('Finish');
  fireEvent.click(f); fireEvent.click(f);
  await screen.findByText(/1 of 1/);
  expect(save).toHaveBeenCalledTimes(1);
});

test('retry after a later successful save is a no-op', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText('Start tutor session'));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  const retry = await screen.findByText(/retry/i);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(2);
});

test('double-clicking a choice records one answer', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText('Start timed session'));
  const b = screen.getByText('B1');
  fireEvent.click(b); fireEvent.click(b);
  fireEvent.click(screen.getByText('Finish'));
  await screen.findByText(/1 of 1/);
  expect(save.mock.calls[0][0]).toHaveLength(1);
});

test('timer expiry counts unanswered as missed, saves answered only, offers review', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByText('Start timed session'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { await vi.advanceTimersByTimeAsync(181_000); });
  expect(screen.getByText(/1 of 2/)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toHaveLength(1);
  fireEvent.click(screen.getByText(/Review 1 missed/));
  expect(screen.getByText('stem-2')).toBeTruthy();
});

test('no missed button when everything is correct', async () => {
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText('Start tutor session'));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  expect(await screen.findByText(/1 of 1/)).toBeTruthy();
  expect(screen.queryByText(/missed/)).toBeNull();
});
