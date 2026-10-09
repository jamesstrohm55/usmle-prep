import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Today, type TodayData } from './Today';
import { ToastProvider } from '../../ui/Toast';
import { DEFAULT_SETTINGS } from '../../db/queries';
import * as planner from '../../engine/planner';
import { setLastUserId } from '../../db/lastUser';
import { LangProvider } from '../../ui/lang';

vi.mock('../../engine/planner', async (orig) => {
  const m = await orig<typeof import('../../engine/planner')>();
  return { ...m, buildPlan: vi.fn(m.buildPlan) };
});

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
  expect(localStorage.getItem('anon:today-minutes:2026-10-07')).toBe('30');
});

test('a stored override is applied on load', async () => {
  localStorage.setItem('anon:today-minutes:2026-10-07', '30');
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
  expect(localStorage.getItem('anon:today-minutes:2026-10-07')).toBeNull();
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

test('a new inline now() does not recompute the plan without data or override changes', async () => {
  const d = data();
  const mk = () => (
    <ToastProvider><MemoryRouter><Today load={async () => d} save={vi.fn()} now={() => new Date(NOW)} /></MemoryRouter></ToastProvider>
  );
  const { rerender } = render(mk());
  await screen.findByText(/Answer 10/);
  const calls = vi.mocked(planner.buildPlan).mock.calls.length;
  rerender(mk());
  rerender(mk());
  expect(vi.mocked(planner.buildPlan).mock.calls.length).toBe(calls);
});

test('crossing midnight reads the new day override and writes under the new key', async () => {
  localStorage.setItem('anon:today-minutes:2026-10-07', '10');
  localStorage.setItem('anon:today-minutes:2026-10-08', '30');
  let clock = new Date(NOW);
  const mk = () => (
    <ToastProvider><MemoryRouter><Today load={async () => data({ questions: qs(40) })} save={vi.fn()} now={() => clock} /></MemoryRouter></ToastProvider>
  );
  const { rerender } = render(mk());
  expect(await screen.findByText(/Answer 6 /)).toBeTruthy(); // 10 min
  clock = new Date(2026, 9, 8, 0, 5);
  rerender(mk());
  expect(screen.getByText(/Answer 20 /)).toBeTruthy(); // 30 min from the new key
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '15' } });
  expect(localStorage.getItem('anon:today-minutes:2026-10-08')).toBe('15');
  expect(localStorage.getItem('anon:today-minutes:2026-10-07')).toBe('10');
});

test('override is capped at 600 minutes', async () => {
  show(data({ questions: qs(1000) }));
  await screen.findByText(/Answer 40 /);
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '5000' } });
  expect(screen.getByText(/Answer 400 /)).toBeTruthy(); // 600 min / 90 s
});

test('minutes set but nothing to do shows a message instead of an empty list', async () => {
  show(data({ questions: [], cards: [] }));
  expect(await screen.findByText(/Nothing to do today/)).toBeTruthy();
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
});

// --- progress, fixed day plan, mark read, pace clamp, override max ---

const PLAN_KEY = 'anon:plan:2026-10-07';
const today = (h: number, m = 0) => new Date(2026, 9, 7, h, m).toISOString();
const ans = (q: string, when = today(10), ms = 90_000) => ({ question_id: q, correct: true, duration_ms: ms, answered_at: when });
const rv = (c: string, when = today(10), ms = 20_000) => ({ card_id: c, duration_ms: ms, reviewed_at: when });
const item = (re: RegExp) => screen.getAllByRole('listitem').find((li) => re.test(li.textContent ?? ''))!;
const seed = (minutes: number, tasks: unknown[], o: Record<string, unknown> = {}, key = PLAN_KEY) =>
  localStorage.setItem(key, JSON.stringify({ minutes, tasks, since: 0, hasCompletedRun: true, ...o }));
const stored = () => JSON.parse(localStorage.getItem(PLAN_KEY)!);
const renal10 = [{ kind: 'questions', system: SYS, count: 10, minutes: 15 }];

