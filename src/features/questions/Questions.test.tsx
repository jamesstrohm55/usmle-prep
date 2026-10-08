import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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

test('timed mode hides explanations until the end while saving each answer as it goes', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
  fireEvent.click(screen.getByText('A1'));
  expect(screen.queryByText('exp-1')).toBeNull();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toHaveLength(1);
  expect(save.mock.calls[0][0][0]).toMatchObject({ mode: 'timed', chosen: 0, correct: false });
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  expect(screen.queryByText(/^exp-/)).toBeNull();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toHaveLength(1);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(await screen.findByText(/1 of 2/)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(2); // everything already saved: Finish sends nothing
});

test('each answer is saved the moment it is given, one row with the session id and mode', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999); // identity shuffle
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  expect(save).toHaveBeenCalledTimes(1);
  const [[row1]] = save.mock.calls[0];
  expect(save.mock.calls[0][0]).toHaveLength(1);
  expect(row1).toMatchObject({ question_id: '1', chosen: 1, correct: true, mode: 'tutor' });
  expect(typeof row1.duration_ms).toBe('number');
  expect(row1.session_id).toBeTruthy();
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('A1'));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toEqual([expect.objectContaining({ question_id: '2', chosen: 0, correct: false, mode: 'tutor', session_id: row1.session_id })]);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(screen.getByText(/1 of 2/)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(2);
});

test('a failed answer save toasts, Retry re-sends the identical row, and answering continues', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  expect((await screen.findByRole('alert')).textContent).toMatch('Could not save your answer: offline');
  expect(screen.getByText('exp-1')).toBeTruthy(); // local answer kept
  await new Promise((r) => setTimeout(r, 5)); // a recomputed duration would differ
  await act(async () => { fireEvent.click(screen.getByText('Retry')); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  expect(save).toHaveBeenCalledTimes(3);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(3);
});

test('a failed answer save does not block answering the next question; Finish batches only the unsaved rows', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const save = vi.fn()
    .mockRejectedValueOnce(new Error('offline')) // answer 1
    .mockResolvedValueOnce(undefined) // answer 2, carrying answer 1
    .mockRejectedValueOnce(new Error('offline')) // answer 3
    .mockResolvedValue(undefined); // Finish
  wrap(<Questions load={async () => [q('1'), q('2'), q('3')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('A1'));
  await act(async () => {});
  expect(save).toHaveBeenCalledTimes(3);
  const [[r1]] = save.mock.calls[0];
  expect(save.mock.calls[1][0]).toEqual([r1, expect.objectContaining({ question_id: '2' })]);
  expect(save.mock.calls[2][0]).toEqual([expect.objectContaining({ question_id: '3' })]);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(screen.getByText(/2 of 3/)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(4);
  expect(save.mock.calls[3][0]).toEqual(save.mock.calls[2][0]); // only the still-unsaved row 3
});

test('a later answer carries an earlier failed row, and no row is saved twice', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2'), q('3')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  expect(save.mock.calls[1][0]).toEqual([save.mock.calls[0][0][0], expect.objectContaining({ question_id: '2' })]);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(3);
  const savedIds = save.mock.calls.slice(1).flatMap((c) => c[0].map((r: { question_id: string }) => r.question_id));
  expect(savedIds).toEqual(['1', '2', '3']); // each successful call's rows: every answer exactly once
});

test('an answer still in flight is not carried by the next answer', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const d = deferred();
  const save = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toEqual([expect.objectContaining({ question_id: '2' })]);
  await act(async () => { d.resolve(); });
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(2);
});

test('leaving the screen dismisses a failed-answer toast, so no Retry that does nothing is left', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const { rerender } = wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByText(/Could not save your answer/);
  rerender(<ToastProvider><p>elsewhere</p></ToastProvider>); // provider stays, Questions unmounts
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Retry')).toBeNull();
  await act(async () => {});
  expect(save).toHaveBeenCalledTimes(1);
});

