import { FOG_DAYS, fogRuns, firstLoggedDate, coveredDates } from './fog';
import { addDays } from '../calendarGrid';

const TODAY = '2026-10-25';
const span = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
const DATES = span('2026-07-27', 150); // like the map: 90 days back .. 59 ahead
const idx = d => DATES.indexOf(d);

test('no first logged day → no fog', () => {
  expect(fogRuns({ dates: DATES, today: TODAY, first: null, covered: new Set() })).toEqual([]);
});

test('fog starts after the first logged day and stops before today', () => {
  const runs = fogRuns({ dates: DATES, today: TODAY, first: '2026-10-20', covered: new Set(['2026-10-20']) });
  expect(runs).toEqual([{ start: idx('2026-10-21'), end: idx('2026-10-24') }]);
});

test('first logged day today or in the future → no fog', () => {
  expect(fogRuns({ dates: DATES, today: TODAY, first: TODAY, covered: new Set([TODAY]) })).toEqual([]);
  expect(fogRuns({ dates: DATES, today: TODAY, first: '2026-10-26', covered: new Set() })).toEqual([]);
});

test('covered days split runs and are never fogged', () => {
  const covered = new Set(['2026-10-01', '2026-10-10', '2026-10-11', '2026-10-24']);
  const runs = fogRuns({ dates: DATES, today: TODAY, first: '2026-10-01', covered });
  expect(runs).toEqual([
    { start: idx('2026-10-02'), end: idx('2026-10-09') },
    { start: idx('2026-10-12'), end: idx('2026-10-23') },
  ]);
});

test('only the most recent FOG_DAYS days can be foggy (boundary exact)', () => {
  expect(FOG_DAYS).toBe(30);
  const runs = fogRuns({ dates: DATES, today: TODAY, first: '2026-08-01', covered: new Set(['2026-08-01']) });
  expect(DATES[runs[0].start]).toBe(addDays(TODAY, -30)); // 2026-09-25 is foggy…
  expect(DATES[runs[0].start - 1]).toBe(addDays(TODAY, -31)); // …2026-09-24 is not
  expect(DATES[runs[runs.length - 1].end]).toBe('2026-10-24');
});

test('a fully logged recent window has no fog', () => {
  const covered = new Set(span('2026-09-25', 30));
  expect(fogRuns({ dates: DATES, today: TODAY, first: '2026-09-01', covered })).toEqual([]);
});

test('dates outside the supplied timeline are ignored, runs never exceed the array', () => {
  const short = span('2026-10-20', 10);
  const runs = fogRuns({ dates: short, today: TODAY, first: '2026-10-01', covered: new Set() });
  expect(runs).toEqual([{ start: 0, end: 4 }]);
});

test('firstLoggedDate picks the earliest of periods and logs, ignoring junk', () => {
  expect(firstLoggedDate([], {})).toBeNull();
  expect(firstLoggedDate([{ start_date: '2026-09-10' }], { '2026-09-02': {}, 'bad': {} })).toBe('2026-09-02');
  expect(firstLoggedDate([{ start_date: '2026-08-01' }, { start_date: 'nope' }], {})).toBe('2026-08-01');
});

test('coveredDates unions period days and log dates', () => {
  const set = coveredDates([{ start_date: '2026-10-20', end_date: '2026-10-22' }], { '2026-10-23': {} }, TODAY);
  expect([...set].sort()).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
});