test('question task shows distinct questions answered since the plan in its system, readable by screen readers', async () => {
  const attempts = [
    ...qs(7).map((q) => ans(q.id)), ans(`${SYS}-q0`), // a repeat does not count twice
    ...qs(5, 'Nervous').map((q) => ans(q.id)), // another system does not count
    ans(`${SYS}-q20`, new Date(2026, 9, 6, 23, 59).toISOString()), // yesterday does not count
  ];
  seed(15, renal10);
  show(data({ questions: [...qs(40), ...qs(5, 'Nervous')], attempts, settings: wedSettings(15) }));
  await screen.findByText(/Answer 3 more /);
  expect(item(/Answer 3 more/).textContent).toMatch(/7\/10/);
  expect(screen.getByText('7 of 10 done')).toBeTruthy();
});

test('a finished task is checked, struck and clamped to its count, and all done shows when every task is done', async () => {
  seed(15, renal10);
  show(data({ questions: qs(40), attempts: qs(12).map((q) => ans(q.id)), settings: wedSettings(15) }));
  await screen.findByText(/Practice 10 more /);
  const li = item(/Practice 10 more/);
  expect(li.textContent).toMatch(/✓/);
  expect(li.textContent).toMatch(/10\/10/);
  expect(li.textContent).not.toMatch(/12\/10/);
  expect(screen.getByText('10 of 10 done')).toBeTruthy();
  expect(li.className).toBe('done');
  expect(screen.getByText('All done for today.')).toBeTruthy();
});

test('an unfinished task has no check and no all-done message', async () => {
  seed(15, renal10);
  show(data({ questions: qs(40), attempts: qs(3).map((q) => ans(q.id)), settings: wedSettings(15) }));
  await screen.findByText(/Answer 7 more /);
  expect(item(/Answer 7 more/).textContent).toMatch(/3\/10/);
  expect(item(/Answer 7 more/).textContent).not.toMatch(/✓/);
  expect(screen.queryByText('All done for today.')).toBeNull();
});

const qHref = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href');
const enc = encodeURIComponent(SYS);

test('a question task with no progress links to the full planned set', async () => {
  seed(15, renal10);
  show(data({ questions: qs(40), settings: wedSettings(15) }));
  await screen.findByText(/Answer 10 /);
  expect(qHref(/Answer 10 Renal & Urinary questions/)).toBe(`/questions?system=${enc}&n=10`);
});

test('a partly done question task asks for the remaining questions and resumes with done', async () => {
  seed(15, renal10);
  show(data({ questions: qs(40), attempts: qs(3).map((q) => ans(q.id)), settings: wedSettings(15) }));
  await screen.findByText(/Answer 7 more /);
  expect(qHref(/Answer 7 more Renal & Urinary questions/)).toBe(`/questions?system=${enc}&n=7&done=3`);
  expect(item(/Answer 7 more/).textContent).toMatch(/3\/10/);
});

test('a completed question task offers extra practice, not a resume', async () => {
  seed(15, renal10);
  show(data({ questions: qs(40), attempts: qs(12).map((q) => ans(q.id)), settings: wedSettings(15) }));
  await screen.findByText(/Practice 10 more /);
  expect(qHref(/Practice 10 more Renal & Urinary questions/)).toBe(`/questions?system=${enc}&n=10&practice=1`);
  const li = item(/Practice 10 more/);
  expect(li.textContent).toMatch(/✓/);
  expect(li.className).toBe('done');
});

test('flashcard task counts distinct cards reviewed since the plan', async () => {
  const reviews = [rv(`${SYS}-c0`), rv(`${SYS}-c0`), rv(`${SYS}-c1`), rv(`${SYS}-c2`, new Date(2026, 9, 6, 23, 59).toISOString())];
  seed(60, [{ kind: 'cards', count: 12, minutes: 4 }]);
  show(data({ reviews }));
  await screen.findByText(/Review 12 flashcards/);
  expect(item(/Review 12/).textContent).toMatch(/2\/12/);
});

test('first open of the day after morning activity starts the plan at 0', async () => {
  show(data({ questions: qs(80), attempts: qs(10).map((q) => ans(q.id, today(8))) }));
  await screen.findByText(/Answer 40 /);
  expect(item(/Answer 40/).textContent).toMatch(/0\/40/);
  expect(stored().since).toBe(NOW.getTime());
});

