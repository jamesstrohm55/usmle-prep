import { doneToday, parseSnapshot, sinceBase } from './progress';

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

const base = { cards: 3, questions: { renal: 2 } };
const snap = (o: Record<string, unknown> = {}) => JSON.stringify({ minutes: 60, tasks, base, hasCompletedRun: true, ...o });

test('parseSnapshot returns the saved plan with its baseline when minutes and diagnostic state match', () => {
  expect(parseSnapshot(snap(), 60, true)).toEqual({ minutes: 60, tasks, base, hasCompletedRun: true });
});

test('parseSnapshot rejects other minutes, a changed diagnostic state, a bad baseline, missing, corrupt or malformed snapshots', () => {
  expect(parseSnapshot(snap({ minutes: 30 }), 60, true)).toBeNull();
  expect(parseSnapshot(snap({ hasCompletedRun: false }), 60, true)).toBeNull();
  for (const b of [undefined, null, {}, { cards: -1, questions: {} }, { cards: 1.5, questions: {} }, { cards: 0 }, { cards: 0, questions: { renal: -1 } }, { cards: 0, questions: { renal: 'x' } }, { cards: 0, questions: [] }])
    expect(parseSnapshot(snap({ base: b }), 60, true)).toBeNull();
  for (const raw of [
    null, '', '{not json', 'null', '42', snap({ tasks: undefined }), snap({ tasks: {} }),
    snap({ tasks: [{ kind: 'cards', count: -1, minutes: 2 }] }),
    snap({ tasks: [{ kind: 'questions', count: 3, minutes: 2 }] }),
    snap({ tasks: [{ kind: 'note', minutes: 6 }] }),
    snap({ tasks: [{ kind: 'video', minutes: 6 }] }),
    snap({ tasks: [{ kind: 'cards', count: 2, minutes: 'x' }] }),
    snap({ tasks: [null] }),
  ]) expect(parseSnapshot(raw, 60, true)).toBeNull();
});

test('sinceBase: progress since the plan was made, never negative', () => {
  const now = { cards: 10, questions: { renal: 5, nervous: 1 } };
  expect(sinceBase(now, { cards: 4, questions: { renal: 2 } })).toEqual({ cards: 6, questions: { renal: 3, nervous: 1 } });
  expect(sinceBase({ cards: 1, questions: {} }, { cards: 4, questions: { renal: 2 } })).toEqual({ cards: 0, questions: {} });
});
