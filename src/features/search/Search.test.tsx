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
