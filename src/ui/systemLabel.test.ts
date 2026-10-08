import { systemLabel } from './systemLabel';

test('systemLabel names every Step 1 system readably and falls back for unknown slugs', () => {
  expect(systemLabel('cardiovascular')).toBe('Cardiovascular');
  expect(systemLabel('hematology-oncology')).toBe('Hematology & oncology');
  expect(systemLabel('musculoskeletal-dermatology')).toBe('Musculoskeletal & dermatology');
  expect(systemLabel('some-new-system')).toBe('Some new system');
});
