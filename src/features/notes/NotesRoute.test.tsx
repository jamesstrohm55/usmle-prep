import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotesRoute } from './Notes';
import { ToastProvider } from '../../ui/Toast';

const note = (id: string) => ({
  id, slug: id, owner_id: null, track: 'step1', system: 'renal', discipline: 'path', tags: [],
  title: `title-${id}`, body_md: `body-${id}`, body_pt_md: null,
});
vi.mock('../../db/queries', async (orig) => ({
  ...(await orig<typeof import('../../db/queries')>()),
  fetchNotes: async () => [note('a'), note('b')],
}));

const at = (url: string) => render(<ToastProvider><MemoryRouter initialEntries={[url]}><NotesRoute /></MemoryRouter></ToastProvider>);

test('/notes?note=b shows only that note, open', async () => {
  at('/notes?note=b');
  expect(await screen.findByText('body-b')).toBeTruthy();
  expect(screen.queryByText(/title-a/)).toBeNull();
});

test('/notes with no note param lists every note, closed', async () => {
  at('/notes');
  expect(await screen.findByText(/title-a/)).toBeTruthy();
  expect(screen.getByText(/title-b/)).toBeTruthy();
  expect(screen.queryByText('body-a')).toBeNull();
});
