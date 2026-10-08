import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuestionsRoute } from './Questions';
import { ToastProvider } from '../../ui/Toast';

const bank = [{
  id: 'r1', slug: 'r1', owner_id: null, track: 'step1', system: 'renal', discipline: 'path', tags: [],
  stem: 's', choices: ['a', 'b'], correct: 0, explanation: 'e', explanation_pt: null, image_url: null, image_credit: null,
}];
vi.mock('../../db/queries', async (orig) => ({
  ...(await orig<typeof import('../../db/queries')>()),
  fetchQuestions: async () => bank, fetchAttempts: async () => [], saveAttempts: async () => {}, setItemStatus: vi.fn(),
}));

const at = (url: string) => render(<ToastProvider><MemoryRouter initialEntries={[url]}><QuestionsRoute /></MemoryRouter></ToastProvider>);

test('valid system and n pass the preset', async () => {
  at('/questions?system=renal&n=3');
  expect(await screen.findByText(/Start planned set \(1 questions in renal\)/)).toBeTruthy();
});

test.each(['?system=renal&n=abc', '?system=renal&n=0', '?system=renal&n=500', '?n=3', '?system=renal&n=2.5', '?system=renal'])('%s renders without a preset', async (qs) => {
  at(`/questions${qs}`);
  expect(await screen.findByText(/Start tutor session/)).toBeTruthy();
  expect(screen.queryByText(/Start planned set/)).toBeNull();
});
