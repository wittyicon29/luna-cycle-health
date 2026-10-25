export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

export function addDays(ymd, n) {
  const d = parse(ymd);
  return d ? fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) : null;
}

export function monthGrid(year, month, weekStart = 0) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const last = new Date(year, month + 1, 0);
  const total = Math.ceil((lead + last.getDate()) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(year, month, 1 - lead + i);
    cells.push({ date: fmt(d), day: d.getDate(), inMonth: d.getMonth() === month && d.getFullYear() === year });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks, from: cells[0].date, to: cells[cells.length - 1].date };
}

export function shiftMonth({ year, month }, delta) {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function eachDay(from, to, visit) {
  for (let d = from; d && d <= to; d = addDays(d, 1)) visit(d);
}

export function periodDaySet(periods, today) {
  const out = new Set();
  const list = (periods || []).filter(p => parse(p.start_date)).slice().sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  list.forEach((p, i) => {
    let end;
    if (p.end_date && parse(p.end_date) && p.end_date >= p.start_date) end = p.end_date;
    else if (p.end_date) end = p.start_date;
    else end = addDays(p.start_date, 4) < today ? addDays(p.start_date, 4) : today;
    if (end < p.start_date) end = p.start_date;
    const next = list[i + 1];
    if (next && next.start_date > p.start_date) {
      const cap = addDays(next.start_date, -1);
      if (end > cap) end = cap;
    }
    eachDay(p.start_date, end, d => out.add(d));
  });
  return out;
}

export function predictedRangeSet(prediction, today) {
  const out = new Set();
  if (!prediction) return out;
  const { predicted_next_period: mid, earliest, latest } = prediction;
  const lo = parse(earliest) && parse(latest) ? earliest : mid;
  const hi = parse(earliest) && parse(latest) ? latest : mid;
  if (!parse(lo) || !parse(hi) || hi < lo) return out;
  eachDay(lo, hi, d => { if (d >= today) out.add(d); });
  return out;
}
