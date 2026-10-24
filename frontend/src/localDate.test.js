import { localDateString } from './localDate';

test('uses the local calendar date, not the UTC date', () => {
  // 23:30 local time is still "today" here even if UTC has already rolled over.
  expect(localDateString(new Date(2026, 9, 24, 23, 30))).toBe('2026-10-24');
  expect(localDateString(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
});
