/* global globalThis */
import { API, ApiError } from '../api';
import { isNative } from '../platform';
import * as store from './store';
import * as snapshot from './snapshot';
import * as outbox from './outbox';
import { createSync, onSignOut } from './sync';
import { periodsWithPending, logsWithPending } from './overlay';
import { applyPatch, entryToPayload } from './patch';
import { createStatus, webStatus } from './status';
import { timedApi, DEFAULT_TIMEOUT_MS } from './timeout';

// The calls the screens make for periods, day logs, medications, consents and auth status, with the same names and
// result shapes as `API`. Native: online results are cached (encrypted) and returned overlaid with queued changes; a
// network failure (status 0) serves the cache (reads) or queues the change and returns an optimistic result (writes).
// Every other error propagates unchanged. Web: a plain pass-through to `API`.

const isNetwork = e => e instanceof ApiError && e.status === 0;
const isEmpty = p => Object.keys(p).length === 0;
const deletedDay = date => ({ date, deleted: true });
const inRange = (d, from, to) => d >= from && d <= to;
const MAX_SEQ = Number.MAX_SAFE_INTEGER;

function toMap(rows) {
  const m = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { if (r && typeof r.date === 'string') m[r.date] = r; });
  return m;
}
const rangeRows = (map, from, to) => Object.keys(map).filter(d => inRange(d, from, to)).sort().map(d => map[d]);
const byStartDesc = list => list.slice().sort((a, b) => {
  const x = String((a && a.start_date) || ''); const y = String((b && b.start_date) || '');
  return x < y ? 1 : x > y ? -1 : 0;
});
const withoutId = payload => {
  const { id, ...rest } = payload || {}; // eslint-disable-line no-unused-vars
  return rest;
};
const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = ymd => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS : null;
};
// Same rule as the server: days since the previous period's start, null for the first. Newest first, like the API.
function withCycleLengths(list) {
  const asc = byStartDesc(list).reverse();
  let prev = null;
  const out = asc.map(p => {
    if (!p || typeof p !== 'object') return p;
    const day = dayNumber(p.start_date);
    const next = { ...p, cycle_length: day !== null && prev !== null ? day - prev : null };
    if (day !== null) prev = day;
    return next;
  });
  return out.reverse();
}
class BadResponse extends Error {}
const dropInfo = (item, reason) => {
  const info = { kind: item.kind };
  if (item.kind !== 'period.create' && item.date) info.date = item.date;
  info.reason = reason;
  return info;
};

// The check-in write: merge into the server's current copy of the day (never a cached one), then PUT, or DELETE when
// nothing is left.
async function patchOnline(api, date, patch, token) {
  const rows = await api.logs.list(date, date, token);
  if (!Array.isArray(rows)) throw new BadResponse('unexpected logs response'); // never PUT over an unknown day
  const entry = rows.find(r => r && r.date === date) || null;
  const payload = applyPatch(entry, patch);
  if (isEmpty(payload)) {
    await api.logs.remove(date, token);
    return deletedDay(date);
  }
  return api.logs.put(date, payload, token);
}

export function createPassthrough(api = API) {
  return {
    listPeriods: token => api.periods.list(token),
    listLogs: (from, to, token) => api.logs.list(from, to, token),
    listMedications: (token, includeArchived) => api.medications.list(token, includeArchived),
    createPeriod: (payload, token) => api.periods.create(payload, token),
    saveLog: (date, payload, token) => api.logs.put(date, payload, token),
    patchLog: (date, patch, token) => patchOnline(api, date, patch, token),
    removeLog: (date, token) => api.logs.remove(date, token),
    getConsents: token => api.consents.get(token),
    getAuthStatus: token => api.auth.status(token),
    pendingSummary: async () => ({ count: 0 }),
    wipe: async () => {},
  };
}

function createWebOffline(api) {
  const data = createPassthrough(api);
  const idle = () => Promise.resolve();
  const sync = {
    syncNow: async () => ({ synced: 0, dropped: [], stoppedBy: null, pending: 0, queueLost: false, storageError: false }),
    start: () => {}, stop: () => {}, whenIdle: idle, wipe: data.wipe,
  };
  return { data, sync, status: webStatus, startSync: sync.start, stopSync: sync.stop, wipe: data.wipe, pendingSummary: data.pendingSummary };
}

