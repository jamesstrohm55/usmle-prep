import type { Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Diagnostic, type DiagnosticData, type DiagnosticDeps } from './Diagnostic';
import { ToastProvider } from '../../ui/Toast';
import { DIAGNOSTIC_SIZE } from '../../engine/diagnostic';
import * as diag from '../../engine/diagnostic';
import type { Question } from '../../db/models';
import type { Run } from '../../db/queries';

vi.mock('../../engine/diagnostic', async (orig) => {
  const m = await orig<typeof import('../../engine/diagnostic')>();
  return { ...m, sampleDiagnostic: vi.fn(m.sampleDiagnostic) };
});

const q = (id: string, system: string): Question => ({
  id, slug: id, owner_id: null, track: 'step1', system, discipline: 'path', tags: [],
  stem: `stem-${id}`, choices: ['A1', 'B1', 'C1'], correct: 1, explanation: `exp-${id}`,
  explanation_pt: `pt-${id}`, image_url: null, image_credit: null,
});
// 8 cardiovascular + 4 renal = 12 questions.
const bank = [
  ...Array.from({ length: 8 }, (_, i) => q(`c${i}`, 'cardiovascular')),
  ...Array.from({ length: 4 }, (_, i) => q(`r${i}`, 'renal')),
];
const ORDER = bank.map((x) => x.id);
const mkRun = (status: Run['status'], ids = ORDER): Run =>
  ({ id: 'run-1', started_at: '2026-10-07T00:00:00Z', completed_at: null, status, question_ids: ids, seed: 's' });
const rows = (ids: string[], correct = true) => ids.map((id) => ({ question_id: id, chosen: correct ? 1 : 0, correct }));

function setup(data: Partial<DiagnosticData> = {}, over: Partial<DiagnosticDeps> = {}) {
  const deps = {
    createRun: vi.fn(async (ids: string[], seed: string) => ({ ...mkRun('in_progress', ids), seed })),
    setRunStatus: vi.fn(async () => {}),
    fetchRunAttempts: vi.fn(async () => [] as ReturnType<typeof rows>),
    saveAttempts: vi.fn(async () => {}),
    ...over,
  } as { [K in keyof DiagnosticDeps]: Mock<DiagnosticDeps[K]> };
  const load = async () => ({ questions: bank, attempts: [], runs: [], ...data }) as DiagnosticData;
  render(<ToastProvider><Diagnostic load={load} deps={deps} /></ToastProvider>);
  return deps;
}
const stemShown = () => screen.getByText(/^stem-/).textContent!.replace('stem-', '');

afterEach(() => { vi.restoreAllMocks(); vi.mocked(diag.sampleDiagnostic).mockClear(); });

test('start creates a run of the right size and shows the first question with no explanation', async () => {
  const deps = setup();
  fireEvent.click(await screen.findByText('Start diagnostic'));
  await screen.findByText(/^stem-/);
  const [ids, seed] = deps.createRun.mock.calls[0];
  expect(ids).toHaveLength(Math.min(DIAGNOSTIC_SIZE, bank.length));
  expect(typeof seed).toBe('string');
  expect(stemShown()).toBe(ids[0]);
  expect(screen.getByText('0 of 12 answered')).toBeTruthy();
  expect(screen.queryByText(/^exp-/)).toBeNull();
});

test('answering saves one timed row tied to the run', async () => {
  const deps = setup();
  fireEvent.click(await screen.findByText('Start diagnostic'));
  await screen.findByText(/^stem-/);
  const first = stemShown();
  fireEvent.click(screen.getByText('B1'));
  await screen.findByText('1 of 12 answered');
  expect(deps.saveAttempts).toHaveBeenCalledTimes(1);
  expect(deps.saveAttempts.mock.calls[0][0]).toEqual([
    expect.objectContaining({ question_id: first, chosen: 1, correct: true, mode: 'timed', session_id: 'run-1' }),
  ]);
  expect(screen.queryByText(/✓|✗|correct/i)).toBeNull();
});

test('resume skips questions already answered in the run and never re-saves them', async () => {
  const deps = setup({ runs: [mkRun('in_progress')] }, { fetchRunAttempts: vi.fn(async () => rows(['c0', 'c1'])) });
  expect(await screen.findByText('2 of 12 answered')).toBeTruthy();
  fireEvent.click(screen.getByText('Resume'));
  expect(stemShown()).toBe('c2');
  fireEvent.click(screen.getByText('A1'));
  await screen.findByText('3 of 12 answered');
  expect(stemShown()).toBe('c3');
  const saved = deps.saveAttempts.mock.calls.flatMap((c) => c[0].map((r) => r.question_id));
  expect(saved).toEqual(['c2']);
});

test('a double click on one choice saves once', async () => {
  const deps = setup({ runs: [mkRun('in_progress')] });
  fireEvent.click(await screen.findByText('Resume'));
  fireEvent.click(screen.getByText('B1'));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByText('1 of 12 answered');
  expect(deps.saveAttempts).toHaveBeenCalledTimes(1);
});

