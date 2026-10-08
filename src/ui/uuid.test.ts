import { uuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

test('uuid returns a v4 uuid', () => expect(uuid()).toMatch(V4));

test('uuid falls back to getRandomValues without crypto.randomUUID (non-secure origin)', () => {
  const real = globalThis.crypto;
  const getRandomValues = vi.fn(real.getRandomValues.bind(real));
  vi.stubGlobal('crypto', { getRandomValues });
  const a = uuid(), b = uuid();
  expect(getRandomValues).toHaveBeenCalledTimes(2);
  expect(a).toMatch(V4);
  expect(a).not.toBe(b);
});