test('a card reviewed before the plan and again after it counts once and can complete the task', async () => {
  const since = new Date(2026, 9, 7, 11).getTime();
  seed(60, [{ kind: 'cards', count: 2, minutes: 1 }], { since });
  show(data({ reviews: [rv(`${SYS}-c0`, today(9)), rv(`${SYS}-c0`, today(13)), rv(`${SYS}-c0`, today(14)), rv(`${SYS}-c1`, today(13))] }));
  await screen.findByText(/Review 2 flashcards/);
  const li = item(/Review 2/);
  expect(li.textContent).toMatch(/2\/2/);
  expect(li.className).toBe('done');
});

test('a question re-answered after the plan counts once', async () => {
  const since = new Date(2026, 9, 7, 11).getTime();
  seed(15, renal10, { since });
  show(data({ questions: qs(40), attempts: [ans(`${SYS}-q0`, today(9)), ans(`${SYS}-q0`, today(13)), ans(`${SYS}-q0`, today(14)), ans(`${SYS}-q1`, today(10))], settings: wedSettings(15) }));
  await screen.findByText(/Answer 9 more /);
  expect(item(/Answer 9 more/).textContent).toMatch(/1\/10/);
});

test('unknown run state (runs failed to load) keeps a completed-run snapshot and its progress', async () => {
  seed(60, [{ kind: 'questions', system: SYS, count: 40, minutes: 60 }]);
  show(data({ questions: qs(80), attempts: qs(30).map((q) => ans(q.id)), hasCompletedRun: null }));
  await screen.findByText(/Answer 10 more /);
  expect(item(/Answer 10 more/).textContent).toMatch(/30\/40/);
  expect(stored()).toMatchObject({ since: 0, hasCompletedRun: true });
});

test('with unknown run state, rebuilding for minutes or on request keeps the stored completed-run value', async () => {
  seed(60, [{ kind: 'questions', system: SYS, count: 40, minutes: 60 }]);
  show(data({ questions: qs(80), hasCompletedRun: null }));
  await screen.findByText(/Answer 40 /);
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '30' } });
  expect(screen.getByText(/Answer 20 /)).toBeTruthy();
  expect(stored()).toMatchObject({ minutes: 30, hasCompletedRun: true });
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild plan' }));
  expect(stored()).toMatchObject({ minutes: 30, hasCompletedRun: true });
});

test('with unknown run state and nothing stored, a new plan is saved as not completed', async () => {
  show(data({ questions: qs(40), hasCompletedRun: null }));
  await screen.findByText(/Answer 40 /);
  expect(stored().hasCompletedRun).toBe(false);
});

test('rebuilding after 100 cards reviewed shows 0/15, not done', async () => {
  const past = new Date(2026, 9, 1).toISOString();
  const states = new Map(cs(15).map((c) => [c.id, { due: past }]));
  const reviews = cs(100, 'Other').map((c) => rv(c.id));
  seed(60, [{ kind: 'cards', count: 15, minutes: 5 }]);
  show(data({ states, cards: [...cs(15), ...cs(100, 'Other')], reviews }));
  await screen.findByText(/Review 15 flashcards/);
  expect(item(/Review 15/).className).toBe('done');
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild plan' }));
  const li = item(/Review 15/);
  expect(li.textContent).toMatch(/0\/15/);
  expect(li.className).toBe('');
});

test('the day plan is saved and reused, and progress after it counts normally', async () => {
  const { unmount } = show(data({ questions: qs(40) }));
  await screen.findByText(/Answer 40 /);
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!)).toMatchObject({ minutes: 60, tasks: [{ kind: 'questions', count: 40 }], hasCompletedRun: true });
  unmount();
  // Later: questions all answered, more content, due cards appear. The plan stays put, progress moves.
  const past = new Date(2026, 9, 1).toISOString();
  show(data({ questions: qs(80), attempts: qs(40).map((q) => ans(q.id, today(13))), cards: cs(30), states: new Map(cs(30).map((c) => [c.id, { due: past }])) }));
  await screen.findByText(/Practice 40 more /);
  expect(screen.queryByText(/Review \d+ flashcards/)).toBeNull();
  expect(item(/Practice 40 more/).textContent).toMatch(/40\/40/);
  expect(screen.getByText('All done for today.')).toBeTruthy();
});

