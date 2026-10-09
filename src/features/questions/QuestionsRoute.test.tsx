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
  expect(await screen.findByText(/Start planned set \(1 question in Renal\)/)).toBeTruthy();
});

test.each(['?system=renal&n=abc', '?system=renal&n=0', '?n=3', '?system=renal&n=2.5', '?system=renal'])('%s renders without a preset', async (qs) => {
  at(`/questions${qs}`);
  expect(await screen.findByText(/Start tutor session/)).toBeTruthy();
  expect(screen.queryByText(/Start planned set/)).toBeNull();
});

test('URL-encoded system is decoded', async () => {
  bank[0].system = 'Heme/Onc';
  at('/questions?system=Heme%2FOnc&n=3');
  expect(await screen.findByText(/Start planned set \(1 question in Heme\/Onc\)/)).toBeTruthy();
});

test('valid done shows Resume', async () => {
  bank[0].system = 'renal';
  at('/questions?system=renal&n=3&done=4');
  expect(await screen.findByText(/Resume planned set \(1 question left in Renal, 4 done\)/)).toBeTruthy();
});

test.each(['abc', '2.5', '-1', '', '0'])('done=%s is ignored', async (d) => {
  bank[0].system = 'renal';
  at(`/questions?system=renal&n=3&done=${d}`);
  expect(await screen.findByText(/Start planned set \(1 question in Renal\)/)).toBeTruthy();
  expect(screen.queryByText(/Resume/)).toBeNull();
});

test('done above the cap is clamped like n, not dropped', async () => {
  bank[0].system = 'renal';
  at('/questions?system=renal&n=3&done=1500');
  expect(await screen.findByText(/Resume planned set \(1 question left in Renal, 1000 done\)/)).toBeTruthy();
});

test.each(['100', '700', '1000'])('done=%s is accepted (a long day can plan hundreds of questions)', async (d) => {
  bank[0].system = 'renal';
  at(`/questions?system=renal&n=3&done=${d}`);
  expect(await screen.findByText(new RegExp(`Resume planned set \\(1 question left in Renal, ${d} done\\)`))).toBeTruthy();
});

test('practice=1 shows the practice label', async () => {
  bank[0].system = 'renal';
  at('/questions?system=renal&n=3&practice=1');
  expect(await screen.findByText(/Start practice set \(1 questions? in Renal\)/)).toBeTruthy();
});

test('practice other than 1 is ignored', async () => {
  bank[0].system = 'renal';
  at('/questions?system=renal&n=3&practice=yes');
  expect(await screen.findByText(/Start planned set \(1 question in Renal\)/)).toBeTruthy();
});

test('done or practice without a valid system and n still gives no preset', async () => {
  at('/questions?n=3&done=2&practice=1');
  expect(await screen.findByText(/Start tutor session/)).toBeTruthy();
  expect(screen.queryByText(/planned set|practice set/)).toBeNull();
});

test('n up to 1000 is kept and above that is clamped, not dropped', async () => {
  const original = bank.splice(0, bank.length);
  for (let i = 0; i < 1005; i++) bank.push({ ...original[0], id: `r${i}`, slug: `r${i}`, system: 'renal' });
  const first = at('/questions?system=renal&n=300');
  expect(await screen.findByText(/Start planned set \(300 questions in Renal\)/)).toBeTruthy();
  first.unmount();
  at('/questions?system=renal&n=5000');
  expect(await screen.findByText(/Start planned set \(1000 questions in Renal\)/)).toBeTruthy();
  bank.splice(0, bank.length, ...original);
});
