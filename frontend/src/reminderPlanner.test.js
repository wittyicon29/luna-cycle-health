import { DEFAULT_PREFS } from './reminderPrefs';
import { KIND_BASE, planReminders } from './reminderPlanner';

const on = (over = {}) => ({
  ...DEFAULT_PREFS,
  periodExpected: { enabled: true, daysBefore: 2, time: '09:00' },
  dailyLog: { enabled: true, time: '21:00' },
  lateCheckIn: { enabled: true },
  ...over,
});
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const NOW = at(2026, 10, 1, 8, 0);
const base = { now: NOW, lastPeriodStart: '2026-09-10', lastLoggedOn: '2026-09-10' };
const kinds = plan => plan.map(p => p.kind);

test('nothing enabled → empty plan', () => {
  expect(planReminders({ ...base, prefs: DEFAULT_PREFS, prediction: { predicted_next_period: '2026-10-08' } })).toEqual([]);
});

test('period expected fires daysBefore at the chosen local time', () => {
  const plan = planReminders({ ...base, prefs: on({ dailyLog: { enabled: false, time: '21:00' }, lateCheckIn: { enabled: false } }), prediction: { predicted_next_period: '2026-10-08' } });
  expect(plan).toHaveLength(1);
  expect(plan[0].kind).toBe('periodExpected');
  expect(plan[0].at).toEqual(at(2026, 10, 6, 9, 0));
  expect(plan[0].id).toBe(KIND_BASE.periodExpected + 20261006);
});

test('late check-in is 3 days after the prediction at 10:00', () => {
  const plan = planReminders({ ...base, prefs: on({ periodExpected: { enabled: false, daysBefore: 2, time: '09:00' }, dailyLog: { enabled: false, time: '21:00' } }), prediction: { predicted_next_period: '2026-10-08' } });
  expect(plan).toEqual([{ id: KIND_BASE.lateCheckIn + 20261011, at: at(2026, 10, 11, 10, 0), kind: 'lateCheckIn' }]);
});

test('no prediction, null prediction or a past prediction: only daily nudges remain', () => {
  for (const prediction of [null, { predicted_next_period: null }, { predicted_next_period: '2026-09-20' }]) {
    const plan = planReminders({ ...base, prefs: on(), prediction });
    expect(kinds(plan).every(k => k === 'dailyLog')).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  }
});

test('a period already logged for this cycle suppresses expected and late reminders', () => {
  const plan = planReminders({ ...base, lastPeriodStart: '2026-10-03', prefs: on(), prediction: { predicted_next_period: '2026-10-08' } });
  expect(kinds(plan)).not.toContain('periodExpected');
  expect(kinds(plan)).not.toContain('lateCheckIn');
});

test('daily nudge: starts today only if its time is still ahead and not already logged', () => {
  const prefs = on({ periodExpected: { enabled: false, daysBefore: 2, time: '09:00' }, lateCheckIn: { enabled: false } });
  const todayAhead = planReminders({ ...base, prefs, prediction: null, lastLoggedOn: '2026-09-30' });
  expect(todayAhead[0].at).toEqual(at(2026, 10, 1, 21, 0));
  const loggedToday = planReminders({ ...base, prefs, prediction: null, lastLoggedOn: '2026-10-01' });
  expect(loggedToday[0].at).toEqual(at(2026, 10, 2, 21, 0));
  const lateEvening = planReminders({ ...base, now: at(2026, 10, 1, 22, 0), prefs, prediction: null, lastLoggedOn: '2026-09-30' });
  expect(lateEvening[0].at).toEqual(at(2026, 10, 2, 21, 0));
});

test('horizon: everything is in the future and at most 14 days ahead; boundary is inclusive', () => {
  const prefs = on({ periodExpected: { enabled: false, daysBefore: 2, time: '09:00' }, lateCheckIn: { enabled: false }, dailyLog: { enabled: true, time: '08:00' } });
  const plan = planReminders({ ...base, now: at(2026, 10, 1, 8, 0), prefs, prediction: null, lastLoggedOn: '2026-09-30' });
  const end = at(2026, 10, 15, 8, 0);
  expect(plan.every(p => p.at > NOW && p.at <= end)).toBe(true);
  expect(plan[plan.length - 1].at).toEqual(end); // exactly now + 14 days is included
  expect(plan.some(p => p.at.getTime() === NOW.getTime())).toBe(false); // "now" itself is not future
});

