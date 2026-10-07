import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Search } from './Search';
import { ToastProvider } from '../../ui/Toast';

const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const hit = (title: string) => ({ kind: 'card' as const, id: title, title, track: 'step1', system: 'cardio' });
const go = (term: string) => {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: term } });
  fireEvent.submit(screen.getByRole('search'));
};
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

test('does not query for an empty or whitespace-only term', async () => {
  const load = vi.fn().mockResolvedValue([]);
  wrap(<Search load={load} />);
  go('   ');
  expect(load).not.toHaveBeenCalled();
});

test('shows hits grouped with kind labels', async () => {
  const load = vi.fn().mockResolvedValue([hit('Beck triad')]);
  wrap(<Search load={load} />);
  go('beck');
  await waitFor(() => expect(screen.getByText('Beck triad')).toBeTruthy());
  expect(screen.getByText(/card/i)).toBeTruthy();
});

test('says so when nothing matches, but not before a search runs', async () => {
  wrap(<Search load={async () => []} />);
  expect(screen.queryByText(/no results/i)).toBeNull();
  go('zzz');
  expect(await screen.findByText(/no results/i)).toBeTruthy();
});

test('a slower older response does not overwrite a newer one', async () => {
  const a = deferred<ReturnType<typeof hit>[]>();
  const b = deferred<ReturnType<typeof hit>[]>();
  const load = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  wrap(<Search load={load} />);
  go('beck');
  go('mitral');
  b.resolve([hit('Mitral stenosis')]);
  await screen.findByText('Mitral stenosis');
  a.resolve([hit('Beck triad')]);
  await new Promise((r) => setTimeout(r, 10));
  expect(screen.queryByText('Beck triad')).toBeNull();
  expect(screen.getByText('Mitral stenosis')).toBeTruthy();
});

test('failed search toasts, offers Retry for the original term, and shows no "No results"', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([hit('Beck triad')]);
  wrap(<Search load={load} />);
  go('beck');
  expect(await screen.findByText(/Search failed: boom/)).toBeTruthy();
  expect(screen.queryByText(/no results/i)).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'other' } });
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText('Beck triad')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith('beck');
});

const opened = async (kind: 'card' | 'question' | 'note', row: Record<string, unknown>, lookup = vi.fn().mockResolvedValue(row)) => {
  wrap(<Search load={async () => [{ kind, id: 'x1', title: 'The hit', track: 'step1', system: 'cardio' }]} lookup={lookup} />);
  go('hit');
  fireEvent.click(await screen.findByRole('button', { name: /The hit/ }));
  return lookup;
};

test('opening a card hit shows the back with pt-BR on demand', async () => {
  const lookup = await opened('card', { back: 'the **back**', back_pt: 'o verso' });
  expect(await screen.findByText('back')).toBeTruthy();
  expect(lookup).toHaveBeenCalledWith('card', 'x1');
  expect(screen.queryByText('o verso')).toBeNull();
  fireEvent.click(screen.getByText('Ver em português'));
  expect(screen.getByText('o verso')).toBeTruthy();
});

test('opening a question hit shows stem, choices, correct answer and explanation', async () => {
  await opened('question', { stem: 'Which?', choices: ['aa', 'bb'], correct: 1, explanation: 'because', explanation_pt: null });
  expect(await screen.findByText('Which?')).toBeTruthy();
  expect(screen.getByText(/bb ✓/)).toBeTruthy();
  expect(screen.getByText('aa')).toBeTruthy();
  expect(screen.getByText('because')).toBeTruthy();
  expect(screen.queryByText('Ver em português')).toBeNull();
});

test('opening a note hit shows the body; the toggle has aria-expanded and collapses', async () => {
  await opened('note', { body_md: 'note body', body_pt_md: null });
  expect(await screen.findByText('note body')).toBeTruthy();
  const b = screen.getByRole('button', { name: /The hit/ });
  expect(b.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(b);
  expect(b.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('note body')).toBeNull();
});

test('row not found and load errors are handled; Retry works', async () => {
  const lookup = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
  await opened('card', {}, lookup);
  expect(await screen.findByText(/Could not open: boom/)).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText(/no longer available/)).toBeTruthy();
});

test('an expanded card hit with an image shows it', async () => {
  await opened('card', { back: 'b', back_pt: null, image_url: 'images/x.jpg', image_credit: 'CC0' });
  expect((await screen.findByAltText('Clinical image (see the question)')).getAttribute('src')).toBe(`${import.meta.env.BASE_URL}images/x.jpg`);
});