test('a snapshot from another day or for other minutes is not used', async () => {
  const three = [{ kind: 'questions', system: SYS, count: 3, minutes: 4.5 }];
  seed(60, three, {}, 'anon:plan:2026-10-06');
  seed(30, three);
  show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 40 /)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).minutes).toBe(60);
});

test('a snapshot saved before the diagnostic is discarded once a completed run exists', async () => {
  const three = [{ kind: 'questions', system: SYS, count: 3, minutes: 4.5 }];
  seed(60, three, { hasCompletedRun: false });
  const { unmount } = show(data({ questions: qs(40), hasCompletedRun: null })); // unknown counts as not completed
  expect(await screen.findByText(/Answer 3 /)).toBeTruthy();
  unmount();
  show(data({ questions: qs(40), hasCompletedRun: true }));
  expect(await screen.findByText(/Answer 40 /)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).hasCompletedRun).toBe(true);
});

test('changing minutes today rebuilds and resaves the plan', async () => {
  show(data({ questions: qs(40) }));
  await screen.findByText(/Answer 40 /);
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '30' } });
  expect(screen.getByText(/Answer 20 /)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!)).toMatchObject({ minutes: 30, tasks: [{ count: 20 }] });
});

test('a corrupt snapshot or one without a baseline is ignored and replaced', async () => {
  localStorage.setItem(PLAN_KEY, '{oops');
  const { unmount } = show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 40 /)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).minutes).toBe(60);
  unmount();
  localStorage.setItem(PLAN_KEY, JSON.stringify({ minutes: 60, tasks: [{ kind: 'questions', system: SYS, count: 3, minutes: 4.5 }], hasCompletedRun: true }));
  show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 40 /)).toBeTruthy();
});

test('Rebuild plan discards the snapshot and recomputes from current data', async () => {
  seed(60, [{ kind: 'questions', system: SYS, count: 3, minutes: 4.5 }]);
  show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 3 /)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild plan' }));
  expect(screen.getByText(/Answer 40 /)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).tasks[0].count).toBe(40);
});

test('Rebuild plan works when removeItem throws but getItem works', async () => {
  seed(60, [{ kind: 'questions', system: SYS, count: 3, minutes: 4.5 }]);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  show(data({ questions: qs(40) }));
  expect(await screen.findByText(/Answer 3 /)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild plan' }));
  expect(screen.getByText(/Answer 40 /)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).tasks[0].count).toBe(40);
});

test('throwing storage: the plan shows and Rebuild plan still works', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  show(data({ questions: qs(40), attempts: qs(5).map((q) => ans(q.id)) }));
  await screen.findByText(/Answer 40 /);
  expect(item(/Answer 40/).textContent).toMatch(/0\/40/); // no stored baseline: measured from this visit
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild plan' }));
  expect(screen.getByText(/Answer 40 /)).toBeTruthy();
});

const noteDay = () => data({
  notes: [{ id: 'n1', title: 'Nephron basics', system: SYS, tags: ['t1'] }],
  questions: [...qs(40), ...qs(40, 'Skin')], settings: wedSettings(180), // ties rank alphabetically: Renal is the focus
});

test('the note task is marked read per day and remembered', async () => {
  const { unmount } = show(noteDay());
  await screen.findByText(/Nephron basics/);
  const box = screen.getByRole('checkbox', { name: /mark read/i }) as HTMLInputElement;
  expect(box.checked).toBe(false);
  expect(item(/Nephron/).className).toBe('');
  fireEvent.click(box);
  expect(box.checked).toBe(true);
  expect(item(/Nephron/).className).toBe('done');
  const key = `anon:note-done:2026-10-07:${SYS}`;
  expect(localStorage.getItem(key)).toBe('1');
  unmount();
  show(noteDay());
  await screen.findByText(/Nephron basics/);
  expect((screen.getByRole('checkbox', { name: /mark read/i }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /mark read/i }));
  expect(localStorage.getItem(key)).toBeNull();
});

