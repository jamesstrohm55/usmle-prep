import { buildQueue } from './queue';

const now = new Date('2026-11-01T09:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86400000);
const ahead = (d: number) => new Date(now.getTime() + d * 86400000);

test('due reviews come first, oldest due first', () => {
  const states = new Map([['a', { due: ago(1) }], ['b', { due: ago(5) }]]);
  expect(buildQueue(['a', 'b'], states, now, 0)).toEqual(['b', 'a']);
});

test('not-yet-due cards are excluded', () => {
  const states = new Map([['a', { due: ahead(2) }]]);
  expect(buildQueue(['a'], states, now, 5)).toEqual([]);
});

test('new cards fill after reviews up to the budget', () => {
  const states = new Map([['a', { due: ago(1) }]]);
  expect(buildQueue(['a', 'n1', 'n2', 'n3'], states, now, 2)).toEqual(['a', 'n1', 'n2']);
});

test('empty input gives empty queue', () => {
  expect(buildQueue([], new Map(), now, 10)).toEqual([]);
});

test('negative budget behaves as zero', () => {
  expect(buildQueue(['n1'], new Map(), now, -3)).toEqual([]);
});
