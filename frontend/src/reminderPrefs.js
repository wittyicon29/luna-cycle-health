export const PREFS_KEY = 'luna_reminders';

export const DEFAULT_PREFS = {
  version: 1,
  periodExpected: { enabled: false, daysBefore: 2, time: '09:00' },
  dailyLog: { enabled: false, time: '21:00' },
  lateCheckIn: { enabled: false },
  explicit: false,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (value, fallback) => (typeof value === 'string' && TIME.test(value) ? value : fallback);
const flag = value => value === true;
const days = value => {
  const fallback = DEFAULT_PREFS.periodExpected.daysBefore;
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  else return fallback;
  if (Number.isNaN(n)) return fallback;
  if (n === Infinity) return 7;
  if (n === -Infinity) return 1;
  return Math.min(7, Math.max(1, Math.round(n)));
};

function normalise(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pe = src.periodExpected || {};
  const dl = src.dailyLog || {};
  const lc = src.lateCheckIn || {};
  return {
    version: 1,
    periodExpected: {
      enabled: flag(pe.enabled),
      daysBefore: days(pe.daysBefore ?? DEFAULT_PREFS.periodExpected.daysBefore),
      time: time(pe.time, DEFAULT_PREFS.periodExpected.time),
    },
    dailyLog: { enabled: flag(dl.enabled), time: time(dl.time, DEFAULT_PREFS.dailyLog.time) },
    lateCheckIn: { enabled: flag(lc.enabled) },
    explicit: flag(src.explicit),
  };
}

export function loadPrefs() {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored ? normalise(JSON.parse(stored)) : normalise(null);
  } catch (e) {
    return normalise(null);
  }
}

export function savePrefs(prefs) {
  let clean;
  try {
    clean = normalise(prefs);
    localStorage.setItem(PREFS_KEY, JSON.stringify(clean));
  } catch (e) {
    /* storage unavailable or unreadable input */
    if (!clean) clean = normalise(null);
  }
  return clean;
}

export function clearPrefs() {
  try { localStorage.removeItem(PREFS_KEY); } catch (e) { /* storage unavailable */ }
}

export const anyEnabled = prefs =>
  !!(prefs && (prefs.periodExpected?.enabled || prefs.dailyLog?.enabled || prefs.lateCheckIn?.enabled));
