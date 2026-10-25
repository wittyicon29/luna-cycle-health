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
const RETRYABLE = [408, 425, 429];

export const backoffMs = attempts => Math.min(2 ** Math.max(0, Math.floor(attempts) || 0) * BACKOFF_BASE_MS, BACKOFF_MAX_MS);

// One run at a time per user. `flights` (key: email + store generation) lets callers join the run in progress; a
// flight from before a sign-out is never joined. `tails` (key: email) chains runs so a new run starts only after the
// previous one (even an abandoned one) has settled, which keeps the queue order.
const flights = new Map();
const tails = new Map();
let memoryGeneration = store.currentGeneration();

// Sign-out path (after store.clearAll()): forget the outbox's in-memory locks and loss flags, but only when the data
// really was cleared, so an engine reset alone never touches another engine's claim.
export function onSignOut() {
  const gen = store.currentGeneration();
  if (gen === memoryGeneration) return;
  memoryGeneration = gen;
  outbox.resetMemory();
}

class SignedOut extends Error {}
class BadResponse extends Error {}

const emptyResult = () => ({ synced: 0, dropped: [], stoppedBy: null, pending: 0, queueLost: false, storageError: false });
const signedOutResult = (r = emptyResult()) => ({ ...r, stoppedBy: 'signed-out', pending: 0 });
const isEmpty = payload => Object.keys(payload).length === 0;
const validItem = i => (i.kind === 'period.create' ? typeof i.clientId === 'string' && i.clientId !== '' : typeof i.date === 'string' && i.date !== '');
const dropInfo = (item, reason, status) => {
  const info = { kind: item.kind };
  if (item.kind !== 'period.create' && item.date) info.date = item.date;
  info.reason = reason;
  if (status !== undefined) info.status = status;
  return info;
};
const deviceOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// What to do with an item whose request failed.
function classify(error, item) {
  if (!(error instanceof ApiError) || typeof error.status !== 'number') return { stop: 'error' };
  const { status } = error;
  if (status === 0) return { stop: 'network', backoff: true };
  if (RETRYABLE.includes(status) || status >= 500) return { stop: 'server', backoff: true };
  // 401: the refresh inside req() was rejected. 403: e.g. consent missing. Both are about the session, not the
  // change itself, so keep the item for later instead of losing the user's data.
  if (status === 401 || status === 403) return { stop: 'error' };
  if (status === 409 && item.kind === 'period.create' && error.rawMessage === ID_CONFLICT) return { drop: 'id-conflict' };
  if (status >= 400 && status < 500) return { drop: 'rejected' };
  return { stop: 'error' };
}

