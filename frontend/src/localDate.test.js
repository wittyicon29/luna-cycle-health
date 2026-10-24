import { localDateString } from './localDate';

test('uses the local calendar date, not the UTC date', () => {
  // 23:30 local time is still "today" here even if UTC has already rolled over.
  expect(localDateString(new Date(2026, 9, 24, 23, 30))).toBe('2026-10-24');
  expect(localDateString(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
});

import { formatLongDate } from './localDate';

test('formatLongDate keeps the calendar day (no UTC shift)', () => {
  expect(formatLongDate('2026-09-30', 'en-US')).toBe('September 30, 2026');
  expect(formatLongDate('2026-01-01', 'en-US')).toBe('January 1, 2026');
  expect(formatLongDate('2026-09-30T00:00:00', 'en-US')).toBe('September 30, 2026');
});

test('formatLongDate returns an empty string for missing or invalid input', () => {
  expect(formatLongDate(null)).toBe('');
  expect(formatLongDate('nope')).toBe('');
});
