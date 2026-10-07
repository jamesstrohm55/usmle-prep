import { render, screen, fireEvent, act } from '@testing-library/react';
import { Questions } from './Questions';
import { ToastProvider } from '../../ui/Toast';
import { setItemStatus } from '../../db/queries';
import type { Question } from '../../db/models';

const q = (id: string): Question => ({
  id, slug: id, owner_id: null, track: 'step1', system: 'cardio', discipline: 'path', tags: [],
  stem: `stem-${id}`, choices: ['A1', 'B1', 'C1'], correct: 1, explanation: `exp-${id}`,
  explanation_pt: `pt-${id}`, image_url: null, image_credit: null,
});
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

vi.mock('../../db/queries', async (orig) => ({ ...(await orig<typeof import('../../db/queries')>()), setItemStatus: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

test('empty bank shows an empty state', async () => {
  wrap(<Questions load={async () => []} save={async () => {}} />);
  expect(await screen.findByText(/no questions/i)).toBeTruthy();
});

test('tutor mode shows the explanation right after answering', async () => {
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  expect(screen.getByText('exp-1')).toBeTruthy();
});

test('timed mode hides explanations until the end, then summarizes and saves', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
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
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(/1 of 1/)).toBeTruthy();
});

test('double-click Finish in one tick saves exactly once', async () => {
  const d = deferred();
  const save = vi.fn().mockReturnValue(d.promise);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  const f = screen.getByText('Finish');
  act(() => { f.click(); f.click(); });
  await act(async () => { d.resolve(); });
  expect(save).toHaveBeenCalledTimes(1);
});

test('retry after a later successful save is a no-op', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  const retry = await screen.findByText(/retry/i);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(2);
});

test('double-clicking a choice in one tick records one answer', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
  const b = screen.getByText('B1');
  act(() => { b.click(); b.click(); });
  fireEvent.click(screen.getByText('Finish'));
  await screen.findByText(/1 of 1/);
  expect(save.mock.calls[0][0]).toHaveLength(1);
});

test('old toast retry after a new session finished saves the FIRST session rows once', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
  fireEvent.click(screen.getByText('A1'));
  fireEvent.click(screen.getByText('Finish'));
  const retry = await screen.findByText(/retry/i);
  fireEvent.click(await screen.findByText(/Review 1 missed/));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(3);
  const [first, second, again] = save.mock.calls.map((c) => c[0]);
  expect(again).toEqual(first);
  expect(again[0].mode).toBe('timed');
  expect(again[0].session_id).toBe(first[0].session_id);
  expect(second[0].session_id).not.toBe(first[0].session_id);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(3);
});

test('double-click Retry sends one insert', async () => {
  const d = deferred();
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValue(d.promise);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  const retry = await screen.findByText(/retry/i);
  act(() => { retry.click(); retry.click(); });
  await act(async () => { d.resolve(); });
  expect(save).toHaveBeenCalledTimes(2);
});

test('failed flag shows an error toast whose Retry re-calls setItemStatus', async () => {
  const set = vi.mocked(setItemStatus);
  set.mockReset();
  set.mockRejectedValueOnce(new Error('nope')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  vi.spyOn(window, 'prompt').mockReturnValue('typo in stem');
  fireEvent.click(screen.getByText('Flag as wrong'));
  const retry = await screen.findByText(/retry/i);
  await act(async () => { fireEvent.click(retry); });
  expect(set).toHaveBeenCalledTimes(2);
  expect(set).toHaveBeenLastCalledWith('question', '1', 'flagged', 'typo in stem');
});

test('cancelling the flag prompt does not flag', async () => {
  const set = vi.mocked(setItemStatus);
  set.mockReset();
  vi.spyOn(window, 'prompt').mockReturnValue(null);
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Flag as wrong'));
  expect(window.prompt).toHaveBeenCalledWith('What is wrong? (optional)');
  expect(set).not.toHaveBeenCalled();
});

test('failed load shows an inline error with Retry, not endless Loading', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([q('1')]);
  wrap(<Questions load={load} save={async () => {}} />);
  expect(await screen.findByText(/Could not load questions: boom/)).toBeTruthy();
  expect(screen.queryByText('Loading…')).toBeNull();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText(/Start tutor session/)).toBeTruthy();
});

test('sessions use a shuffled block of at most 40, labelled with the real size', async () => {
  const bank = Array.from({ length: 100 }, (_, i) => q(String(i)));
  wrap(<Questions load={async () => bank} save={async () => {}} />);
  expect(await screen.findByText('Start timed session (40 questions, 60 min)')).toBeTruthy();
  expect(screen.getByText('Start tutor session (40 questions)')).toBeTruthy();
  fireEvent.click(screen.getByText(/Start tutor session/));
  expect(screen.getByText(/Q1\/40/)).toBeTruthy();
});

test('small bank label uses the real count', async () => {
  wrap(<Questions load={async () => [q('1'), q('2')]} save={async () => {}} />);
  expect(await screen.findByText('Start timed session (2 questions, 3 min)')).toBeTruthy();
});

test('timed mode marks the chosen answer', async () => {
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
  expect(screen.getByText('B1').getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByText('B1'));
  expect(screen.getByText('B1').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('A1').getAttribute('aria-pressed')).toBe('false');
});

test('missing crypto.randomUUID does not crash', async () => {
  const c = crypto as unknown as { randomUUID?: unknown };
  const orig = c.randomUUID;
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
  try {
    const save = vi.fn().mockResolvedValue(undefined);
    wrap(<Questions load={async () => [q('1')]} save={save} />);
    fireEvent.click(await screen.findByText(/Start tutor session/));
    fireEvent.click(screen.getByText('B1'));
    fireEvent.click(screen.getByText('Finish'));
    await screen.findByText(/1 of 1/);
    expect(save.mock.calls[0][0][0].session_id).toBeTruthy();
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: orig, configurable: true, writable: true });
  }
});

test('timer expiry counts unanswered as missed, saves answered only, offers review', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.spyOn(Math, 'random').mockReturnValue(0.999999); // identity shuffle: stem-1 first
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByText(/Start timed session/));
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
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  expect(await screen.findByText(/1 of 1/)).toBeTruthy();
  expect(screen.queryByText(/missed/)).toBeNull();
});
