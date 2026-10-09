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

test('doneToday with since counts only items at or after max(local midnight, since), each once', () => {
  const since = new Date(2026, 9, 7, 12).getTime();
  const d = doneToday(
    [att('q1', iso(9, 7, 10, 0)), att('q1', iso(9, 7, 13, 0)), att('q1', iso(9, 7, 14, 0)), att('q2', iso(9, 7, 11, 59)), att('q3', iso(9, 7, 12, 0))],
    [rev('c1', iso(9, 7, 9, 0)), rev('c1', iso(9, 7, 13, 0)), rev('c1', iso(9, 7, 15, 0)), rev('c2', iso(9, 7, 11, 0))],
    qSystem, NOW, since,
  );
  expect(d.cards).toBe(1); // c1 reviewed before and twice after since: counts once
  expect(d.questions).toEqual({ renal: 1, nervous: 1 }); // q1 once, q2 before since excluded, q3 exactly at since counts
  // a since before midnight (yesterday's) never lets yesterday in
  const y = doneToday([att('q1', iso(9, 6, 23, 59))], [rev('c1', iso(9, 6, 23, 59)), rev('c2', iso(9, 7, 0, 1))], qSystem, NOW, 0);
  expect(y).toEqual({ cards: 1, questions: {} });
});

const tasks = [
  { kind: 'cards', count: 5, minutes: 2 },
  { kind: 'note', system: 'renal', minutes: 6 },
  { kind: 'questions', system: 'renal', count: 10, minutes: 15 },
];

const snap = (o: Record<string, unknown> = {}) => JSON.stringify({ minutes: 60, tasks, since: 1000, hasCompletedRun: true, ...o });

test('parseSnapshot returns the saved plan with its since when minutes and diagnostic state match', () => {
  expect(parseSnapshot(snap(), 60, true)).toEqual({ minutes: 60, tasks, since: 1000, hasCompletedRun: true });
});

test('parseSnapshot: an unknown (null) diagnostic state accepts either stored value', () => {
  expect(parseSnapshot(snap(), 60, null)).toEqual({ minutes: 60, tasks, since: 1000, hasCompletedRun: true });
  expect(parseSnapshot(snap({ hasCompletedRun: false }), 60, null)!.hasCompletedRun).toBe(false);
  expect(parseSnapshot(snap({ hasCompletedRun: 'yes' }), 60, null)).toBeNull();
});

test('parseSnapshot rejects other minutes, a changed diagnostic state, a bad since, missing, corrupt or malformed snapshots', () => {
  expect(parseSnapshot(snap({ minutes: 30 }), 60, true)).toBeNull();
  expect(parseSnapshot(snap({ hasCompletedRun: false }), 60, true)).toBeNull();
  for (const since of [undefined, null, -1, '1000', Infinity, NaN, {}])
    expect(parseSnapshot(snap({ since }), 60, true)).toBeNull();
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

test('a since in the future (clock moved back) does not freeze progress: activity earlier today still counts', () => {
  const future = NOW.getTime() + 36 * 3_600_000;
  const d = doneToday(
    [att('q1', iso(9, 7, 9, 0)), att('q2', iso(9, 7, 11, 55)), att('q3', iso(9, 6, 23, 0))],
    [rev('c1', iso(9, 7, 9, 0)), rev('c2', iso(9, 6, 23, 0))],
    qSystem, NOW, future,
  );
  expect(d.cards).toBe(1); // yesterday still excluded
  expect(d.questions).toEqual({ renal: 2 });
  // and the result does not depend on when Today happens to recompute
  const later = new Date(NOW.getTime() + 5 * 60_000);
  expect(doneToday([att('q1', iso(9, 7, 9, 0)), att('q2', iso(9, 7, 11, 55))], [], qSystem, later, future).questions).toEqual({ renal: 2 });
});