test('a rejection that is not an Error still toasts a readable message with Retry', async () => {
  const save = vi.fn().mockRejectedValueOnce(undefined).mockRejectedValueOnce('boom').mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  expect((await screen.findByRole('alert')).textContent).toMatch('Could not save your answer: unknown error');
  await act(async () => { fireEvent.click(screen.getByText('Retry')); });
  expect((await screen.findByRole('alert')).textContent).toMatch('Could not save your answer: boom');
  await act(async () => { fireEvent.click(screen.getByText('Retry')); });
  expect(save).toHaveBeenCalledTimes(3);
  expect(save.mock.calls[2][0]).toEqual(save.mock.calls[0][0]);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(3); // row was saved by the third call, not mistaken as saved earlier
});

test('failed save of attempts toasts with retry and keeps the results visible', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByText(/Could not save your answer: offline/);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect((await screen.findByRole('alert')).textContent).toMatch('Could not save results: still offline');
  expect(screen.getByText(/1 of 1/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText('Retry')); });
  expect(save).toHaveBeenCalledTimes(3);
  expect(save.mock.calls[2][0]).toEqual(save.mock.calls[0][0]);
});

test('Finish waits for an in-flight answer save and does not re-send it', async () => {
  const d = deferred();
  const save = vi.fn().mockReturnValue(d.promise);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(screen.getByText(/1 of 1/)).toBeTruthy();
  await act(async () => { d.resolve(); });
  expect(save).toHaveBeenCalledTimes(1);
});

test('Finish sends an in-flight answer save that then fails, once', async () => {
  let reject!: (e: Error) => void;
  const save = vi.fn().mockReturnValueOnce(new Promise<void>((_, r) => { reject = r; })).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('offline')); });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
});

test('double-click Finish in one tick sends the unsaved rows once', async () => {
  const d = deferred();
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValue(d.promise);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  const f = screen.getByText('Finish');
  await act(async () => { f.click(); f.click(); });
  await act(async () => { d.resolve(); });
  expect(save).toHaveBeenCalledTimes(2);
});

test('leaving mid-set keeps the answers already given saved', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { unmount } = wrap(<Questions load={async () => [q('1'), q('2'), q('3')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  unmount();
  await act(async () => {});
  expect(save).toHaveBeenCalledTimes(2);
  expect(new Set(save.mock.calls.map((c) => c[0][0].question_id)).size).toBe(2);
});

test('an answer save that fails after leaving the screen shows no Retry', async () => {
  let reject!: (e: Error) => void;
  const save = vi.fn().mockReturnValueOnce(new Promise<void>((_, r) => { reject = r; }));
  const { rerender } = wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  rerender(<ToastProvider><p>elsewhere</p></ToastProvider>); // provider stays, Questions unmounts
  await act(async () => { reject(new Error('offline')); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(save).toHaveBeenCalledTimes(1);
});

test('retry after a later successful save is a no-op', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  const retry = await screen.findByText(/retry/i);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(2);
});

test('double-clicking a choice in one tick records one answer and saves once', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
  const b = screen.getByText('B1');
  act(() => { b.click(); b.click(); });
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Finish'));
  await screen.findByText(/1 of 1/);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toHaveLength(1);
});

test('old toast retry after a new session finished saves the FIRST session rows once and leaves the new session alone', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start timed session/));
  fireEvent.click(screen.getByText('A1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  const retry = await screen.findByText(/retry/i);
  expect(save).toHaveBeenCalledTimes(2);
  fireEvent.click(await screen.findByText(/Review 1 missed/));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/1 of 1 correct \(100%\)/)).toBeTruthy();
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(4);
  const [first, , second, again] = save.mock.calls.map((c) => c[0]);
  expect(again).toEqual(first);
  expect(again[0].mode).toBe('timed');
  expect(second[0].session_id).not.toBe(first[0].session_id);
  expect(second[0].mode).toBe('tutor');
  expect(screen.getByText(/1 of 1 correct \(100%\)/)).toBeTruthy(); // new session's summary untouched
  await act(async () => { fireEvent.click(retry); });
  expect(save).toHaveBeenCalledTimes(4);
});

test('double-click Retry sends one insert', async () => {
  const d = deferred();
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValue(d.promise);
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
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

test('timer expiry, like Finish, sends only the answers whose save failed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByText(/Start timed session/));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('A1'));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(181_000); });
  expect(screen.getByText(/1 of 2/)).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(3);
  expect(save.mock.calls[2][0]).toEqual(save.mock.calls[1][0]);
});

test('no missed button when everything is correct', async () => {
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('Finish'));
  expect(await screen.findByText(/1 of 1/)).toBeTruthy();
  expect(screen.queryByText(/missed/)).toBeNull();
});

