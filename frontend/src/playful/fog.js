import { periodDaySet, addDays } from '../calendarGrid';

export const FOG_DAYS = 30;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDate = d => YMD.test(String(d)) && addDays(String(d), 0) !== null;

export function firstLoggedDate(periods, logs) {
  const all = [...(periods || []).map(p => p.start_date), ...Object.keys(logs || {})].filter(isDate);
  return all.length ? all.reduce((a, b) => (a < b ? a : b)) : null;
}

export function coveredDates(periods, logs, today) {
  const out = new Set(periodDaySet(periods || [], today));
  Object.keys(logs || {}).forEach(d => { if (isDate(d)) out.add(d); });
  return out;
}

export function fogRuns({ dates, today, first, covered }) {
  if (!first) return [];
  const windowStart = addDays(today, -FOG_DAYS);
  const runs = [];
  let open = null;
  dates.forEach((d, i) => {
    const foggy = d > first && d < today && d >= windowStart && !covered.has(d);
    if (foggy && open === null) open = i;
    if (!foggy && open !== null) { runs.push({ start: open, end: i - 1 }); open = null; }
  });
  if (open !== null) runs.push({ start: open, end: dates.length - 1 });
  return runs;
}
