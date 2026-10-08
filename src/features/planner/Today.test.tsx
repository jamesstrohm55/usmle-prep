import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Today, type TodayData } from './Today';
import { ToastProvider } from '../../ui/Toast';
import { DEFAULT_SETTINGS } from '../../db/queries';

const NOW = new Date(2026, 9, 7, 12); // Wednesday, local
const SYS = 'Renal & Urinary';
const qs = (n: number, system = SYS) => Array.from({ length: n }, (_, i) => ({ id: `${system}-q${i}`, system, tags: ['t1'] }));
const cs = (n: number, system = SYS) => Array.from({ length: n }, (_, i) => ({ id: `${system}-c${i}`, system }));
const data = (o: Partial<Record<keyof TodayData, unknown>> = {}) => ({
  questions: qs(10), cards: cs(20), states: new Map(), notes: [], attempts: [], reviews: [],
  settings: DEFAULT_SETTINGS, hasCompletedRun: true, ...o,
}) as unknown as TodayData;
const show = (d: TodayData | (() => Promise<TodayData>), save = vi.fn().mockResolvedValue(undefined)) =>
  render(
    <ToastProvider><MemoryRouter>
      <Today load={typeof d === 'function' ? d : async () => d} save={save} now={() => NOW} />
    </MemoryRouter></ToastProvider>,
  );
const wedSettings = (m: number) => ({ target_date: null, minutes_by_weekday: [60, 60, m, 60, 60, 180, 180] });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

test('new user sees a plan, a target date prompt and the diagnostic link', async () => {
  show(data({ hasCompletedRun: false }));
  expect(await screen.findByText(/Answer 10 .*questions/)).toBeTruthy();
  expect(screen.queryByText(/Review \d+ flashcards/)).toBeNull(); // new cards are not due
  expect(screen.queryByText(/could not/i)).toBeNull();
  expect(screen.getByText(/Set a target date/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /diagnostic/i }).getAttribute('href')).toBe('/diagnostic');
});

test('no diagnostic link once a run is completed', async () => {
  show(data());
  await screen.findByText(/Answer 10/);
  expect(screen.queryByRole('link', { name: /diagnostic/i })).toBeNull();
});

test('days left and past target date', async () => {
  const { unmount } = show(data({ settings: { ...DEFAULT_SETTINGS, target_date: '2026-10-10' } }));
  expect(await screen.findByText(/3 days left/)).toBeTruthy();
  unmount();
  show(data({ settings: { ...DEFAULT_SETTINGS, target_date: '2026-10-01' } }));
  expect(await screen.findByText(/target date passed/)).toBeTruthy();
});

test('a weekday with 0 minutes shows no study time and no tasks', async () => {
  show(data({ settings: wedSettings(0) }));
  expect(await screen.findByText(/No study time set for today/)).toBeTruthy();
  expect(screen.queryByText(/Answer \d+/)).toBeNull();
});

test('the override changes the plan and is remembered per day', async () => {
  show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 40/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '30' } });
  expect(screen.getByText(/Answer 20/)).toBeTruthy();
  expect(localStorage.getItem('today-minutes:2026-10-07')).toBe('30');
});

test('a stored override is applied on load', async () => {
  localStorage.setItem('today-minutes:2026-10-07', '30');
  show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 20/)).toBeTruthy();
});

test('clearing or garbling the override falls back to the weekday minutes', async () => {
  show(data({ questions: qs(40) }));
  await screen.findByText(/Answer 40/);
  const box = screen.getByLabelText(/minutes today/i);
  fireEvent.change(box, { target: { value: '30' } });
  fireEvent.change(box, { target: { value: '' } });
  expect(screen.getByText(/Answer 40/)).toBeTruthy();
  expect(localStorage.getItem('today-minutes:2026-10-07')).toBeNull();
  fireEvent.change(box, { target: { value: '-4' } });
  expect(screen.getByText(/Answer 40/)).toBeTruthy();
});

test('throwing localStorage does not crash the screen', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  show(data({ questions: qs(40) }));
  await screen.findByText(/Answer 40/);
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '30' } });
  expect(screen.getByText(/Answer 20/)).toBeTruthy();
});

test('due cards come first, questions and notes link to their screens', async () => {
  const past = new Date(2026, 9, 1).toISOString();
  const states = new Map(cs(12).map((c) => [c.id, { due: past }]));
  const notes = [{ id: 'n1', title: 'Nephron basics', system: SYS, tags: ['t1'] }, { id: 'n2', title: 'Nephron basics', system: 'Nervous', tags: ['t1'] }];
  show(data({ states, notes, cards: cs(12), questions: [...qs(10), ...qs(10, 'Nervous')], settings: wedSettings(180) }));
  const first = (await screen.findAllByRole('listitem'))[0];
  expect(first.textContent).toMatch(/Review 12 flashcards/);
  expect(first.querySelector('a')!.getAttribute('href')).toBe('/cards');
  const q = screen.getAllByRole('link', { name: /Answer \d+ .*questions/ }).map((a) => a.getAttribute('href'));
  expect(q.some((h) => h!.startsWith(`/questions?system=${encodeURIComponent(SYS)}&n=`))).toBe(true);
  expect(screen.getByRole('link', { name: /Nephron basics/ }).getAttribute('href')).toBe('/notes');
});

test('future-due cards are not counted', async () => {
  const future = new Date(2026, 9, 20).toISOString();
  show(data({ states: new Map(cs(5).map((c) => [c.id, { due: future }])) }));
  await screen.findByText(/Answer 10/);
  expect(screen.queryByText(/Review \d+ flashcards/)).toBeNull();
});

test('weekly bar shows minutes done of planned', async () => {
  const attempts = [{ question_id: 'x', correct: true, duration_ms: 30 * 60_000, answered_at: new Date(2026, 9, 6, 10).toISOString() }];
  show(data({ attempts }));
  expect(await screen.findByText(/30 of 660 min this week/)).toBeTruthy();
});

test('load failure offers Retry that reloads', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(data());
  show(load);
  expect(await screen.findByText(/Could not load/)).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText(/Answer 10/)).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});

test('saving settings calls save and toasts', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  show(data(), save);
  await screen.findByText(/Answer 10/);
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(await screen.findByText('Saved')).toBeTruthy();
});
