import {
  latestPerQuestion, masteryBySystem, lastStudyBySystem, rankSystems, medianSeconds, buildPlan,
  weekdayIndex, weekStart, minutesDoneThisWeek, daysLeft, todayMinutes, pickNote, selectForTask, DAY_MS,
  MIN_SEC_PER_CARD, MIN_SEC_PER_QUESTION,
} from './planner';

const at = (q: string, correct: boolean, when: string, ms = 60_000) => ({ question_id: q, correct, duration_ms: ms, answered_at: when });

test('latestPerQuestion keeps the newest attempt by time, not by order', () => {
  const m = latestPerQuestion([at('a', true, '2026-10-02T10:00:00Z'), at('a', false, '2026-10-01T10:00:00Z')]);
  expect(m.get('a')!.correct).toBe(true);
});

test('masteryBySystem: neutral prior of 4, only the latest attempt per question counts', () => {
  const qs = [{ id: 'a', system: 'renal' }, { id: 'b', system: 'renal' }, { id: 'c', system: 'nervous' }];
  const latest = latestPerQuestion([at('a', false, '2026-10-01T00:00:00Z'), at('a', true, '2026-10-02T00:00:00Z'), at('b', true, '2026-10-02T00:00:00Z')]);
  const m = masteryBySystem(qs, latest);
  expect(m.renal).toEqual({ answered: 2, correct: 2, mastery: (2 + 2) / (2 + 4) });
  expect(m.nervous).toEqual({ answered: 0, correct: 0, mastery: 0.5 });
});

test('rankSystems: weak, heavy and neglected systems rank higher', () => {
  const mastery = { cardiovascular: { answered: 10, correct: 9, mastery: 0.8 }, renal: { answered: 10, correct: 3, mastery: 0.3 } };
  const now = Date.parse('2026-10-10T12:00:00Z');
  const last = new Map([['cardiovascular', now - DAY_MS], ['renal', now - DAY_MS]]);
  expect(rankSystems(['cardiovascular', 'renal'], mastery, last, now)[0].system).toBe('renal');
  // equal mastery: the more neglected system wins
  const eq = { cardiovascular: { answered: 0, correct: 0, mastery: 0.5 }, renal: { answered: 0, correct: 0, mastery: 0.5 } };
  const last2 = new Map([['cardiovascular', now], ['renal', now - 6 * DAY_MS]]);
  expect(rankSystems(['cardiovascular', 'renal'], eq, last2, now)[0].system).toBe('renal');
  // never studied counts as 7 days
  expect(rankSystems(['renal'], eq, new Map(), now)[0].priority).toBeCloseTo(7 * 0.5 * 1.5);
});

test('medianSeconds ignores zero and absurd durations and falls back when empty', () => {
  expect(medianSeconds([], 90)).toBe(90);
  expect(medianSeconds([0, 30_000, 50_000, 70_000, 3_600_000], 90)).toBe(50);
});

test('lastStudyBySystem maps attempts and reviews to systems', () => {
  const last = lastStudyBySystem(new Map([['q1', 'renal']]), new Map([['c1', 'nervous']]),
    [at('q1', true, '2026-10-02T00:00:00Z'), at('zz', true, '2026-10-09T00:00:00Z')],
    [{ card_id: 'c1', duration_ms: 1, reviewed_at: '2026-10-03T00:00:00Z' }]);
  expect(last.get('renal')).toBe(Date.parse('2026-10-02T00:00:00Z'));
  expect(last.get('nervous')).toBe(Date.parse('2026-10-03T00:00:00Z'));
  expect(last.size).toBe(2);
});

const base = { dueCards: 0, secPerCard: 20, secPerQuestion: 90, ranked: ['renal', 'nervous'], available: { renal: 100, nervous: 100 } };
const total = (p: ReturnType<typeof buildPlan>) => p.reduce((n, t) => n + t.minutes, 0);

test('buildPlan: zero or negative minutes gives an empty plan', () => {
  expect(buildPlan({ ...base, minutes: 0 })).toEqual([]);
  expect(buildPlan({ ...base, minutes: -5, dueCards: 10 })).toEqual([]);
});

test('buildPlan: no ranked systems still schedules cards only', () => {
  const p = buildPlan({ ...base, minutes: 60, dueCards: 5, ranked: [] });
  expect(p).toEqual([{ kind: 'cards', count: 5, minutes: (5 * 20) / 60 }]);
});

test('buildPlan: cards are capped at 40% of the time', () => {
  const p = buildPlan({ ...base, minutes: 60, dueCards: 1000 });
  const cards = p.find((t) => t.kind === 'cards')!;
  expect(cards.minutes).toBeLessThanOrEqual(0.4 * 60 + 1e-9);
  expect(total(p)).toBeLessThanOrEqual(60 + 1e-9);
});

test('buildPlan: 3 hours gives cards, a note, a focus set and a second set within budget', () => {
  const p = buildPlan({ ...base, minutes: 180, dueCards: 30 });
  expect(p.map((t) => t.kind)).toEqual(['cards', 'note', 'questions', 'questions']);
  expect(total(p)).toBeLessThanOrEqual(180 + 1e-9);
  const [, note, q1, q2] = p as [unknown, { system: string }, { system: string }, { system: string }];
  expect([note.system, q1.system, q2.system]).toEqual(['renal', 'renal', 'nervous']);
});

test('buildPlan: a short day is one question set in the top system, no note', () => {
  const p = buildPlan({ ...base, minutes: 15 });
  expect(p).toEqual([{ kind: 'questions', system: 'renal', count: 10, minutes: 15 }]);
  const tiny = buildPlan({ ...base, minutes: 2 });
  expect(tiny).toEqual([{ kind: 'questions', system: 'renal', count: 1, minutes: 1.5 }]);
});

