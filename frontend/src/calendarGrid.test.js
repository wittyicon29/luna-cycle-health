import { addDays, monthGrid, shiftMonth, periodDaySet, predictedRangeSet } from './calendarGrid';

test('addDays crosses month, year and leap boundaries', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
});

test('February 2026 starts on a Sunday and has exactly 4 rows', () => {
  const g = monthGrid(2026, 1);
  expect(g.weeks).toHaveLength(4);
  expect(g.from).toBe('2026-02-01');
  expect(g.to).toBe('2026-02-28');
  expect(g.weeks.flat().every(c => c.inMonth)).toBe(true);
});

test('leap February 2024 spans 5 rows from Jan 28 to Mar 2', () => {
  const g = monthGrid(2024, 1);
  expect(g.weeks).toHaveLength(5);
  expect(g.from).toBe('2024-01-28');
  expect(g.to).toBe('2024-03-02');
  expect(g.weeks.flat().find(c => c.date === '2024-02-29')).toMatchObject({ day: 29, inMonth: true });
  expect(g.weeks[0][0]).toMatchObject({ date: '2024-01-28', inMonth: false });
});

test('August 2026 needs 6 rows (starts on a Saturday)', () => {
  const g = monthGrid(2026, 7);
  expect(g.weeks).toHaveLength(6);
  expect(g.weeks[0].map(c => c.inMonth)).toEqual([false, false, false, false, false, false, true]);
  expect(g.to).toBe('2026-09-05');
});

test('Monday-first week start shifts the grid', () => {
  const g = monthGrid(2026, 1, 1); // Feb 2026, Monday first
  expect(g.from).toBe('2026-01-26');
  expect(g.weeks).toHaveLength(5);
});

test('every grid has complete weeks of 7 and consecutive dates', () => {
  for (const [y, m] of [[2025, 0], [2025, 11], [2026, 9], [2028, 1]]) {
    const cells = monthGrid(y, m).weeks.flat();
    expect(cells.length % 7).toBe(0);
    cells.forEach((c, i) => { if (i) expect(c.date).toBe(addDays(cells[i - 1].date, 1)); });
  }
});

test('shiftMonth wraps years', () => {
  expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  expect(shiftMonth({ year: 2026, month: 5 }, 14)).toEqual({ year: 2027, month: 7 });
});

test('period days: ended, un-ended (capped at today and 5 days), overlap with the next period', () => {
  const today = '2026-10-25';
  const set = periodDaySet([
    { start_date: '2026-09-01', end_date: '2026-09-05' },
    { start_date: '2026-09-29', end_date: null },
    { start_date: '2026-10-24', end_date: null },
  ], today);
  expect([...set].filter(d => d.startsWith('2026-09-0')).sort()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  expect(set.has('2026-09-29')).toBe(true);
  expect(set.has('2026-10-03')).toBe(true);   // 29 + 4 days
  expect(set.has('2026-10-04')).toBe(false);
  expect(set.has('2026-10-24')).toBe(true);
  expect(set.has('2026-10-25')).toBe(true);   // started yesterday: today is included
  expect(set.has('2026-10-26')).toBe(false);  // never paints the future
});

test('a period never paints into the next period start', () => {
  const set = periodDaySet([
    { start_date: '2026-10-01', end_date: '2026-10-20' },
    { start_date: '2026-10-10', end_date: '2026-10-12' },
  ], '2026-10-25');
  expect(set.has('2026-10-09')).toBe(true);
  expect(set.has('2026-10-10')).toBe(true); // belongs to the second period
  expect(set.has('2026-10-13')).toBe(false); // first period stops before the next start; second ended on 12
});

test('end before start is ignored (only the start day)', () => {
  const set = periodDaySet([{ start_date: '2026-10-10', end_date: '2026-10-05' }], '2026-10-25');
  expect([...set]).toEqual(['2026-10-10']);
});

test('predicted range covers earliest..latest from today onwards only', () => {
  const p = { predicted_next_period: '2026-10-27', earliest: '2026-10-24', latest: '2026-10-29' };
  expect([...predictedRangeSet(p, '2026-10-25')].sort()).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
});

test('predicted: missing range falls back to the single day; nothing usable → empty', () => {
  expect([...predictedRangeSet({ predicted_next_period: '2026-11-02', earliest: null, latest: null }, '2026-10-25')]).toEqual(['2026-11-02']);
  expect(predictedRangeSet({ predicted_next_period: null, earliest: null, latest: null }, '2026-10-25').size).toBe(0);
  expect(predictedRangeSet(null, '2026-10-25').size).toBe(0);
  expect(predictedRangeSet({ predicted_next_period: '2026-10-01', earliest: '2026-09-28', latest: '2026-10-03' }, '2026-10-25').size).toBe(0);
});

test('works under any local time zone (dates are strings, not UTC instants)', () => {
  expect(monthGrid(2026, 9).from).toBe('2026-09-27');
});
