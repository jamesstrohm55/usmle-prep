import { render, screen, fireEvent } from '@testing-library/react';
import { Notes } from './Notes';
import { ToastProvider } from '../../ui/Toast';
import type { Note } from '../../db/models';

const note = (id: string, pt: string | null = null): Note => ({
  id, slug: id, owner_id: null, track: 'step1', system: 'cardio', discipline: 'path', tags: [],
  title: `title-${id}`, body_md: `body-${id}`, body_pt_md: pt,
} as Note);
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

test('lists notes and expands a body on tap', async () => {
  wrap(<Notes load={async () => [note('1'), note('2')]} />);
  expect(await screen.findByText(/title-1/)).toBeTruthy();
  expect(screen.getByText(/title-2/)).toBeTruthy();
  expect(screen.queryByText('body-1')).toBeNull();
  const toggle = screen.getByRole('button', { name: /title-1/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(screen.getByText('body-1')).toBeTruthy();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.closest('h3')).toBeTruthy();
});

test('pt-BR toggle only when body_pt_md exists; English first', async () => {
  wrap(<Notes load={async () => [note('1', 'corpo-1'), note('2')]} />);
  fireEvent.click(await screen.findByText(/title-1/));
  expect(screen.getByText('body-1')).toBeTruthy();
  fireEvent.click(screen.getByText('Ver em português'));
  expect(screen.getByText('corpo-1')).toBeTruthy();
  expect(screen.getByText('Show English')).toBeTruthy();
  fireEvent.click(screen.getByText(/title-1/)); // collapse
  fireEvent.click(screen.getByText(/title-2/));
  expect(screen.queryByText('Ver em português')).toBeNull();
});

test('failed load shows inline error with Retry, not endless Loading', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([note('1')]);
  wrap(<Notes load={load} />);
  expect(await screen.findByText(/Could not load notes: boom/)).toBeTruthy();
  expect(screen.queryByText('Loading…')).toBeNull();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText(/title-1/)).toBeTruthy();
});