test('buildPlan: a second set under 5 questions is merged into the focus set', () => {
  const p = buildPlan({ ...base, minutes: 21 });
  expect(p.map((t) => t.kind)).toEqual(['note', 'questions']);
});

test('buildPlan: counts never exceed the questions available', () => {
  const p = buildPlan({ ...base, minutes: 180, available: { renal: 7, nervous: 0 } });
  const q = p.filter((t) => t.kind === 'questions') as { count: number }[];
  expect(q).toHaveLength(1);
  expect(q[0].count).toBe(7);
});

test('week helpers: Monday-first, Sunday belongs to the week that began Monday', () => {
  expect(weekdayIndex(new Date(2026, 9, 5))).toBe(0); // Mon 5 Oct 2026
  expect(weekdayIndex(new Date(2026, 9, 11))).toBe(6); // Sun 11 Oct 2026
  expect(weekStart(new Date(2026, 9, 11, 23, 30)).getDate()).toBe(5);
});

test('minutesDoneThisWeek sums attempts and reviews inside the local week only', () => {
  const now = new Date(2026, 9, 7, 12); // Wed
  const inWeek = new Date(2026, 9, 6, 9).toISOString();
  const before = new Date(2026, 9, 4, 9).toISOString(); // previous Sunday
  const done = minutesDoneThisWeek(
    [{ question_id: 'a', correct: true, duration_ms: 120_000, answered_at: inWeek }, { question_id: 'b', correct: true, duration_ms: 999_000, answered_at: before }],
    [{ card_id: 'c', duration_ms: 60_000, reviewed_at: inWeek }], now);
  expect(done).toBe(3);
});

test('daysLeft and todayMinutes', () => {
  const now = new Date(2026, 9, 7, 15);
  expect(daysLeft(null, now)).toBeNull();
  expect(daysLeft('2026-10-10', now)).toBe(3);
  expect(daysLeft('2026-10-05', now)).toBe(-2);
  expect(todayMinutes([10, 20, 30, 40, 50, 60, 70], now)).toBe(30); // Wednesday = index 2
  expect(todayMinutes([10, 20, 30, 40, 50, 60, 70], now, 5)).toBe(5);
  expect(todayMinutes([], now)).toBe(0);
});

test('pickNote picks the note of the block with the fewest answered questions', () => {
  const notes = [
    { id: 'n1', title: 'A', system: 'renal', tags: ['acid-base'] },
    { id: 'n2', title: 'B', system: 'renal', tags: ['stones'] },
    { id: 'n3', title: 'C', system: 'nervous', tags: ['x'] },
  ];
  const qs = [{ id: 'q1', system: 'renal', tags: ['acid-base'] }, { id: 'q2', system: 'renal', tags: ['stones'] }];
  const latest = latestPerQuestion([at('q1', true, '2026-10-01T00:00:00Z')]);
  expect(pickNote(notes, qs, latest, 'renal')!.id).toBe('n2');
  expect(pickNote(notes, qs, latest, 'immunology')).toBeNull();
});

test('selectForTask: unseen first, then missed, then the rest; only the system; at most n', () => {
  const qs = ['a', 'b', 'c', 'd'].map((id) => ({ id, system: 'renal' })).concat([{ id: 'z', system: 'nervous' }]);
  const latest = latestPerQuestion([at('a', true, '2026-10-01T00:00:00Z'), at('b', false, '2026-10-01T00:00:00Z')]);
  const ids = selectForTask(qs, latest, 'renal', 3, () => 0.3).map((q) => q.id);
  expect(ids.slice(0, 2).sort()).toEqual(['c', 'd']);
  expect(ids[2]).toBe('b');
  expect(selectForTask(qs, latest, 'renal', 0)).toEqual([]);
});

test('latestPerQuestion: an unparsable timestamp never pins the question', () => {
  const m = latestPerQuestion([at('a', false, 'garbage'), at('a', true, '2026-10-01T00:00:00Z')]);
  expect(m.get('a')!.correct).toBe(true);
  const all = latestPerQuestion([at('a', false, 'x'), at('a', true, 'y')]);
  expect(all.get('a')!.correct).toBe(false);
});

test('daysLeft: malformed targets give null', () => {
  const now = new Date(2026, 9, 7, 12);
  for (const t of ['', 'garbage', '2026-10-10T00:00:00Z']) expect(daysLeft(t, now)).toBeNull();
});

test('medianSeconds never drops below 1 when there is data', () => {
  expect(medianSeconds([300], 90)).toBe(1);
});

test('buildPlan: a tiny measured pace is clamped so rapid clicking cannot inflate the plan', () => {
  const p = buildPlan({ ...base, minutes: 60, dueCards: 10_000, secPerCard: 1, secPerQuestion: 1 });
  expect(p[0]).toMatchObject({ kind: 'cards', count: Math.floor((0.4 * 60 * 60) / MIN_SEC_PER_CARD) });
  expect(total(p)).toBeLessThanOrEqual(60 + 1e-9);
  for (const t of p) if (t.kind === 'questions') expect(t.minutes).toBe((t.count * MIN_SEC_PER_QUESTION) / 60);
  expect(MIN_SEC_PER_CARD).toBe(8);
  expect(MIN_SEC_PER_QUESTION).toBe(30);
});

test('buildPlan: no lone note when the focus system has no questions', () => {
  const p = buildPlan({ ...base, minutes: 60, dueCards: 5, ranked: ['renal', 'nervous'], available: { renal: 0, nervous: 40 } });
  expect(p.some((t) => t.kind === 'note')).toBe(false);
  expect(p.map((t) => t.kind)).toEqual(['cards']);
});