test('ids are unique, stable and fit a signed 32-bit integer', () => {
  const args = { ...base, prefs: on(), prediction: { predicted_next_period: '2026-10-08' } };
  const a = planReminders(args);
  const b = planReminders(args);
  expect(a.map(p => p.id)).toEqual(b.map(p => p.id));
  expect(new Set(a.map(p => p.id)).size).toBe(a.length);
  expect(a.every(p => Number.isInteger(p.id) && p.id > 0 && p.id < 2147483647)).toBe(true);
});

test('output is sorted by time', () => {
  const plan = planReminders({ ...base, prefs: on(), prediction: { predicted_next_period: '2026-10-08' } });
  const times = plan.map(p => p.at.getTime());
  expect(times).toEqual([...times].sort((x, y) => x - y));
});

test('malformed dates are treated as missing, never thrown on', () => {
  expect(() => planReminders({ ...base, prefs: on(), prediction: { predicted_next_period: 'tomorrow' }, lastPeriodStart: 'x', lastLoggedOn: '' })).not.toThrow();
});

test('DST: exactly one daily nudge per calendar day across a 14-day horizon', () => {
  const prefs = on({ periodExpected: { enabled: false, daysBefore: 2, time: '09:00' }, lateCheckIn: { enabled: false }, dailyLog: { enabled: true, time: '08:00' } });
  // Spans US (Mar 8) and NZ/AU-adjacent changes depending on TZ; expectation is built from local constructors.
  for (const [y, m, d] of [[2026, 3, 1], [2026, 3, 2], [2026, 3, 7], [2026, 3, 8], [2026, 9, 20], [2026, 9, 26], [2026, 10, 25], [2026, 10, 31], [2026, 11, 1]]) {
    const now = at(y, m, d, 8, 0);
    const plan = planReminders({ ...base, now, prefs, prediction: null, lastLoggedOn: '2000-01-01' });
    const expected = Array.from({ length: 14 }, (_, i) => at(y, m, d + i + 1, 8, 0));
    expect(plan.map(p => p.at.getTime())).toEqual(expected.map(e => e.getTime()));
    expect(plan[plan.length - 1].at).toEqual(at(y, m, d + 14, 8, 0));
  }
});

test('DST gap: a nudge time inside a skipped local hour still yields one slot per day', () => {
  const prefs = on({ periodExpected: { enabled: false, daysBefore: 2, time: '09:00' }, lateCheckIn: { enabled: false }, dailyLog: { enabled: true, time: '02:30' } });
  const now = at(2026, 3, 1, 0, 0);
  const plan = planReminders({ ...base, now, prefs, prediction: null, lastLoggedOn: '2000-01-01' });
  expect(plan).toHaveLength(14); // day-14 02:30 is after now+14d at 00:00
  expect(new Set(plan.map(p => p.id)).size).toBe(14);
});

test('same-cycle window boundary: predicted-7d suppresses, predicted-8d does not', () => {
  const prediction = { predicted_next_period: '2026-10-08' };
  const prefs = on({ dailyLog: { enabled: false, time: '21:00' } });
  expect(planReminders({ ...base, lastPeriodStart: '2026-10-01', prefs, prediction })).toEqual([]);
  const plan = planReminders({ ...base, lastPeriodStart: '2026-09-30', prefs, prediction });
  expect(kinds(plan)).toEqual(['periodExpected', 'lateCheckIn']);
});

test('daysBefore landing on today: fires if time is ahead, not if passed', () => {
  const prefs = on({ periodExpected: { enabled: true, daysBefore: 2, time: '09:00' }, dailyLog: { enabled: false, time: '21:00' }, lateCheckIn: { enabled: false } });
  const prediction = { predicted_next_period: '2026-10-03' };
  const ahead = planReminders({ ...base, now: at(2026, 10, 1, 8, 0), prefs, prediction });
  expect(ahead).toEqual([{ id: KIND_BASE.periodExpected + 20261001, at: at(2026, 10, 1, 9, 0), kind: 'periodExpected' }]);
  const passed = planReminders({ ...base, now: at(2026, 10, 1, 10, 0), prefs, prediction });
  expect(passed).toEqual([]);
});

test('lateCheckIn alone is suppressed by a same-cycle log', () => {
  const prefs = on({ periodExpected: { enabled: false, daysBefore: 2, time: '09:00' }, dailyLog: { enabled: false, time: '21:00' } });
  expect(planReminders({ ...base, lastPeriodStart: '2026-10-03', prefs, prediction: { predicted_next_period: '2026-10-08' } })).toEqual([]);
});
