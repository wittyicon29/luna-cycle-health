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

describe('formatLongDate in Hindi', () => {
  const i18n = require('./i18n');
  afterEach(() => i18n.setLanguage('en'));

  test('uses the Hindi month with Latin digits', () => {
    i18n.setLanguage('hi');
    const out = formatLongDate('2026-10-25');
    expect(out).toBe('25 अक्टूबर 2026'); // Node ICU spelling
    expect(out).toMatch(/\d/);
    expect(out).not.toMatch(/[०-९]/);
  });

  test('English output is unchanged', () => {
    i18n.setLanguage('en');
    expect(formatLongDate('2026-10-25', 'en-US')).toBe('October 25, 2026');
  });
});
