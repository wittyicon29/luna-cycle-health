export const KIND_BASE = { periodExpected: 100000000, dailyLog: 200000000, lateCheckIn: 300000000 };
const DAY_MS = 24 * 60 * 60 * 1000;
const LATE_CHECK_IN_AFTER_DAYS = 3;
const SAME_CYCLE_WINDOW_DAYS = 7;

// 'YYYY-MM-DD' → LOCAL midnight (never via UTC), or null when missing/invalid.
function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

const addDays = (day, n) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
const withTime = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
};
const ymd = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const sameDay = (a, b) => a && b && ymd(a) === ymd(b);

export function planReminders({ prefs, prediction, lastPeriodStart, lastLoggedOn, now = new Date(), horizonDays = 14 }) {
  const end = new Date(now.getTime() + horizonDays * DAY_MS);
  const plan = [];
  const push = (kind, at) => {
    if (at > now && at <= end) plan.push({ id: KIND_BASE[kind] + ymd(at), at, kind });
  };

  const predicted = parseDay(prediction && prediction.predicted_next_period);
  const lastStart = parseDay(lastPeriodStart);
  const cycleAlreadyLogged = !!(predicted && lastStart && lastStart >= addDays(predicted, -SAME_CYCLE_WINDOW_DAYS));

  if (predicted && !cycleAlreadyLogged) {
    if (prefs.periodExpected.enabled) {
      push('periodExpected', withTime(addDays(predicted, -prefs.periodExpected.daysBefore), prefs.periodExpected.time));
    }
    if (prefs.lateCheckIn.enabled) {
      push('lateCheckIn', withTime(addDays(predicted, LATE_CHECK_IN_AFTER_DAYS), '10:00'));
    }
  }

  if (prefs.dailyLog.enabled) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const loggedToday = sameDay(parseDay(lastLoggedOn), today);
    for (let i = 0; i <= horizonDays; i += 1) {
      if (i === 0 && loggedToday) continue;
      push('dailyLog', withTime(addDays(today, i), prefs.dailyLog.time));
    }
  }

  return plan.sort((a, b) => a.at - b.at);
}
