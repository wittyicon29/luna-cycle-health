import { API, ApiError } from '../api';
import * as outbox from './outbox';
import * as snapshot from './snapshot';
import * as store from './store';
import { applyPatch, entryToPayload } from './patch';
import { emailKey } from './serial';

// Replays the outbox against the server, oldest item first. Every item is safe to send twice: a period carries its
// client id (idempotent create) and a day patch is applied to a fresh server read, so a lost response or a crash
// between the request and the dequeue only repeats the same result.
export const SYNC_INTERVAL_MS = 60 * 1000;
const BACKOFF_BASE_MS = 5 * 1000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;
const ID_CONFLICT = 'Period id is already in use';

export const backoffMs = attempts => Math.min(2 ** Math.max(0, Math.floor(attempts) || 0) * BACKOFF_BASE_MS, BACKOFF_MAX_MS);

const flights = new Map(); // emailKey -> in-flight run, shared by every engine for that user

class SignedOut extends Error {}
class BadResponse extends Error {}

const isEmpty = payload => Object.keys(payload).length === 0;
const validItem = i => (i.kind === 'period.create' ? typeof i.clientId === 'string' && i.clientId !== '' : typeof i.date === 'string' && i.date !== '');
const dropInfo = (item, reason, status) => {
  const info = { kind: item.kind };
  if (item.kind !== 'period.create' && item.date) info.date = item.date;
  info.reason = reason;
  if (status !== undefined) info.status = status;
  return info;
};

// What to do with an item whose request failed.
function classify(error, item) {
  if (!(error instanceof ApiError) || typeof error.status !== 'number') return { stop: 'error' };
  const { status } = error;
  if (status === 0) return { stop: 'network', backoff: true };
  if (status === 429 || status >= 500) return { stop: 'server', backoff: true };
  if (status === 401) return { stop: 'error' }; // the refresh inside req() was rejected: keep it for the next session
  if (status === 409 && item.kind === 'period.create' && error.rawMessage === ID_CONFLICT) return { drop: 'id-conflict' };
  if (status >= 400 && status < 500) return { drop: 'rejected' };
  return { stop: 'error' };
}

export function createSync({ email, getToken, now = Date.now, api = API, onChange } = {}) {
  let disposed = false;
  let started = false;
  let timer = null;

  async function run() {
    const gen = store.currentGeneration();
    const result = { synced: 0, dropped: [], stoppedBy: null, pending: 0, queueLost: false };
    const alive = () => !disposed && store.currentGeneration() === gen;
    const guard = () => { if (!alive()) throw new SignedOut(); };
    const token = async () => { guard(); return getToken(); };
    const signedOut = () => ({ ...result, stoppedBy: 'signed-out', pending: 0 });

    // Writes one day and returns the snapshot refresh for it (from the server's answer).
    async function writeDay(date, payload) {
      const range = { from: date, to: date };
      if (isEmpty(payload)) {
        try {
          await api.logs.remove(date, await token());
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
        return async () => { guard(); await snapshot.saveSlice(email, 'logs', {}, range); };
      }
      const res = await api.logs.put(date, payload, await token());
      return async () => {
        if (!res || typeof res !== 'object') return;
        if (res.deleted) { guard(); await snapshot.saveSlice(email, 'logs', {}, range); return; }
        if (res.date !== date) return;
        guard();
        await snapshot.saveSlice(email, 'logs', { [date]: res }, range);
      };
    }

    async function send(item) {
      if (item.kind === 'period.create') {
        await api.periods.create({ ...(item.payload || {}), id: item.clientId }, await token());
        return async () => {
          const list = await api.periods.list(await token());
          guard();
          if (Array.isArray(list)) await snapshot.saveSlice(email, 'periods', list);
        };
      }
      if (item.kind === 'log.patch') {
        const rows = await api.logs.list(item.date, item.date, await token());
        if (!Array.isArray(rows)) throw new BadResponse('unexpected logs response');
        guard();
        const entry = rows.find(r => r && r.date === item.date) || null;
        return writeDay(item.date, applyPatch(entry, { set: item.set, clear: item.clear }));
      }
      if (item.kind === 'log.replace') return writeDay(item.date, entryToPayload(item.payload));
      return writeDay(item.date, {}); // log.delete
    }

    const seen = new Set();
    try {
      for (;;) {
        if (!alive()) return signedOut();
        const item = await outbox.claimNext(email, now());
        if (!item) break;
        let claimed = true;
        try {
          if (seen.has(item.id)) { result.stoppedBy = 'error'; break; } // the dequeue was not stored: don't loop on it
          seen.add(item.id);
          if (!alive()) return signedOut();

          if (!validItem(item)) {
            await outbox.remove(email, item.id);
            claimed = false;
            result.dropped.push(dropInfo(item, 'invalid'));
            continue;
          }

          let refresh;
          try {
            refresh = await send(item);
          } catch (e) {
            if (e instanceof SignedOut || !alive()) return signedOut();
            const c = classify(e, item);
            if (c.drop) {
              await outbox.remove(email, item.id);
              claimed = false;
              result.dropped.push(dropInfo(item, c.drop, e.status));
              continue;
            }
            if (c.backoff) {
              await outbox.markFailed(email, item.id, now() + backoffMs(item.attempts || 0));
              claimed = false;
            }
            result.stoppedBy = c.stop;
            break;
          }

          if (!alive()) return signedOut();
          // Dequeue before the refresh: a crash in between only leaves a stale snapshot, fixed by the next fetch.
          await outbox.remove(email, item.id);
          claimed = false;
          result.synced += 1;
          try {
            await refresh();
          } catch (e) {
            if (e instanceof SignedOut) return signedOut();
            // A failed refresh is not a failed item; the next normal fetch updates the snapshot.
          }
          if (!alive()) return signedOut();
        } finally {
          if (claimed) outbox.release(email, item.id);
        }
      }
      if (!alive()) return signedOut();
      result.pending = (await outbox.loadOutbox(email)).length;
      result.queueLost = outbox.consumeOutboxLoss(email);
      if (!alive()) return signedOut();
      return result;
    } catch (e) {
      if (e instanceof SignedOut || !alive()) return signedOut();
      return { ...result, stoppedBy: 'error' };
    }
  }

  function syncNow() {
    if (disposed) return Promise.resolve({ synced: 0, dropped: [], stoppedBy: 'signed-out', pending: 0, queueLost: false });
    const key = emailKey(email);
    if (flights.has(key)) return flights.get(key);
    const flight = run().then(result => {
      if (result.stoppedBy !== 'signed-out' && typeof onChange === 'function') {
        try { onChange(result); } catch (e) { /* a listener error must not break sync */ }
      }
      return result;
    }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
    flights.set(key, flight);
    return flight;
  }

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const onOnline = () => { syncNow(); };
  const onVisibility = () => { if (visible()) syncNow(); };
  const onTick = async () => {
    if (disposed || !visible()) return;
    try {
      if ((await outbox.loadOutbox(email)).length) await syncNow();
    } catch (e) { /* next tick retries */ }
  };

  function start() {
    if (started || disposed) return;
    started = true;
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    timer = setInterval(onTick, SYNC_INTERVAL_MS);
  }

  function stop() {
    if (!started) return;
    started = false;
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
    timer = null;
  }

  // Sign-out: stop triggers, make any run in flight stop quietly, and forget the outbox's in-memory locks/flags.
  function reset() {
    stop();
    disposed = true;
    outbox.resetMemory();
  }

  return { syncNow, start, stop, reset };
}

export function resetSyncState() { flights.clear(); }
