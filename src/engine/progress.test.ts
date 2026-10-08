import { doneToday, parseSnapshot } from './progress';

const NOW = new Date(2026, 9, 7, 12); // local
const iso = (month: number, day: number, h: number, m: number) => new Date(2026, month, day, h, m).toISOString();
const att = (q: string, when: string) => ({ question_id: q, correct: true, duration_ms: 60_000, answered_at: when });
const rev = (c: string, when: string) => ({ card_id: c, duration_ms: 10_000, reviewed_at: when });
const qSystem = new Map([['q1', 'renal'], ['q2', 'renal'], ['q3', 'nervous']]);

test('doneToday counts distinct cards and distinct questions per system', () => {
  const t = iso(9, 7, 10, 0);
  const d = doneToday(
    [att('q1', t), att('q1', t), att('q2', t), att('q3', t), att('unknown', t)],
    [rev('c1', t), rev('c1', t), rev('c2', t)],
    qSystem, NOW,
  );
  expect(d.cards).toBe(2);
  expect(d.questions).toEqual({ renal: 2, nervous: 1 });
});

test('doneToday uses the local calendar day: 23:59 yesterday and 00:00 tomorrow do not count, 00:01 today does', () => {
  const d = doneToday(
    [att('q1', iso(9, 6, 23, 59)), att('q2', iso(9, 7, 0, 1)), att('q3', iso(9, 8, 0, 0))],
    [rev('c1', iso(9, 6, 23, 59)), rev('c2', iso(9, 7, 0, 1)), rev('c3', 'garbage')],
    qSystem, NOW,
  );
  expect(d.cards).toBe(1);
  expect(d.questions).toEqual({ renal: 1 });
});

const tasks = [
  { kind: 'cards', count: 5, minutes: 2 },
  { kind: 'note', system: 'renal', minutes: 6 },
  { kind: 'questions', system: 'renal', count: 10, minutes: 15 },
];

test('parseSnapshot returns the saved plan when minutes match', () => {
  expect(parseSnapshot(JSON.stringify({ minutes: 60, tasks }), 60)).toEqual({ minutes: 60, tasks });
});

test('parseSnapshot rejects a different minutes value, missing, corrupt or malformed snapshots', () => {
  expect(parseSnapshot(JSON.stringify({ minutes: 30, tasks }), 60)).toBeNull();
  for (const raw of [
    null, '', '{not json', 'null', '42', JSON.stringify({ minutes: 60 }), JSON.stringify({ minutes: 60, tasks: {} }),
    JSON.stringify({ minutes: 60, tasks: [{ kind: 'cards', count: -1, minutes: 2 }] }),
    JSON.stringify({ minutes: 60, tasks: [{ kind: 'questions', count: 3, minutes: 2 }] }),
    JSON.stringify({ minutes: 60, tasks: [{ kind: 'note', minutes: 6 }] }),
    JSON.stringify({ minutes: 60, tasks: [{ kind: 'video', minutes: 6 }] }),
    JSON.stringify({ minutes: 60, tasks: [{ kind: 'cards', count: 2, minutes: 'x' }] }),
    JSON.stringify({ minutes: 60, tasks: [null] }),
  ]) expect(parseSnapshot(raw, 60)).toBeNull();
});