export function createSync({ email, getToken, now = Date.now, api = API, onChange } = {}) {
  let disposed = false;
  let started = false;
  let timer = null;
  let claim = null; // id this engine has claimed in the pass it is running
  let flight = null; // the flight this engine started or joined last

  // One pass over the queue.
  async function pass(gen) {
    const result = emptyResult();
    const alive = () => !disposed && store.currentGeneration() === gen;
    const guard = () => { if (!alive()) throw new SignedOut(); };
    const token = async () => {
      guard();
      const t = await getToken();
      guard();
      return t;
    };
    let periodsChanged = false;

    // Writes one day; returns the snapshot update derived from the server's answer.
    async function writeDay(date, payload) {
      const range = { from: date, to: date };
      if (isEmpty(payload)) {
        try {
          await api.logs.remove(date, await token());
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
        return () => snapshot.saveSlice(email, 'logs', {}, range);
      }
      const res = await api.logs.put(date, payload, await token());
      return async () => {
        if (!res || typeof res !== 'object') return;
        if (res.deleted) await snapshot.saveSlice(email, 'logs', {}, range);
        else if (res.date === date) await snapshot.saveSlice(email, 'logs', { [date]: res }, range);
      };
    }

    async function send(item) {
      if (item.kind === 'period.create') {
        const res = await api.periods.create({ ...(item.payload || {}), id: item.clientId }, await token());
        periodsChanged = true;
        return async () => {
          // Put the created period into the cached list (only when one exists: never invent a partial list).
          if (!res || typeof res !== 'object' || res.id !== item.clientId) return;
          const cached = (await snapshot.loadSnapshot(email)).periods;
          if (!Array.isArray(cached)) return;
          guard();
          await snapshot.saveSlice(email, 'periods', [...cached.filter(p => !p || p.id !== res.id), res]);
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
        if (!alive()) return signedOutResult(result);
        const item = await outbox.claimNext(email, now());
        if (!item) break;
        claim = item.id;
        let claimed = true;
        try {
          if (seen.has(item.id)) { result.stoppedBy = 'error'; break; } // its dequeue was not stored: don't loop
          seen.add(item.id);
          if (!alive()) return signedOutResult(result);

          if (!validItem(item)) {
            const stored = await outbox.remove(email, item.id);
            claimed = false;
            result.dropped.push(dropInfo(item, 'invalid'));
            if (!stored) { result.storageError = true; result.stoppedBy = 'error'; break; }
            continue;
          }

          let update;
          try {
            update = await send(item);
          } catch (e) {
            if (e instanceof SignedOut || !alive()) return signedOutResult(result);
            const c = classify(e, item);
            if (c.drop) {
              const stored = await outbox.remove(email, item.id);
              claimed = false;
              result.dropped.push(dropInfo(item, c.drop, e.status));
              if (!stored) { result.storageError = true; result.stoppedBy = 'error'; break; }
              continue;
            }
            result.stoppedBy = c.stop;
            if (c.backoff) {
              const network = c.stop === 'network';
              const countAttempt = !(network && deviceOffline()); // offline: waiting, not failing
              const attempts = (item.attempts || 0);
              const stored = await outbox.markFailed(email, item.id, now() + backoffMs(attempts), { network, countAttempt });
              claimed = false;
              if (!stored) { result.storageError = true; result.stoppedBy = 'error'; }
            }
            break;
          }

          if (!alive()) return signedOutResult(result);
          // Snapshot first, then dequeue: a crash in between leaves the item queued over a snapshot that already has
          // it, which the overlay shows once (period keyed by id; a patch re-applied gives the same day).
          try {
            await update();
          } catch (e) {
            if (e instanceof SignedOut) return signedOutResult(result);
            // A failed snapshot update is not a failed item; the next normal fetch fixes the snapshot.
          }
          if (!alive()) return signedOutResult(result);
          const stored = await outbox.remove(email, item.id);
          claimed = false;
          result.synced += 1;
          if (!stored) { result.storageError = true; result.stoppedBy = 'error'; break; }
        } finally {
          if (claimed) outbox.release(email, item.id);
          if (claim === item.id) claim = null;
        }
      }

      if (periodsChanged && alive()) {
        try {
          const list = await api.periods.list(await token());
          guard();
          if (Array.isArray(list)) await snapshot.saveSlice(email, 'periods', list);
        } catch (e) {
          if (e instanceof SignedOut) return signedOutResult(result);
        }
      }
      if (!alive()) return signedOutResult(result);
      result.pending = (await outbox.loadOutbox(email)).length;
      result.queueLost = outbox.consumeOutboxLoss(email);
      if (!alive()) return signedOutResult(result);
      return result;
    } catch (e) {
      if (e instanceof SignedOut || !alive()) return signedOutResult(result);
      return { ...result, stoppedBy: 'error' };
    }
  }

  const engine = {
    pass,
    isLive: () => !disposed,
    notify(result) {
      if (disposed || result.stoppedBy === 'signed-out' || typeof onChange !== 'function') return;
      try { onChange(result); } catch (e) { /* a listener error must not break sync */ }
    },
  };

  function startFlight(key, gen) {
    const ek = emailKey(email);
    const prev = tails.get(ek) || Promise.resolve();
    const f = { key, gen, rerun: false, force: false, engines: new Set([engine]) };
    const liveEngine = () => [...f.engines].find(e => e.isLive());
    f.promise = (async () => {
      await prev.catch(() => {});
      if (store.currentGeneration() !== gen) return signedOutResult();
      onSignOut(); // a clearAll since the last run: drop stale in-memory locks before claiming
      const total = emptyResult();
      let last = emptyResult();
      for (;;) {
        const runner = liveEngine();
        if (!runner) return signedOutResult(total);
        const force = f.force;
        f.rerun = false;
        f.force = false;
        if (force) await outbox.clearBackoff(email);
        last = await runner.pass(gen);
        total.synced += last.synced;
        total.dropped.push(...last.dropped);
        total.queueLost = total.queueLost || last.queueLost;
        total.storageError = total.storageError || last.storageError;
        if (last.stoppedBy === 'signed-out') {
          // The engine running it was reset; another live engine in the same session carries on.
          if (store.currentGeneration() === gen && liveEngine()) continue;
          break;
        }
        // One follow-up pass when someone asked during this pass (a change enqueued after the last claim).
        if (f.rerun && (last.stoppedBy === null || f.force)) continue;
        break;
      }
      return { ...total, stoppedBy: last.stoppedBy, pending: last.stoppedBy === 'signed-out' ? 0 : last.pending };
    })().then(result => {
      // Each engine's own onChange fires once for the result of a run it triggered or joined.
      f.engines.forEach(e => e.notify(result));
      return result;
    }).finally(() => {
      if (flights.get(key) === f) flights.delete(key);
      if (tails.get(ek) === f.tail) tails.delete(ek);
    });
    f.tail = f.promise.catch(() => {});
    tails.set(ek, f.tail);
    flights.set(key, f);
    return f;
  }

  // `force: true` (reconnect, app resume) lets items waiting only because the connection was down go right away.
  // A call during a run joins it and schedules one follow-up pass; the promise resolves with the combined result.
  function syncNow({ force = false } = {}) {
    if (disposed) return Promise.resolve(signedOutResult());
    const gen = store.currentGeneration();
    const key = `${emailKey(email)}|${gen}`;
    let f = flights.get(key);
    if (f) {
      f.engines.add(engine);
      f.rerun = true;
      if (force) f.force = true;
    } else {
      f = startFlight(key, gen);
      if (force) f.force = true;
    }
    flight = f;
    return f.promise;
  }

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const onOnline = () => { syncNow({ force: true }); };
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

  // Abandons only this engine: triggers stop, its pass in flight stops at the next check without dequeuing, its own
  // claim is released and its flight is no longer joinable. Global outbox memory is cleared by onSignOut().
  function reset() {
    stop();
    disposed = true;
    if (claim) { outbox.release(email, claim); claim = null; }
    if (flight) {
      flight.engines.delete(engine);
      if (flights.get(flight.key) === flight && ![...flight.engines].some(e => e.isLive())) flights.delete(flight.key);
      flight = null;
    }
  }

  return { syncNow, start, stop, reset };
}

export function resetSyncState() {
  flights.clear();
  tails.clear();
  memoryGeneration = store.currentGeneration();
}
