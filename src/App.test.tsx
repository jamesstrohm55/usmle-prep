import { fireEvent, render, screen } from '@testing-library/react';

const fetchRuns = vi.fn();
vi.mock('./db/queries', () => ({ fetchRuns: () => fetchRuns(), clearCache: vi.fn() }));
const getSession = vi.fn();
vi.mock('./db/client', () => ({
  supabase: { auth: { signOut: vi.fn(), getSession: () => getSession(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } },
}));
vi.mock('./features/auth/AuthGate', () => ({ AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./features/planner/Today', () => ({ Today: () => <div>TodayScreen</div> }));
vi.mock('./features/diagnostic/Diagnostic', () => ({ Diagnostic: () => <div>DiagnosticScreen</div> }));
vi.mock('./features/flashcards/Flashcards', () => ({ Flashcards: () => <div>CardsScreen</div> }));
vi.mock('./features/questions/Questions', () => ({ QuestionsRoute: () => <div>QuestionsScreen</div> }));
vi.mock('./features/notes/Notes', () => ({ Notes: () => <div>NotesScreen</div> }));
vi.mock('./features/search/Search', () => ({ Search: () => <div>SearchScreen</div> }));
vi.mock('./features/import-export/ImportExport', () => ({ ImportExport: () => <div>DataScreen</div> }));

import { App } from './App';

beforeEach(() => { fetchRuns.mockReset(); getSession.mockReset(); getSession.mockResolvedValue({ data: { session: null } }); window.location.hash = '#/'; });

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

test('the landing loading text is a status', () => {
  fetchRuns.mockReturnValue(new Promise(() => {}));
  render(<App />);
  expect(screen.getByRole('status').textContent).toBe('Loading…');
});

const navLabels = () => [...document.querySelectorAll('nav > a, nav > button')].map((e) => e.textContent);

describe('EN/PT menu switch', () => {
  beforeEach(() => localStorage.clear());

  test('defaults to English and switches only the menu to Portuguese, then remembers it', () => {
    window.location.hash = '#/cards';
    const { unmount } = render(<App />);
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'PT' }));
    expect(navLabels()).toEqual(['Hoje', 'Diagnóstico', 'Cartões', 'Questões', 'Notas', 'Buscar', 'Importar / Exportar', 'Sair']);
    expect(screen.getByRole('button', { name: 'PT' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('nav')!.getAttribute('lang')).toBe('pt-BR');
    expect(screen.getByText('CardsScreen')).toBeTruthy(); // the screen itself is untouched
    unmount();
    render(<App />); // a later visit starts in Portuguese
    expect(navLabels()[0]).toBe('Hoje');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(navLabels()[0]).toBe('Today');
  });

  test('a storage failure leaves the switch working for this visit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    window.location.hash = '#/notes';
    render(<App />);
    expect(navLabels()[0]).toBe('Today');
    fireEvent.click(screen.getByRole('button', { name: 'PT' }));
    expect(navLabels()[0]).toBe('Hoje');
    vi.restoreAllMocks();
  });
});

describe('account in the top right', () => {
  const session = (user: object) => getSession.mockResolvedValue({ data: { session: { user } } });

  test('shows the Google account name and photo', async () => {
    session({ email: 'v@x.co', user_metadata: { full_name: 'Vanessa Silva', avatar_url: 'https://lh3.example/photo.jpg' } });
    window.location.hash = '#/notes';
    render(<App />);
    expect(await screen.findByText('Vanessa Silva')).toBeTruthy();
    const img = document.querySelector('.account img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://lh3.example/photo.jpg');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  test('falls back to the name field, then the email, and to initials without a photo', async () => {
    session({ email: 'jim@x.co', user_metadata: { name: 'James Strohm' } });
    window.location.hash = '#/notes';
    const { unmount } = render(<App />);
    expect(await screen.findByText('James Strohm')).toBeTruthy();
    expect(document.querySelector('.account img')).toBeNull();
    expect(document.querySelector('.account .avatar')!.textContent).toBe('JS');
    unmount();
    session({ email: 'only@x.co' });
    render(<App />);
    expect(await screen.findByText('only@x.co')).toBeTruthy();
  });

  test('shows nothing when nobody is signed in', async () => {
    window.location.hash = '#/notes';
    render(<App />);
    await screen.findByText('NotesScreen');
    expect(document.querySelector('.account')).toBeNull();
  });
});