test('two users on the same browser and day do not share plan, mark-read or override', async () => {
  setLastUserId('u1');
  seed(180, [{ kind: 'note', system: SYS, minutes: 6 }, { kind: 'questions', system: SYS, count: 3, minutes: 4.5 }], {}, 'u1:plan:2026-10-07');
  const { unmount } = show(noteDay());
  expect(await screen.findByText(/Answer 3 /)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /mark read/i }));
  fireEvent.change(screen.getByLabelText(/minutes today/i), { target: { value: '170' } });
  expect(localStorage.getItem(`u1:note-done:2026-10-07:${SYS}`)).toBe('1');
  expect(localStorage.getItem('u1:today-minutes:2026-10-07')).toBe('170');
  unmount();
  setLastUserId('u2');
  show(noteDay());
  await screen.findByText(/Nephron basics/);
  expect(screen.queryByText(/Answer 3 /)).toBeNull();
  expect((screen.getByRole('checkbox', { name: /mark read/i }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText(/minutes today/i) as HTMLInputElement).value).toBe('');
  expect(JSON.parse(localStorage.getItem('u2:plan:2026-10-07')!).minutes).toBe(180);
});

test('mark read works with throwing storage for this visit', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  show(noteDay());
  await screen.findByText(/Nephron basics/);
  fireEvent.click(screen.getByRole('checkbox', { name: /mark read/i }));
  expect(item(/Nephron/).className).toBe('done');
});

test('a tiny measured card pace is clamped to 8 s per card', async () => {
  const past = new Date(2026, 9, 1).toISOString();
  const states = new Map(cs(1000).map((c) => [c.id, { due: past }]));
  const reviews = cs(50).map((c) => rv(c.id, new Date(2026, 9, 5).toISOString(), 1000)); // 1 s per card
  show(data({ states, cards: cs(1000), reviews }));
  const li = (await screen.findAllByRole('listitem'))[0];
  const n = Number(li.textContent!.match(/Review (\d+) flashcards/)![1]);
  expect(n).toBeLessThanOrEqual(Math.floor((0.4 * 60 * 60) / 8));
});

test('override above 600 fills an always-present status and uses 600', async () => {
  show(data({ questions: qs(1000) }));
  await screen.findByText(/Answer 40 /);
  const box = screen.getByLabelText(/minutes today/i);
  expect(box.getAttribute('max')).toBe('600');
  const status = screen.getByRole('status');
  expect(status.textContent).toBe('');
  fireEvent.change(box, { target: { value: '6010' } });
  expect(screen.getByRole('status')).toBe(status);
  expect(status.textContent).toBe('Maximum is 600 minutes, using 600.');
  fireEvent.change(box, { target: { value: '600' } });
  expect(status.textContent).toBe('');
});

test('loading is a status and the weekly progress bar is labelled', async () => {
  show(data());
  expect(screen.getByRole('status')).toBeTruthy();
  expect(await screen.findByLabelText('Minutes this week')).toBeTruthy();
});

test('Portuguese: tile titles, plan text and settings follow the language, study names stay as they are', async () => {
  localStorage.setItem('ui-lang', 'pt');
  render(
    <LangProvider><ToastProvider><MemoryRouter>
      <Today load={async () => data({ settings: { ...DEFAULT_SETTINGS, target_date: '2026-10-10' } })} save={vi.fn()} now={() => NOW} />
    </MemoryRouter></ToastProvider></LangProvider>,
  );
  expect(await screen.findByText('Suas tarefas')).toBeTruthy();
  for (const t of ['Seu plano', 'Contagem regressiva', 'Esta semana', 'Como você está', 'Refazer plano', 'Minutos hoje', 'Configurações do plano']) {
    expect(screen.getAllByText(new RegExp(t)).length).toBeGreaterThan(0);
  }
  expect(screen.getByText(/faltam 3 dias/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Responder 10 questões de/ })).toBeTruthy();
  expect(screen.queryByText('Your tasks')).toBeNull();
});

test('on the target date the countdown says it is exam day instead of "0 days left"', async () => {
  show(data({ settings: { ...DEFAULT_SETTINGS, target_date: '2026-10-07' } }));
  expect(await screen.findByText('Exam day is today')).toBeTruthy();
  expect(screen.queryByText(/0 days left/)).toBeNull();
});