function createNativeOffline({ email, getToken, api, timeoutMs, syncFactory }) {
  let disposed = false;
  const net = timedApi(api, timeoutMs);
  const web = createPassthrough(net); // used once retired: straight to the server, nothing stored
  // Any sign-out (this facade's wipe(), another facade's, or clearLocalUserData()) retires this facade for good.
  const birth = store.currentGeneration();
  const retired = () => disposed || store.currentGeneration() !== birth;
  const kicks = new Set();
  let writeChain = Promise.resolve();
  let listening = false;

  const { status, internal: rawStatus } = createStatus({ onAcknowledge: () => { refreshOutbox(store.currentGeneration()); } });
  // Status updates stop once retired (the state stays frozen until the facade is dropped).
  const internal = {};
  Object.keys(rawStatus).forEach(k => { internal[k] = (...args) => (retired() ? undefined : rawStatus[k](...args)); });
  const live = gen => !retired() && store.currentGeneration() === gen;

  // --- status bookkeeping -------------------------------------------------------------------------------------------
  function noteOutbox(count, unreadable) {
    internal.setPending(count);
    if (unreadable) {
      outbox.consumeOutboxLoss(email); // this read already reports it; sync must not report it again
      internal.reportLoss();
    } else internal.outboxReadable();
  }

  async function refreshOutbox(gen) {
    try {
      const { items, unreadable } = await outbox.loadOutboxDetailed(email);
      if (!live(gen)) return [];
      noteOutbox(items.length, unreadable);
      return items;
    } catch (e) { return []; }
  }

  function onSyncResult(r) {
    if (retired() || !r || r.stoppedBy === 'signed-out') return;
    if (r.stoppedBy === 'network') internal.setNetwork(false);
    else if (r.synced || (r.dropped && r.dropped.length) || r.stoppedBy === 'server') internal.setNetwork(true);
    refreshOutbox(store.currentGeneration()); // r.pending can be stale when a write landed as the run finished
    internal.addDropped(r.dropped);
    if (r.queueLost) internal.reportLoss();
    if (r.storageError) internal.setError(store.lastStoreError() || new Error('offline storage failed'));
  }

  const engine = syncFactory({ email, getToken, api, timeoutMs, retireOnSignOut: true, onChange: onSyncResult });

  // Starts a background sync. Joining a run that already passed its last claim does not send a change queued just
  // now, so when the queue still holds items after a clean run, one more run is started.
  function kick({ force = false, again = true } = {}) {
    if (retired()) return;
    const gen = store.currentGeneration();
    const p = Promise.resolve()
      .then(() => engine.syncNow(force ? { force: true } : undefined))
      .then(async r => {
        const items = await refreshOutbox(gen);
        if (again && r && r.stoppedBy === null && items.length > (r.pending || 0)) kick({ again: false });
      })
      .catch(() => {});
    kicks.add(p);
    p.then(() => kicks.delete(p));
  }

  // A request reached the server: if the last one had failed on the network, retry the queue right away (it may be
  // waiting on a long backoff while navigator.onLine never changed).
  function reachable() {
    if (internal.setNetwork(true)) kick({ force: true });
  }

  // Waits for the syncs started by this facade's writes and recoveries (kicks) only, not for other triggers.
  async function whenIdle() {
    while (kicks.size) await Promise.all([...kicks]); // eslint-disable-line no-await-in-loop
  }

  // --- cache helpers -----------------------------------------------------------------------------------------------
  async function cache(gen, slice, value, range) {
    if (!live(gen)) return; // a sign-out since the request started: never recreate data
    try { await snapshot.saveSlice(email, slice, value, range); } catch (e) { /* the cache is best effort */ }
  }

  async function cacheDay(gen, date, res) {
    if (!res || typeof res !== 'object') return;
    const range = { from: date, to: date };
    if (res.deleted) await cache(gen, 'logs', {}, range);
    else if (res.date === date) await cache(gen, 'logs', { [date]: res }, range);
  }

  async function update(gen, slice, fn) {
    if (!live(gen)) return;
    try { await snapshot.updateSlice(email, slice, fn); } catch (e) { /* the cache is best effort */ }
  }

  // Adds the created period to the cached list (never invents a partial list) and recomputes cycle lengths locally.
  function cachePeriod(gen, res) {
    if (!res || typeof res !== 'object' || !res.id) return undefined;
    return update(gen, 'periods', cached => (Array.isArray(cached)
      ? withCycleLengths([...cached.filter(p => !p || p.id !== res.id), res]) : undefined));
  }

  // Online first; on a network error, `fromCache()` returns the cached view or undefined (then the error is re-thrown).
  async function read(gen, request, fromCache) {
    try {
      const res = await request();
      reachable();
      return { res };
    } catch (e) {
      if (!isNetwork(e)) throw e;
      internal.setNetwork(false);
      if (!live(gen)) throw e;
      const cached = await fromCache();
      if (cached === undefined || !live(gen)) throw e; // signed out meanwhile: never hand out wiped data
      return { cached };
    }
  }

  // --- writes ------------------------------------------------------------------------------------------------------
  function serialWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  // Sends directly when nothing is queued; queues (keeping order) when something is, or when the request fails with a
  // network error. Resolves { res } when sent, or { items } (the queue as it now stands) when queued.
  async function sendOrQueue(gen, send, item) {
    const before = await refreshOutbox(gen);
    let networkError = null;
    if (!before.length || !live(gen)) {
      try {
        const res = await send();
        reachable();
        return { res };
      } catch (e) {
        if (!isNetwork(e)) throw e;
        internal.setNetwork(false);
        networkError = e;
      }
    }
    if (!live(gen)) throw networkError || new Error('signed out');

    let r;
    try { r = await outbox.enqueue(email, item); } catch (e) { r = { item: null, dropped: [], persisted: false, lostPending: false }; }
    if (!live(gen)) throw networkError || new Error('signed out');
    if (r.lostPending) {
      outbox.consumeOutboxLoss(email);
      internal.reportLoss();
    }
    if (r.dropped && r.dropped.length) internal.addDropped(r.dropped.map(i => dropInfo(i, 'overflow')));
    let items;
    if (r.persisted) {
      internal.setError(null);
      items = await refreshOutbox(gen);
    } else {
      internal.setError(store.lastStoreError() || new Error('offline storage failed'));
      // Not stored: still show the change as made (the queue as read before, plus this item last).
      items = [...(r.lostPending ? [] : before), { ...item, seq: MAX_SEQ }];
    }
    kick();
    return { items };
  }

  async function overlaidDay(date, items) {
    const { logs } = await snapshot.loadSnapshot(email);
    return logsWithPending(logs, items)[date] || deletedDay(date);
  }

  const data = {
    async listPeriods(token) {
      if (retired()) return web.listPeriods(token);
      const gen = store.currentGeneration();
      const out = await read(gen, () => net.periods.list(token), async () => {
        const { periods } = await snapshot.loadSnapshot(email);
        if (!Array.isArray(periods)) return undefined;
        return periodsWithPending(periods, await refreshOutbox(gen));
      });
      if (!('res' in out)) return out.cached;
      const list = out.res;
      if (!Array.isArray(list) || !live(gen)) return list;
      await cache(gen, 'periods', list);
      const items = await refreshOutbox(gen);
      return items.some(i => i.kind === 'period.create') ? periodsWithPending(list, items) : list;
    },

    async listLogs(from, to, token) {
      if (retired()) return web.listLogs(from, to, token);
      const gen = store.currentGeneration();
      const out = await read(gen, () => net.logs.list(from, to, token), async () => {
        if (!(await snapshot.hasSlice(email, 'logs'))) return undefined;
        const { logs } = await snapshot.loadSnapshot(email);
        return rangeRows(logsWithPending(logs, await refreshOutbox(gen)), from, to);
      });
      if (!('res' in out)) return out.cached;
      const rows = out.res;
      if (!Array.isArray(rows) || !live(gen)) return rows;
      await cache(gen, 'logs', toMap(rows), { from, to });
      const items = await refreshOutbox(gen);
      const touched = items.some(i => i.kind !== 'period.create' && typeof i.date === 'string' && inRange(i.date, from, to));
      return touched ? rangeRows(logsWithPending(toMap(rows), items), from, to) : rows;
    },

    async listMedications(token, includeArchived) {
      if (retired()) return web.listMedications(token, includeArchived);
      const gen = store.currentGeneration();
      const out = await read(gen, () => net.medications.list(token, includeArchived), async () => {
        const { medications } = await snapshot.loadSnapshot(email);
        if (!Array.isArray(medications)) return undefined;
        return includeArchived ? medications : medications.filter(m => m && !m.archived);
      });
      if (!('res' in out)) return out.cached;
      const list = out.res;
      if (!Array.isArray(list) || !live(gen)) return list;
      if (includeArchived) {
        await cache(gen, 'medications', list);
      } else {
        // An active-only list says nothing about archived ones: keep those the cache already has.
        const ids = new Set(list.map(m => m && m.id));
        await update(gen, 'medications', cached => [
          ...list, ...(Array.isArray(cached) ? cached.filter(m => m && m.archived && !ids.has(m.id)) : [])]);
      }
      return list;
    },

    getConsents(token) { return cachedValue('consents', () => net.consents.get(token), () => web.getConsents(token)); },
    getAuthStatus(token) { return cachedValue('authStatus', () => net.auth.status(token), () => web.getAuthStatus(token)); },

    createPeriod(payload, token) {
      if (retired()) return web.createPeriod(payload, token);
      return serialWrite(async () => {
        const gen = store.currentGeneration();
        const id = globalThis.crypto.randomUUID();
        const body = withoutId(payload);
        const out = await sendOrQueue(gen, () => net.periods.create({ ...body, id }, token),
          { kind: 'period.create', clientId: id, payload: body });
        if ('res' in out) {
          await cachePeriod(gen, out.res);
          return out.res;
        }
        return { ...body, id, cycle_length: null, pending: true };
      });
    },

    // Day sheet: the full state of the day; an empty payload deletes the day.
    saveLog(date, payload, token) {
      if (retired()) return web.saveLog(date, payload, token);
      return serialWrite(async () => {
        const gen = store.currentGeneration();
        const body = entryToPayload(payload);
        const item = isEmpty(body) ? { kind: 'log.delete', date } : { kind: 'log.replace', date, payload: body };
        const out = await sendOrQueue(gen, () => net.logs.put(date, payload, token), item);
        if ('res' in out) {
          await cacheDay(gen, date, out.res);
          return out.res;
        }
        return isEmpty(body) ? deletedDay(date) : overlaidDay(date, out.items);
      });
    },

    // Check-in: { set, clear } merged into the server's current copy (online) or queued as a patch (offline).
    patchLog(date, patch, token) {
      if (retired()) return web.patchLog(date, patch, token);
      return serialWrite(async () => {
        const gen = store.currentGeneration();
        const set = (patch && patch.set) || {};
        const clear = (patch && patch.clear) || [];
        const out = await sendOrQueue(gen, () => patchOnline(net, date, { set, clear }, token), { kind: 'log.patch', date, set, clear });
        if ('res' in out) {
          await cacheDay(gen, date, out.res);
          return out.res;
        }
        return overlaidDay(date, out.items);
      });
    },

    removeLog(date, token) {
      if (retired()) return web.removeLog(date, token);
      return serialWrite(async () => {
        const gen = store.currentGeneration();
        const out = await sendOrQueue(gen, () => net.logs.remove(date, token), { kind: 'log.delete', date });
        if ('res' in out) {
          await cache(gen, 'logs', {}, { from: date, to: date });
          return out.res;
        }
        return { deleted: true };
      });
    },

    async pendingSummary() {
      if (retired()) return { count: 0 };
      return { count: (await outbox.loadOutbox(email)).length };
    },

    wipe,
  };

  // Consents and auth status: a cached server answer is reused offline; nothing is ever made up.
  async function cachedValue(slice, request, passthrough) {
    if (retired()) return passthrough();
    const gen = store.currentGeneration();
    const out = await read(gen, request, async () => {
      const snap = await snapshot.loadSnapshot(email);
      return snap[slice] === null || snap[slice] === undefined ? undefined : snap[slice];
    });
    if (!('res' in out)) return out.cached;
    if (out.res !== null && out.res !== undefined) await cache(gen, slice, out.res);
    return out.res;
  }

  const onOnline = () => { internal.setNetwork(true); };
  const onOffline = () => { internal.deviceChanged(); };

  function startSync() {
    if (retired()) return;
    engine.start();
    if (!listening) {
      listening = true;
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
  }

  function stopSync() {
    engine.stop();
    if (listening) {
      listening = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
  }

  // Sign-out: stop this engine, wipe every cached blob and the vault key, forget in-memory queue state. The facade
  // stays usable as a plain pass-through but never stores anything again.
  async function wipe() {
    disposed = true;
    stopSync();
    engine.reset();
    const cleared = store.clearAll(); // bumps the store generation now, so queued work is dropped
    outbox.resetMemory();
    kicks.clear();
    rawStatus.reset();
    try { await cleared; } finally { onSignOut(); }
  }

  const sync = {
    // Resolves after the pending count was re-read. A retired engine answers 'signed-out' without sending anything.
    syncNow: async opts => {
      const gen = store.currentGeneration();
      const r = await engine.syncNow(opts);
      await refreshOutbox(gen);
      return r;
    },
    start: startSync,
    stop: stopSync,
    whenIdle,
    wipe,
  };

  refreshOutbox(store.currentGeneration()); // initial pending count

  return { data, sync, status, startSync, stopSync, wipe, pendingSummary: data.pendingSummary };
}

export function createOfflineData({
  email, getToken, api = API, timeoutMs = DEFAULT_TIMEOUT_MS, syncFactory = createSync,
} = {}) {
  const usable = typeof email === 'string' && email.trim() !== '';
  if (!isNative() || !usable) return createWebOffline(api);
  return createNativeOffline({ email, getToken, api, timeoutMs, syncFactory });
}