test('a question with a relative image_url renders the prefixed image in the stem area', async () => {
  const withImg = { ...q('1'), image_url: 'images/ecg/afib-1.jpg', image_credit: 'Jane, CC0' };
  wrap(<Questions load={async () => [withImg]} save={async () => {}} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  expect((await screen.findByAltText('Clinical image (see the question)')).getAttribute('src')).toBe(`${import.meta.env.BASE_URL}images/ecg/afib-1.jpg`);
});

const qs = (id: string, system: string): Question => ({ ...q(id), system });
const att = (question_id: string, correct: boolean) => ({ question_id, correct, duration_ms: 1, answered_at: '2026-01-01T00:00:00Z' });

test('preset: planned set starts a tutor session of unseen questions of that system, at most n', async () => {
  const bank = [qs('r1', 'renal'), qs('r2', 'renal'), qs('r3', 'renal'), qs('c1', 'cardio')];
  wrap(<Questions load={async () => bank} save={async () => {}} preset={{ system: 'renal', n: 2 }} loadAttempts={async () => [att('r1', true)]} />);
  fireEvent.click(await screen.findByText(/Start planned set \(2 questions in renal\)/));
  const seen: string[] = [];
  for (let i = 0; i < 2; i++) {
    seen.push((screen.getByText(/^stem-/)).textContent!);
    fireEvent.click(screen.getByText('B1')); // tutor mode shows explanation
    expect(screen.getByText(/^exp-/)).toBeTruthy();
    if (i === 0) fireEvent.click(screen.getByText('Next'));
  }
  expect(seen.sort()).toEqual(['stem-r2', 'stem-r3']);
  expect(screen.getByText('Finish')).toBeTruthy();
});

test('preset: count is capped at the questions available in the system', async () => {
  wrap(<Questions load={async () => [qs('r1', 'renal'), qs('c1', 'cardio')]} save={async () => {}} preset={{ system: 'renal', n: 10 }} loadAttempts={async () => []} />);
  expect(await screen.findByText(/Start planned set \(1 question in renal\)/)).toBeTruthy();
});

test('preset for a system not in the bank shows the normal start screen only', async () => {
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} preset={{ system: 'renal', n: 5 }} loadAttempts={async () => []} />);
  expect(await screen.findByText(/Start tutor session/)).toBeTruthy();
  expect(screen.queryByText(/Start planned set/)).toBeNull();
});

test('no preset leaves the start screen unchanged and never loads attempts', async () => {
  const loadAttempts = vi.fn();
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} loadAttempts={loadAttempts} />);
  expect(await screen.findByText(/Start tutor session/)).toBeTruthy();
  expect(screen.queryByText(/Start planned set/)).toBeNull();
  expect(loadAttempts).not.toHaveBeenCalled();
});

