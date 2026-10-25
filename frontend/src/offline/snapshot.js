import * as store from './store';
import { addDays } from '../calendarGrid';
import { localDateString } from '../localDate';
import { createSerial } from './serial';

// Last server data per user, one encrypted blob per slice: { v: value, at: ms }.
export const LOG_WINDOW_DAYS = 400;
const SLICES = ['periods', 'logs', 'medications', 'consents', 'authStatus'];
const nameOf = slice => `snap_${slice}`;
const serial = createSerial();

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
  const gen = store.currentGeneration();
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
        // Anchor on the latest plausible date: a far-future entry must not wipe real history.
        const limit = addDays(localDateString(), 1);
        const plausible = dates.filter(d => d <= limit);
        const anchor = plausible.length ? plausible[plausible.length - 1] : null;
        const cutoff = anchor ? addDays(anchor, -LOG_WINDOW_DAYS) : null;
        if (cutoff) dates.forEach(d => { if (d < cutoff) delete merged[d]; });
      }
      next = {};
      Object.keys(merged).sort().forEach(d => { next[d] = merged[d]; });
    }
    await store.writeChecked(email, nameOf(slice), { v: next, at: Date.now() }, gen);
  });
}

// Read-modify-write of one slice (not 'logs') inside its serial section, so a concurrent saveSlice of the same user
// cannot be lost in between. `fn(current)` gets the cached value (or null) and returns the next value, or undefined to
// leave the slice as it is. `fn` must not call any snapshot function (it would wait for itself) and should be quick.
// Resolves true when the new value was stored.
export function updateSlice(email, slice, fn) {
  if (!SLICES.includes(slice) || slice === 'logs') return Promise.resolve(false);
  const gen = store.currentGeneration();
  return serial(email, async () => {
    const rec = await readSlice(email, slice);
    const next = await fn(rec ? rec.v : null);
    if (next === undefined) return false;
    return store.writeChecked(email, nameOf(slice), { v: next, at: Date.now() }, gen);
  });
}

// True when the slice has been stored for this user (tells "nothing cached" from an empty cached logs map).
export function hasSlice(email, slice) {
  if (!SLICES.includes(slice)) return Promise.resolve(false);
  return serial(email, async () => !!(await readSlice(email, slice)));
}

export function clearSnapshot(email) {
  return serial(email, async () => { for (const s of SLICES) await store.remove(email, nameOf(s)); });
}
