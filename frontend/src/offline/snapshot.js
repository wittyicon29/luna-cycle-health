import * as store from './store';
import { addDays } from '../calendarGrid';

// Last server data per user, one encrypted blob per slice: { v: value, at: ms }.
export const LOG_WINDOW_DAYS = 400;
const SLICES = ['periods', 'logs', 'medications', 'consents', 'authStatus'];
const nameOf = slice => `snap_${slice}`;
const chains = new Map();

function serial(email, task) {
  const key = String(email || '').trim().toLowerCase();
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

const isMap = v => v && typeof v === 'object' && !Array.isArray(v);

async function readSlice(email, slice) {
  const v = await store.read(email, nameOf(slice));
  return v && typeof v === 'object' && 'v' in v ? v : null;
}

export function loadSnapshot(email) {
  return serial(email, async () => {
    const out = { periods: null, logs: {}, medications: null, consents: null, authStatus: null, fetchedAt: null };
    for (const s of SLICES) {
      const rec = await readSlice(email, s);
      if (!rec || rec.v === undefined || rec.v === null) continue;
      if (s === 'logs' && !isMap(rec.v)) continue;
      out[s] = rec.v;
      if (typeof rec.at === 'number' && (out.fetchedAt === null || rec.at > out.fetchedAt)) out.fetchedAt = rec.at;
    }
    return out;
  });
}

// For 'logs', `value` is a map date -> entry for the range just fetched. It is merged into the cached map (a day that
// changed is replaced); pass range {from, to} to also drop cached days inside the range that the server no longer has.
// Entries older than 400 days before the latest cached date are pruned.
export function saveSlice(email, slice, value, range) {
  if (!SLICES.includes(slice)) return Promise.resolve();
  return serial(email, async () => {
    let next = value;
    if (slice === 'logs') {
      const existing = await readSlice(email, 'logs');
      const merged = { ...(existing && isMap(existing.v) ? existing.v : {}) };
      if (range && range.from && range.to) {
        Object.keys(merged).forEach(d => { if (d >= range.from && d <= range.to) delete merged[d]; });
      }
      Object.assign(merged, isMap(value) ? value : {});
      const dates = Object.keys(merged).sort();
      if (dates.length) {
        const cutoff = addDays(dates[dates.length - 1], -LOG_WINDOW_DAYS);
        if (cutoff) dates.forEach(d => { if (d < cutoff) delete merged[d]; });
      }
      next = {};
      Object.keys(merged).sort().forEach(d => { next[d] = merged[d]; });
    }
    await store.write(email, nameOf(slice), { v: next, at: Date.now() });
  });
}

export function clearSnapshot(email) {
  return serial(email, async () => { for (const s of SLICES) await store.remove(email, nameOf(s)); });
}