test('23505 counts as saved; another error shows a toast, keeps the question, and Retry saves it', async () => {
  const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
  const save = vi.fn().mockRejectedValueOnce(dup).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  setup({ runs: [mkRun('in_progress')] }, { saveAttempts: save });
  fireEvent.click(await screen.findByText('Resume'));
  fireEvent.click(screen.getByText('B1'));
  await screen.findByText('1 of 12 answered');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(stemShown()).toBe('c1');

  fireEvent.click(screen.getByText('B1'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(/offline/)).toBeTruthy();
  expect(stemShown()).toBe('c1');
  expect(screen.getByText('1 of 12 answered')).toBeTruthy();

  fireEvent.click(screen.getByText('Retry'));
  await screen.findByText('2 of 12 answered');
  expect(save).toHaveBeenCalledTimes(3);
  expect(save.mock.calls[2][0][0].question_id).toBe('c1');
  expect(stemShown()).toBe('c2');
});

test('pause shows the sitting review with explanations; Back shows Resume', async () => {
  setup({ runs: [mkRun('in_progress')] }, { fetchRunAttempts: vi.fn(async () => rows(['c0'])) });
  fireEvent.click(await screen.findByText('Resume'));
  fireEvent.click(screen.getByText('A1'));
  await screen.findByText('2 of 12 answered');
  fireEvent.click(screen.getByText('Pause'));
  expect(screen.getByText('exp-c1')).toBeTruthy();
  expect(screen.queryByText('exp-c0')).toBeNull(); // previous sitting is not repeated
  expect(screen.getByText(/Your answer: A1/)).toBeTruthy();
  expect(screen.getByText(/Correct answer: B1/)).toBeTruthy();
  fireEvent.click(screen.getByText('Ver em português'));
  expect(screen.getByText('pt-c1')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('Resume')).toBeTruthy();
  expect(screen.getByText('2 of 12 answered')).toBeTruthy();
});

test('answering the last question completes the run and shows per-system results', async () => {
  // 11 answered: all 8 cardiovascular (6 correct), 3 renal (all correct); r3 is left.
  const prior = [...rows(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']), ...rows(['c6', 'c7'], false), ...rows(['r0', 'r1', 'r2'])];
  const deps = setup({ runs: [mkRun('in_progress')] }, { fetchRunAttempts: vi.fn(async () => prior) });
  fireEvent.click(await screen.findByText('Resume'));
  expect(stemShown()).toBe('r3');
  fireEvent.click(screen.getByText('A1')); // wrong
  await waitFor(() => expect(deps.setRunStatus).toHaveBeenCalledWith('run-1', 'completed'));
  expect(await screen.findByText('exp-r3')).toBeTruthy(); // sitting review first
  fireEvent.click(screen.getByText('See results'));
  expect(screen.getByText('9 of 12 correct')).toBeTruthy();
  expect(screen.getByText(/cardiovascular: 6 of 8 correct \(75%\)/)).toBeTruthy();
  expect(screen.getByText(/renal: 3 of 4 correct \(75%\) · low confidence/)).toBeTruthy();
  expect(screen.queryByText(/cardiovascular.*low confidence/)).toBeNull();
  expect(screen.getByText('Start another diagnostic')).toBeTruthy();
});

test('a failed completion shows a toast with Retry and still shows the answers', async () => {
  const status = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const prior = rows(ORDER.slice(0, 11));
  setup({ runs: [mkRun('in_progress')] }, { fetchRunAttempts: vi.fn(async () => prior), setRunStatus: status });
  fireEvent.click(await screen.findByText('Resume'));
  fireEvent.click(screen.getByText('B1'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('exp-r3')).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
  expect(status).toHaveBeenLastCalledWith('run-1', 'completed');
});

test('start over asks first; confirming abandons the run', async () => {
  const deps = setup({ runs: [mkRun('in_progress')] });
  await screen.findByText('Resume');
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  fireEvent.click(screen.getByText('Start over'));
  expect(deps.setRunStatus).not.toHaveBeenCalled();
  expect(screen.getByText('Resume')).toBeTruthy();
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  fireEvent.click(screen.getByText('Start over'));
  await screen.findByText('Start diagnostic');
  expect(deps.setRunStatus).toHaveBeenCalledWith('run-1', 'abandoned');
});

test('a completed latest run shows its results and Start another diagnostic', async () => {
  const deps = setup({ runs: [mkRun('completed'), { ...mkRun('abandoned'), id: 'old' }] }, { fetchRunAttempts: vi.fn(async () => rows(ORDER)) });
  expect(await screen.findByText('12 of 12 correct')).toBeTruthy();
  expect(deps.fetchRunAttempts).toHaveBeenCalledWith('run-1');
  fireEvent.click(screen.getByText('Start another diagnostic'));
  await screen.findByText(/^stem-/);
  expect(deps.createRun).toHaveBeenCalledTimes(1);
});

test('a system with only 2 questions is drawn in full without error', async () => {
  const deps = setup({ questions: [q('a', 'renal'), q('b', 'renal')] });
  fireEvent.click(await screen.findByText('Start diagnostic'));
  await screen.findByText('0 of 2 answered');
  expect([...deps.createRun.mock.calls[0][0]].sort()).toEqual(['a', 'b']);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the draw passes previously answered ids so the sampler can prefer unseen ones', async () => {
  const attempts = ['c0', 'c1', 'c0'].map((id) => ({ question_id: id, correct: true, duration_ms: 1, answered_at: '2026-10-01T00:00:00Z' }));
  setup({ attempts });
  fireEvent.click(await screen.findByText('Start diagnostic'));
  await screen.findByText(/^stem-/);
  const [qs, seen] = vi.mocked(diag.sampleDiagnostic).mock.calls[0];
  expect(qs).toHaveLength(12);
  expect([...seen].sort()).toEqual(['c0', 'c1']);
});

test('a load failure shows Could not load and Retry', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ questions: bank, attempts: [], runs: [] });
  render(<ToastProvider><Diagnostic load={load} deps={{ createRun: vi.fn(), setRunStatus: vi.fn(), fetchRunAttempts: vi.fn(), saveAttempts: vi.fn() }} /></ToastProvider>);
  expect(await screen.findByText(/Could not load/)).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText('Start diagnostic')).toBeTruthy();
});
