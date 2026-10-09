import { errMsg } from './errMsg';

test('errMsg gives readable text for an Error, a message object, a string and anything else', () => {
  expect(errMsg(new Error('offline'))).toBe('offline');
  expect(errMsg({ message: 'from the server', code: '42' })).toBe('from the server');
  expect(errMsg('plain text')).toBe('plain text');
  expect(errMsg(undefined)).toBe('unknown error');
  expect(errMsg(null)).toBe('unknown error');
  expect(errMsg({})).toBe('unknown error');
  expect(errMsg(new Error(''))).toBe('unknown error');
});