test('preset: failing loadAttempts falls back to all questions unseen, no crash or toast', async () => {
  wrap(<Questions load={async () => [qs('r1', 'renal'), qs('r2', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 5 }} loadAttempts={async () => { throw new Error('offline'); }} />);
  const btn = (await screen.findByText(/Start planned set \(2 questions in renal\)/)) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
  expect(screen.getByText(/Q1\/2/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('preset: planned button is disabled until history loads, then excludes seen questions', async () => {
  let resolve!: (a: ReturnType<typeof att>[]) => void;
  const loadAttempts = () => new Promise<ReturnType<typeof att>[]>((r) => { resolve = r; });
  wrap(<Questions load={async () => [qs('r1', 'renal'), qs('r2', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 1 }} loadAttempts={loadAttempts} />);
  const btn = (await screen.findByText(/Start planned set/)) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  await act(async () => { resolve([att('r1', true)]); });
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  expect(screen.getByText('stem-r2')).toBeTruthy();
});

test('preset with done: Resume label, and the set still serves unseen questions first', async () => {
  const bank = [qs('r1', 'renal'), qs('r2', 'renal'), qs('r3', 'renal')];
  wrap(<Questions load={async () => bank} save={async () => {}} preset={{ system: 'renal', n: 2, done: 1 }} loadAttempts={async () => [att('r1', true)]} />);
  const btn = (await screen.findByText('Resume planned set (2 questions left in renal, 1 done)')) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
  expect(screen.getByText(/Q1\/2/)).toBeTruthy();
  expect(screen.getByText(/^stem-/).textContent).not.toBe('stem-r1');
});

test('preset with done: singular "1 question left"', async () => {
  wrap(<Questions load={async () => [qs('r1', 'renal'), qs('r2', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 1, done: 5 }} loadAttempts={async () => []} />);
  expect(await screen.findByText(/Resume planned set \(1 question left in renal, 5 done\)/)).toBeTruthy();
});

test('preset with practice: practice label, never Resume', async () => {
  wrap(<Questions load={async () => [qs('r1', 'renal'), qs('r2', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 2, done: 3, practice: true }} loadAttempts={async () => []} />);
  expect(await screen.findByText(/Start practice set \(2 questions in renal\)/)).toBeTruthy();
  expect(screen.queryByText(/Resume|Start planned set/)).toBeNull();
});

test('preset with done 0 keeps the Start planned set label', async () => {
  wrap(<Questions load={async () => [qs('r1', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 1, done: 0 }} loadAttempts={async () => []} />);
  expect(await screen.findByText(/Start planned set \(1 question in renal\)/)).toBeTruthy();
});

test('a 23505 on the Finish batch re-sends each row alone, since a multi-row insert is all-or-nothing', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
  const save = vi.fn()
    .mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')) // both answers
    .mockRejectedValueOnce(dup) // Finish batch: one of them had landed
    .mockRejectedValueOnce(dup).mockResolvedValueOnce(undefined); // row 1 landed, row 2 now saves
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert'); // answer 1 failed before answer 2 is given
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(5));
  const [r1, r2] = save.mock.calls[1][0]; // answer 2 carried the failed answer 1
  expect(save.mock.calls[0][0]).toEqual([r1]);
  expect(save.mock.calls[2][0]).toEqual([r1, r2]);
  expect(save.mock.calls[3][0]).toEqual([r1]);
  expect(save.mock.calls[4][0]).toEqual([r2]);
  expect(screen.queryByText(/Could not save results/)).toBeNull();
});

test('a row that fails during the 23505 fallback offers a Retry of the whole unsaved list', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
  const off = new Error('offline');
  const save = vi.fn()
    .mockRejectedValueOnce(off).mockRejectedValueOnce(off) // answers 1 and 2
    .mockRejectedValueOnce(dup) // Finish batch
    .mockRejectedValueOnce(off).mockRejectedValueOnce(off) // each row alone
    .mockResolvedValue(undefined);
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(5));
  await screen.findByText(/Could not save results/);
  await act(async () => { fireEvent.click(screen.getByText('Retry')); });
  expect(save).toHaveBeenCalledTimes(6);
  expect(save.mock.calls[5][0]).toEqual(save.mock.calls[1][0]); // both rows, not just the last one to fail
});

type Row = { question_id: string };
const ids = (rows: Row[]) => rows.map((r) => r.question_id);
const fk = () => Object.assign(new Error('violates foreign key'), { code: '23503' });

test('a server-rejected row (23503) does not poison later carried batches: they fall back to one row at a time', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const saved: string[] = [];
  const save = vi.fn(async (rows: Row[]) => { if (ids(rows).includes('1')) throw fk(); saved.push(...ids(rows)); });
  wrap(<Questions load={async () => [q('1'), q('2'), q('3')]} save={save as never} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByText(/Could not save your answer: violates foreign key/);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  expect(save.mock.calls.map((c) => ids(c[0]))).toEqual([['1'], ['1', '2'], ['1'], ['2'], ['1', '3'], ['1'], ['3']]);
  for (const [rows] of save.mock.calls) expect(new Set(ids(rows)).size).toBe(rows.length); // no row twice in one call
  expect(saved).toEqual(['2', '3']);
  expect(screen.getByText(/Could not save your answer/)).toBeTruthy(); // row 1 still offers Retry
});

test('a codeless network error on a carried batch does not fall back to one row at a time', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const save = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  expect(save.mock.calls.map((c) => ids(c[0]))).toEqual([['1'], ['1', '2']]);
  expect(screen.getByText(/Could not save your answer: Failed to fetch/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText('Retry')); });
  expect(save.mock.calls.map((c) => ids(c[0]))).toEqual([['1'], ['1', '2'], ['1', '2']]);
});

test('Finish with a poison row still saves the good rows', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  const saved: string[] = [];
  let offlineOnce = true;
  const save = vi.fn(async (rows: Row[]) => {
    if (ids(rows).includes('1')) throw fk();
    if (offlineOnce) { offlineOnce = false; throw new TypeError('Failed to fetch'); } // row 2's first send
    saved.push(...ids(rows));
  });
  wrap(<Questions load={async () => [q('1'), q('2')]} save={save as never} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('B1'));
  await act(async () => {});
  expect(saved).toEqual([]);
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  await waitFor(() => expect(saved).toEqual(['2']));
  expect(screen.getByText(/2 of 2/)).toBeTruthy();
  expect(save.mock.calls.slice(-3).map((c) => ids(c[0]))).toEqual([['1', '2'], ['1'], ['2']]);
  expect(screen.getByText(/Could not save results: violates foreign key/)).toBeTruthy();
});

test('a save that fails with 23505 counts as saved: no toast, no retry', async () => {
  const save = vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
  wrap(<Questions load={async () => [q('1')]} save={save} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  fireEvent.click(screen.getByText('B1'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

async function finishPlannedSet() {
  fireEvent.click(screen.getByText('B1'));
  await act(async () => { fireEvent.click(screen.getByText('Finish')); });
}

test('preset: finishing a planned set reloads history once saves settle, links back to Today, and hides the stale planned button', async () => {
  const d = deferred();
  const save = vi.fn().mockReturnValue(d.promise);
  const loadAttempts = vi.fn().mockResolvedValue([]);
  wrap(<Questions load={async () => [qs('r1', 'renal'), qs('r2', 'renal')]} save={save} preset={{ system: 'renal', n: 1, done: 1 }} loadAttempts={loadAttempts} />);
  const btn = (await screen.findByText(/Resume planned set/)) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
  await finishPlannedSet();
  expect(loadAttempts).toHaveBeenCalledTimes(1); // the answer save is still in flight
  await act(async () => { d.resolve(); });
  await waitFor(() => expect(loadAttempts).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Back to Today').getAttribute('href')).toBe('#/today');
  fireEvent.click(screen.getByText('Done'));
  expect(screen.queryByText(/Resume planned set|Start planned set/)).toBeNull();
  expect(screen.getByText(/Start tutor session/)).toBeTruthy();
  expect(screen.getByText(/Start timed session/)).toBeTruthy();
});

test('preset: a failing history refresh after a planned set is silent and the page keeps working', async () => {
  const loadAttempts = vi.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('offline'));
  wrap(<Questions load={async () => [qs('r1', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 1 }} loadAttempts={loadAttempts} />);
  const btn = (await screen.findByText(/Start planned set/)) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
  await finishPlannedSet();
  await waitFor(() => expect(loadAttempts).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByText('Done'));
  fireEvent.click(screen.getByText(/Start tutor session/));
  expect(screen.getByText(/Q1\/1/)).toBeTruthy();
});

test('preset: a normal session does not reload history, but its summary still links back to Today', async () => {
  const loadAttempts = vi.fn().mockResolvedValue([]);
  wrap(<Questions load={async () => [qs('r1', 'renal')]} save={async () => {}} preset={{ system: 'renal', n: 1 }} loadAttempts={loadAttempts} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  await finishPlannedSet();
  expect(screen.getByText('Back to Today')).toBeTruthy();
  expect(loadAttempts).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Done'));
  expect(screen.getByText(/Start planned set/)).toBeTruthy(); // not used yet, so still offered
});

test('no preset: the summary has no Back to Today link and history is never loaded', async () => {
  const loadAttempts = vi.fn();
  wrap(<Questions load={async () => [q('1')]} save={async () => {}} loadAttempts={loadAttempts} />);
  fireEvent.click(await screen.findByText(/Start tutor session/));
  await finishPlannedSet();
  expect(screen.getByText(/1 of 1/)).toBeTruthy();
  expect(screen.queryByText('Back to Today')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  expect(loadAttempts).not.toHaveBeenCalled();
});
