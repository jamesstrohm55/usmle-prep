import { render, screen } from '@testing-library/react';

const fetchRuns = vi.fn();
vi.mock('./db/queries', () => ({ fetchRuns: () => fetchRuns(), clearCache: vi.fn() }));
vi.mock('./db/client', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('./features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./features/planner/Today', () => ({ Today: () => <div>TodayScreen</div> }));
vi.mock('./features/diagnostic/Diagnostic', () => ({ Diagnostic: () => <div>DiagnosticScreen</div> }));
vi.mock('./features/flashcards/Flashcards', () => ({ Flashcards: () => <div>CardsScreen</div> }));
vi.mock('./features/questions/Questions', () => ({ QuestionsRoute: () => <div>QuestionsScreen</div> }));
vi.mock('./features/notes/Notes', () => ({ Notes: () => <div>NotesScreen</div> }));
vi.mock('./features/search/Search', () => ({ Search: () => <div>SearchScreen</div> }));
vi.mock('./features/import-export/ImportExport', () => ({ ImportExport: () => <div>DataScreen</div> }));

import { App } from './App';

beforeEach(() => { fetchRuns.mockReset(); window.location.hash = '#/'; });

test('landing with a completed run goes to Today', async () => {
  fetchRuns.mockResolvedValue([{ status: 'abandoned' }, { status: 'completed' }]);
  render(<App />);
  expect(screen.getByText('Loading…')).toBeTruthy();
  await screen.findByText('TodayScreen');
});

test('landing with no completed run goes to Diagnostic', async () => {
  fetchRuns.mockResolvedValue([{ status: 'in_progress' }]);
  render(<App />);
  await screen.findByText('DiagnosticScreen');
});

test('landing falls back to Today when fetchRuns fails', async () => {
  fetchRuns.mockRejectedValue(new Error('offline'));
  render(<App />);
  await screen.findByText('TodayScreen');
});

test('nav has the eight items in order with the right targets', () => {
  window.location.hash = '#/notes';
  render(<App />);
  const items = [...document.querySelectorAll('nav > a, nav > button')];
  expect(items.map((e) => e.textContent)).toEqual(['Today', 'Diagnostic', 'Cards', 'Questions', 'Notes', 'Search', 'Import / Export', 'Sign out']);
  expect(items.slice(0, 7).map((e) => e.getAttribute('href'))).toEqual(['#/today', '#/diagnostic', '#/cards', '#/questions', '#/notes', '#/search', '#/data']);
});

test('/cards renders Flashcards', async () => {
  window.location.hash = '#/cards';
  render(<App />);
  await screen.findByText('CardsScreen');
});
