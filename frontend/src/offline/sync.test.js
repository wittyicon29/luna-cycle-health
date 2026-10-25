const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const { makeServer, EMPTY_ENTRY, apiErr, clone } = require('./testing/fakeServer');
const store = require('./store');
const outbox = require('./outbox');
const snapshot = require('./snapshot');
const { createSync, backoffMs, resetSyncState, onSignOut } = require('./sync');
const vault = require('./vault');
const { periodsWithPending } = require('./overlay');

const realSetTimeout = setTimeout;
const tick = () => new Promise(r => realSetTimeout(r, 0));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function waitUntil(cond, tries = 5000) {
  for (let i = 0; i < tries; i += 1) {
    if (await cond()) return;
    await tick();
  }
  throw new Error('condition not reached');
}

const E = 'a@x.com';
const D = '2026-03-01';
const D2 = '2026-03-02';
const SEC = 1000;
let server;
let clock;
const now = () => clock;
const make = (opts = {}) => createSync({ email: E, getToken: () => 'tok', now, api: server.api, ...opts });
const pcreate = (clientId, start = '2026-01-01') => ({ kind: 'period.create', clientId, payload: { start_date: start } });
const lpatch = (date, set = {}, clear = []) => ({ kind: 'log.patch', date, set, clear });
const items = () => outbox.loadOutbox(E);

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  localStorage.clear();
  mockData.clear();
  await store.__resetForTests();
  outbox.__resetForTests();
  resetSyncState();
  server = makeServer();
  clock = 1_000_000;
});

afterEach(() => { jest.useRealTimers(); });

test('backoff table: 5 s doubling, capped at 15 min', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map(backoffMs)).toEqual(
    [5, 10, 20, 40, 80, 160, 320, 640, 900, 900, 900].map(s => s * SEC));
});

test('happy path: create + patch + replace sync in order, empty the queue and refresh the snapshot', async () => {
  const onChange = jest.fn();
  await outbox.enqueue(E, pcreate('c1'));
  await outbox.enqueue(E, lpatch(D, { mood: 4 }));
  await outbox.enqueue(E, { kind: 'log.replace', date: D2, payload: { note: 'n', flow: 'light', date: D2, updated_at: 'x' } });
  const result = await make({ onChange }).syncNow();

  expect(result).toEqual({ synced: 3, dropped: [], stoppedBy: null, pending: 0, queueLost: false, storageError: false });
  expect(server.names()).toEqual(['periods.create', 'logs.list', 'logs.put', 'logs.put', 'periods.list']);
  expect(server.calls[0].args[0]).toEqual({ start_date: '2026-01-01', id: 'c1' });
  expect(server.calls[2].args).toEqual([D, { mood: 4 }]);
  expect(server.calls[3].args).toEqual([D2, { note: 'n', flow: 'light' }]); // never date/updated_at
  expect(await items()).toEqual([]);
  const snap = await snapshot.loadSnapshot(E);
  expect(snap.periods).toEqual([{ start_date: '2026-01-01', id: 'c1', end_date: null }]);
  expect(snap.logs[D]).toMatchObject({ date: D, mood: 4 });
  expect(snap.logs[D2]).toMatchObject({ date: D2, note: 'n', flow: 'light' });
  expect(onChange).toHaveBeenCalledWith(result);
});

test('an empty queue makes no requests', async () => {
  const result = await make().syncNow();
  expect(result).toEqual({ synced: 0, dropped: [], stoppedBy: null, pending: 0, queueLost: false, storageError: false });
  expect(server.calls).toEqual([]);
});

test('the client id wins over any id inside the payload', async () => {
  await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01', id: 'bogus' } });
  await make().syncNow();
  expect(server.calls[0].args[0].id).toBe('c1');
});

describe('crash points', () => {
  test('period.create response lost: item stays, the replay reuses the id and the server keeps one period', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    server.failNext('periods.create', apiErr(0), { after: true });
    const first = await make().syncNow();
    expect(first).toMatchObject({ synced: 0, stoppedBy: 'network', pending: 1 });
    expect(server.periods).toHaveLength(1);
    const [kept] = await items();
    expect(kept).toMatchObject({ clientId: 'c1', attempts: 1, nextTryAt: clock + 5 * SEC });

    clock += 5 * SEC;
    const second = await make().syncNow();
    expect(second).toMatchObject({ synced: 1, stoppedBy: null, pending: 0 });
    expect(server.calls.filter(c => c.name === 'periods.create').map(c => c.args[0].id)).toEqual(['c1', 'c1']);
    expect(server.periods).toEqual([{ start_date: '2026-01-01', id: 'c1', end_date: null }]);
    expect((await snapshot.loadSnapshot(E)).periods).toHaveLength(1);
  });

  test('log.patch response lost: re-applying yields the same entry', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, note: 'B', flow: 'light' };
    await outbox.enqueue(E, lpatch(D, { mood: 4 }, ['flow']));
    server.failNext('logs.put', apiErr(503), { after: true });
    expect(await make().syncNow()).toMatchObject({ synced: 0, stoppedBy: 'server', pending: 1 });
    const afterFirst = clone(server.logs[D]);
    expect(afterFirst).toMatchObject({ note: 'B', mood: 4, flow: null });

    clock += 5 * SEC;
    expect(await make().syncNow()).toMatchObject({ synced: 1, pending: 0 });
    expect(server.logs[D]).toEqual(afterFirst);
    expect(server.calls.filter(c => c.name === 'logs.put').map(c => c.args[1])).toEqual([{ note: 'B', mood: 4 }, { note: 'B', mood: 4 }]);
  });

  test('crash after the request but before the dequeue: replay on restart duplicates nothing', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, note: 'B' };
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, lpatch(D, { mood: 4 }));
    const before = { ...localStorage };
    await make().syncNow();
    const serverAfter = clone({ periods: server.periods, logs: server.logs });

    // Simulate the process dying before the dequeue was persisted: the queue on disk is the pre-run one.
    localStorage.clear();
    Object.entries(before).forEach(([k, v]) => localStorage.setItem(k, v));
    outbox.__resetForTests();
    resetSyncState();
    expect(await items()).toHaveLength(2);

    expect(await make().syncNow()).toMatchObject({ synced: 2, pending: 0, dropped: [] });
    expect({ periods: server.periods, logs: server.logs }).toEqual(serverAfter);
    expect(server.periods).toHaveLength(1);
  });

  test('crash after the dequeue but before the list refresh: after a restart the period shows exactly once', async () => {
    await snapshot.saveSlice(E, 'periods', []);
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2', '2026-02-01'));
    server.failNext('periods.list', apiErr(0));
    const result = await make().syncNow();
    expect(result).toMatchObject({ synced: 2, stoppedBy: null, pending: 0 });
    expect(server.periods.map(p => p.id)).toEqual(['c1', 'c2']);

    // restart: in-memory state gone, everything reloaded from the encrypted store
    outbox.__resetForTests();
    resetSyncState();
    vault.__resetCacheForTests();
    const shown = periodsWithPending((await snapshot.loadSnapshot(E)).periods, await items());
    expect(shown.map(p => p.id).sort()).toEqual(['c1', 'c2']);
    expect(shown.some(p => p.pending)).toBe(false);
  });

  test('crash after the snapshot write but before the dequeue: after a restart the period shows exactly once', async () => {
    await snapshot.saveSlice(E, 'periods', []);
    await outbox.enqueue(E, pcreate('c1'));
    const hash = await store.emailHash(E);
    const outboxKey = `luna_offline_${hash}_outbox`;
    const queued = localStorage.getItem(outboxKey);
    await make().syncNow();
    localStorage.setItem(outboxKey, queued); // the dequeue never reached disk
    outbox.__resetForTests();
    resetSyncState();
    vault.__resetCacheForTests();
    const shown = periodsWithPending((await snapshot.loadSnapshot(E)).periods, await items());
    expect(shown.map(p => p.id)).toEqual(['c1']);
    expect(await make().syncNow()).toMatchObject({ synced: 1, pending: 0 });
    expect(server.periods).toHaveLength(1);
  });

  test('periods are listed once per pass, not once per created period', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2', '2026-02-01'));
    await outbox.enqueue(E, pcreate('c3', '2026-03-01'));
    await make().syncNow();
    expect(server.names()).toEqual(['periods.create', 'periods.create', 'periods.create', 'periods.list']);
    expect((await snapshot.loadSnapshot(E)).periods.map(p => p.id)).toEqual(['c1', 'c2', 'c3']);
  });

  test('without a cached periods list the create answer does not invent a partial snapshot', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    server.failNext('periods.list', apiErr(0));
    await make().syncNow();
    expect((await snapshot.loadSnapshot(E)).periods).toBeNull();
  });
});

describe('merge safety', () => {
  test('a patch keeps fields changed elsewhere on the server', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, note: 'from phone B', symptoms: ['cramps'], sleep_hours: 0, updated_at: 'y' };
    await outbox.enqueue(E, lpatch(D, { mood: 4 }));
    await make().syncNow();
    const put = server.calls.find(c => c.name === 'logs.put');
    expect(put.args).toEqual([D, { note: 'from phone B', symptoms: ['cramps'], sleep_hours: 0, mood: 4 }]);
    expect(server.calls.find(c => c.name === 'logs.list').args).toEqual([D, D]);
  });

  test('a patch that clears the only field removes the day instead of a PUT of {}', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, mood: 3 };
    await outbox.enqueue(E, lpatch(D, {}, ['mood']));
    expect(await make().syncNow()).toMatchObject({ synced: 1, pending: 0 });
    expect(server.names()).toEqual(['logs.list', 'logs.remove']);
    expect(server.logs[D]).toBeUndefined();
  });

  test('a 404 from that remove counts as done', async () => {
    await outbox.enqueue(E, lpatch(D, {}, ['mood']));
    server.failNext('logs.remove', apiErr(404));
    expect(await make().syncNow()).toMatchObject({ synced: 1, dropped: [], pending: 0 });
  });

  test('log.replace with an empty payload removes the day; log.delete removes it (404 ignored)', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, mood: 3 };
    await outbox.enqueue(E, { kind: 'log.replace', date: D, payload: { mood: null, symptoms: [] } });
    await outbox.enqueue(E, { kind: 'log.delete', date: D2 });
    server.failNext('logs.remove', apiErr(404));
    server.failNext('logs.remove', apiErr(404));
    expect(await make().syncNow()).toMatchObject({ synced: 2, dropped: [], pending: 0 });
    expect(server.names()).toEqual(['logs.remove', 'logs.remove']);
    expect(server.calls.map(c => c.args[0])).toEqual([D, D2]);
  });

  test('a list response that is not an array never turns into a PUT (keeps the item)', async () => {
    await outbox.enqueue(E, lpatch(D, { mood: 1 }));
    const api = { ...server.api, logs: { ...server.api.logs, list: async () => ({ weird: true }) } };
    expect(await make({ api }).syncNow()).toMatchObject({ synced: 0, stoppedBy: 'error', pending: 1 });
    expect(server.names()).not.toContain('logs.put');
  });

  test('the snapshot day is replaced by the server result and a removed day disappears', async () => {
    await snapshot.saveSlice(E, 'logs', { [D]: { date: D, mood: 1, note: 'old' }, [D2]: { date: D2, mood: 2 } });
    server.logs[D] = { ...EMPTY_ENTRY, date: D, mood: 1, note: 'old' };
    server.logs[D2] = { ...EMPTY_ENTRY, date: D2, mood: 2 };
    await outbox.enqueue(E, lpatch(D, {}, ['note']));
    await outbox.enqueue(E, { kind: 'log.delete', date: D2 });
    await make().syncNow();
    const logs = (await snapshot.loadSnapshot(E)).logs;
    expect(logs[D]).toMatchObject({ date: D, mood: 1, note: null });
    expect(logs[D2]).toBeUndefined();
  });
});

describe('error classes', () => {
  test.each([400, 404, 422])('%i on an item drops and reports it; the next item still runs', async status => {
    await outbox.enqueue(E, lpatch(D, { mood: 4 }));
    await outbox.enqueue(E, pcreate('c1'));
    server.failNext('logs.put', apiErr(status));
    const result = await make().syncNow();
    expect(result).toMatchObject({ synced: 1, stoppedBy: null, pending: 0 });
    expect(result.dropped).toEqual([{ kind: 'log.patch', date: D, reason: 'rejected', status }]);
    expect(server.periods).toHaveLength(1);
  });

  test('409 "Period id is already in use" is a definitive drop with reason id-conflict', async () => {
    server.foreignIds.add('c1');
    await outbox.enqueue(E, pcreate('c1'));
    const result = await make().syncNow();
    expect(result.dropped).toEqual([{ kind: 'period.create', reason: 'id-conflict', status: 409 }]);
    expect(await items()).toEqual([]);
  });

  test.each([
    ['network', 0, 'network'],
    ['429', 429, 'server'],
    ['500', 500, 'server'],
    ['408', 408, 'server'],
    ['425', 425, 'server'],
  ])('%s: stops, backs off per the table, following items untouched', async (_l, status, stoppedBy) => {
    await outbox.enqueue(E, lpatch(D, { mood: 4 }));
    await outbox.enqueue(E, pcreate('c1'));
    const expected = [5, 10, 20, 40, 80, 160, 320, 640, 900, 900];
    for (const secs of expected) {
      server.failNext('logs.list', apiErr(status));
      const result = await make().syncNow();
      expect(result).toMatchObject({ synced: 0, dropped: [], stoppedBy, pending: 2 });
      const [head, next] = await items();
      expect(head.nextTryAt - clock).toBe(secs * SEC);
      expect(next).toMatchObject({ attempts: 0, nextTryAt: 0 });
      clock = head.nextTryAt;
    }
    expect((await items())[0].attempts).toBe(10);
    expect(server.names().every(n => n === 'logs.list')).toBe(true);
  });

  test('a waiting head item blocks every item behind it; order is preserved', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2'));
    server.failNext('periods.create', apiErr(0));
    await make().syncNow();
    server.calls.length = 0;

    clock += 4 * SEC;
    const waiting = await make().syncNow();
    expect(waiting).toMatchObject({ synced: 0, stoppedBy: null, pending: 2 });
    expect(server.calls).toEqual([]);

    clock += SEC;
    expect(await make().syncNow()).toMatchObject({ synced: 2, pending: 0 });
    expect(server.periods.map(p => p.id)).toEqual(['c1', 'c2']);
  });

  test.each([401, 403])('a %i that reaches sync stops the run, drops nothing and keeps the item retryable', async status => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2'));
    server.failNext('periods.create', apiErr(status));
    const sync = make();
    const result = await sync.syncNow();
    expect(result).toEqual({ synced: 0, dropped: [], stoppedBy: 'error', pending: 2, queueLost: false, storageError: false });
    const [head, next] = await items();
    expect(head).toMatchObject({ clientId: 'c1', attempts: 0, nextTryAt: 0 });
    expect(next).toMatchObject({ clientId: 'c2', attempts: 0, nextTryAt: 0 });
    expect(server.names()).toEqual(['periods.create']);
    expect(await sync.syncNow()).toMatchObject({ synced: 2, pending: 0 }); // not left locked
  });

  test('an unexpected exception keeps the item, stops the run and unlocks it', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2'));
    server.failNext('periods.create', new TypeError('bad'));
    const sync = make();
    expect(await sync.syncNow()).toMatchObject({ synced: 0, stoppedBy: 'error', pending: 2 });
    expect(server.names()).toEqual(['periods.create']);
    expect(await sync.syncNow()).toMatchObject({ synced: 2, pending: 0 });
  });

  test('a throwing getToken keeps the item and unlocks it', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    let fail = true;
    const sync = make({ getToken: () => { if (fail) throw new Error('no token'); return 't'; } });
    expect(await sync.syncNow()).toMatchObject({ stoppedBy: 'error', pending: 1 });
    fail = false;
    expect(await sync.syncNow()).toMatchObject({ synced: 1, pending: 0 });
  });

  test('a dequeue that cannot be stored (storage full) does not resend the item in a loop', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    try {
      const result = await make().syncNow();
      expect(server.names().filter(n => n === 'periods.create')).toHaveLength(1);
      expect(result).toMatchObject({ synced: 1, stoppedBy: 'error', pending: 1, storageError: true });
    } finally { setItem.mockRestore(); }
    expect(await make().syncNow()).toMatchObject({ synced: 1, pending: 0 });
    expect(server.periods).toHaveLength(1);
  });

  test('a backoff that cannot be stored reports storageError and stops with error', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    server.failNext('periods.create', apiErr(503));
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    try {
      expect(await make().syncNow()).toMatchObject({ synced: 0, stoppedBy: 'error', pending: 1, storageError: true });
    } finally { setItem.mockRestore(); }
  });

  test('an invalid item (no date) is dropped and reported', async () => {
    await outbox.enqueue(E, { kind: 'log.delete' });
    await outbox.enqueue(E, pcreate('c1'));
    const result = await make().syncNow();
    expect(result.dropped).toEqual([{ kind: 'log.delete', reason: 'invalid' }]);
    expect(result).toMatchObject({ synced: 1, pending: 0 });
  });

  test('queue loss is reported once as queueLost', async () => {
    const hash = await store.emailHash(E);
    localStorage.setItem(`luna_offline_${hash}_outbox`, 'v1.garbage.garbage');
    expect(await make().syncNow()).toMatchObject({ queueLost: true, pending: 0 });
    localStorage.removeItem(`luna_offline_${hash}_outbox`);
    expect(await make().syncNow()).toMatchObject({ queueLost: false });
  });

  test('a change enqueued while its day is being sent is not lost', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, note: 'B' };
    await outbox.enqueue(E, lpatch(D, { mood: 4 }));
    const realList = server.api.logs.list;
    let once = true;
    const api = { ...server.api, logs: { ...server.api.logs, list: async (...a) => {
      if (once) { once = false; await outbox.enqueue(E, lpatch(D, { flow: 'heavy' })); }
      return realList(...a);
    } } };
    expect(await make({ api }).syncNow()).toMatchObject({ synced: 2, pending: 0 });
    expect(server.logs[D]).toMatchObject({ note: 'B', mood: 4, flow: 'heavy' });
  });
});

describe('sign-out during a run', () => {
  test('clearAll mid-request stops quietly and recreates nothing', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2'));
    const onChange = jest.fn();
    const realCreate = server.api.periods.create;
    const api = { ...server.api, periods: { ...server.api.periods, create: async (...a) => {
      const res = await realCreate(...a);
      await store.clearAll();
      return res;
    } } };
    const result = await make({ api, onChange }).syncNow();
    expect(result).toMatchObject({ synced: 0, stoppedBy: 'signed-out', pending: 0 });
    await store.__flush();
    expect(Object.keys(localStorage).filter(k => k.startsWith('luna_offline_'))).toEqual([]);
    expect(server.names()).toEqual(['periods.create']);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('clearAll between the dequeue and the snapshot refresh writes no snapshot', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const realList = server.api.periods.list;
    const api = { ...server.api, periods: { ...server.api.periods, list: async (...a) => {
      const res = await realList(...a);
      await store.clearAll();
      return res;
    } } };
    const result = await make({ api }).syncNow();
    expect(result.stoppedBy).toBe('signed-out');
    await store.__flush();
    expect(Object.keys(localStorage).filter(k => k.startsWith('luna_offline_'))).toEqual([]);
  });

  test('a stopped engine (reset on sign-out) does not run again', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const sync = make();
    sync.reset();
    expect(await sync.syncNow()).toMatchObject({ synced: 0, stoppedBy: 'signed-out' });
    expect(server.calls).toEqual([]);
  });
});

describe('single flight, token and triggers', () => {
  test('two simultaneous syncNow calls make one pass of requests', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const sync = make();
    const a = sync.syncNow();
    const b = sync.syncNow();
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(server.names()).toEqual(['periods.create', 'periods.list']);
    // a second engine for the same user joins the same run
    await outbox.enqueue(E, pcreate('c2'));
    const c = sync.syncNow();
    const d = make().syncNow();
    expect(d).toBe(c);
    await Promise.all([c, d]);
    expect(server.names().filter(n => n === 'periods.create')).toHaveLength(2);
  });

  test('a new run can start after the previous one finished', async () => {
    const sync = make();
    const a = sync.syncNow();
    await a;
    const b = sync.syncNow();
    expect(b).not.toBe(a);
    await b;
  });

  test('getToken is read for each request, so a refreshed token is used mid-run', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, lpatch(D, { mood: 1 }));
    let n = 0;
    await make({ getToken: () => { n += 1; return `t${n}`; } }).syncNow();
    expect(server.calls.map(c => c.token)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('an async getToken is awaited', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await make({ getToken: async () => 'async-tok' }).syncNow();
    expect(server.calls[0].token).toBe('async-tok');
  });

  test('start/stop add and remove the online and visibilitychange listeners', async () => {
    const winAdd = jest.spyOn(window, 'addEventListener');
    const winRemove = jest.spyOn(window, 'removeEventListener');
    const docAdd = jest.spyOn(document, 'addEventListener');
    const docRemove = jest.spyOn(document, 'removeEventListener');
    const onChange = jest.fn();
    const sync = make({ onChange });
    sync.start();
    sync.start(); // idempotent
    expect(winAdd.mock.calls.filter(c => c[0] === 'online')).toHaveLength(1);
    expect(docAdd.mock.calls.filter(c => c[0] === 'visibilitychange')).toHaveLength(1);

    await outbox.enqueue(E, pcreate('c1'));
    window.dispatchEvent(new Event('online'));
    await waitUntil(() => onChange.mock.calls.length === 1);
    expect(server.names()[0]).toBe('periods.create');
    expect(await items()).toEqual([]);

    await outbox.enqueue(E, pcreate('c2'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitUntil(() => onChange.mock.calls.length === 2);
    expect(await items()).toEqual([]);

    sync.stop();
    const onlineHandler = winAdd.mock.calls.find(c => c[0] === 'online')[1];
    expect(winRemove).toHaveBeenCalledWith('online', onlineHandler);
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', docAdd.mock.calls.find(c => c[0] === 'visibilitychange')[1]);
    server.calls.length = 0;
    await outbox.enqueue(E, pcreate('c3'));
    window.dispatchEvent(new Event('online'));
    for (let i = 0; i < 20; i += 1) await tick();
    expect(server.calls).toEqual([]);
    [winAdd, winRemove, docAdd, docRemove].forEach(s => s.mockRestore());
  });

  test('visibilitychange to hidden does not sync', async () => {
    const sync = make();
    sync.start();
    await outbox.enqueue(E, pcreate('c1'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      for (let i = 0; i < 20; i += 1) await tick();
      expect(server.calls).toEqual([]);
    } finally {
      delete document.visibilityState;
      sync.stop();
    }
  });

  test('the 60 s timer syncs only while the queue is non-empty, and stops with stop()', async () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    const sync = make({ onChange });
    sync.start();

    jest.advanceTimersByTime(60 * SEC);
    for (let i = 0; i < 50; i += 1) await tick();
    expect(onChange).not.toHaveBeenCalled(); // empty queue: no run at all

    await outbox.enqueue(E, pcreate('c1'));
    jest.advanceTimersByTime(59 * SEC);
    for (let i = 0; i < 50; i += 1) await tick();
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(SEC);
    await waitUntil(() => onChange.mock.calls.length === 1);
    expect(await items()).toEqual([]);
    expect(server.names()).toEqual(['periods.create', 'periods.list']);

    sync.stop();
    await outbox.enqueue(E, pcreate('c2'));
    jest.advanceTimersByTime(120 * SEC);
    for (let i = 0; i < 50; i += 1) await tick();
    expect(await items()).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('reconnect', () => {
  test('an online event while the head item is backing off (network) syncs it immediately', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    await outbox.enqueue(E, pcreate('c2'));
    server.failNext('periods.create', apiErr(0));
    const onChange = jest.fn();
    const sync = make({ onChange });
    await sync.syncNow();
    expect((await items())[0].nextTryAt).toBe(clock + 5 * SEC);
    onChange.mockClear();
    sync.start();
    try {
      window.dispatchEvent(new Event('online'));
      await waitUntil(() => onChange.mock.calls.length === 1);
      expect(onChange.mock.calls[0][0]).toMatchObject({ synced: 2, pending: 0 });
    } finally { sync.stop(); }
  });

  test('syncNow({ force: true }) also ignores a network backoff but keeps attempts', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    server.failNext('periods.create', apiErr(0));
    server.failNext('periods.create', apiErr(0));
    const sync = make();
    await sync.syncNow();
    expect(await sync.syncNow()).toMatchObject({ synced: 0, pending: 1 }); // still waiting: no request
    expect(server.names()).toEqual(['periods.create']);
    await sync.syncNow({ force: true });
    expect((await items())[0]).toMatchObject({ attempts: 2, nextTryAt: clock + 10 * SEC });
    expect(await sync.syncNow({ force: true })).toMatchObject({ synced: 1, pending: 0 });
  });

  test('force does not skip a server (5xx) backoff', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    server.failNext('periods.create', apiErr(500));
    const sync = make();
    await sync.syncNow();
    expect(await sync.syncNow({ force: true })).toMatchObject({ synced: 0, pending: 1 });
    expect(server.names()).toEqual(['periods.create']);
  });

  test('a network failure while the device reports offline does not climb the backoff', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      for (let i = 0; i < 3; i += 1) {
        server.failNext('periods.create', apiErr(0));
        await make().syncNow();
        const [head] = await items();
        expect(head).toMatchObject({ attempts: 0, nextTryAt: clock + 5 * SEC });
        clock = head.nextTryAt;
      }
    } finally { onLine.mockRestore(); }
  });
});

describe('engines, flights and sign-out', () => {
  test('reset() of one engine does not drop the lock held by another engine mid-request', async () => {
    server.logs[D] = { ...EMPTY_ENTRY, date: D, note: 'B' };
    await outbox.enqueue(E, lpatch(D, { mood: 4 }));
    const gate = deferred();
    const realPut = server.api.logs.put;
    let first = true;
    const api = { ...server.api, logs: { ...server.api.logs, put: async (...a) => {
      if (first) { first = false; await gate.promise; }
      return realPut(...a);
    } } };
    const runner = make({ api });
    const other = make();
    const running = runner.syncNow();
    await waitUntil(() => !first);
    other.reset();
    await outbox.enqueue(E, lpatch(D, { flow: 'heavy' }));
    expect(await items()).toHaveLength(2); // not coalesced into the in-flight item
    gate.resolve();
    expect(await running).toMatchObject({ synced: 2, pending: 0 });
    expect(server.logs[D]).toMatchObject({ note: 'B', mood: 4, flow: 'heavy' });
  });

  test('a syncNow during a pass (after its last claim) gets a follow-up pass, not the timer', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    let sync;
    let joined;
    const realList = server.api.periods.list;
    let once = true;
    const api = { ...server.api, periods: { ...server.api.periods, list: async (...a) => {
      if (once) {
        once = false;
        await outbox.enqueue(E, pcreate('c2', '2026-02-01'));
        joined = sync.syncNow();
      }
      return realList(...a);
    } } };
    sync = make({ api });
    const result = await sync.syncNow();
    expect(await joined).toBe(result);
    expect(result).toMatchObject({ synced: 2, pending: 0, stoppedBy: null });
    expect(server.periods.map(p => p.id)).toEqual(['c1', 'c2']);
  });

  test('every engine that triggered or joined a run gets its own onChange once', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const a = jest.fn();
    const b = jest.fn();
    const ea = make({ onChange: a });
    const eb = make({ onChange: b });
    const p = ea.syncNow();
    eb.syncNow();
    eb.syncNow();
    const result = await p;
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(result);
  });

  test('after sign-out a new engine never joins the stale flight', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const gate = deferred();
    const realCreate = server.api.periods.create;
    let started = false;
    const api = { ...server.api, periods: { ...server.api.periods, create: async (...a) => {
      started = true;
      await gate.promise;
      return realCreate(...a);
    } } };
    const old = make({ api }).syncNow();
    await waitUntil(() => started);
    await store.clearAll();
    onSignOut();
    await outbox.enqueue(E, pcreate('c9'));
    const fresh = make().syncNow();
    expect(fresh).not.toBe(old);
    gate.resolve();
    expect(await old).toMatchObject({ stoppedBy: 'signed-out' });
    expect(await fresh).toMatchObject({ synced: 1, stoppedBy: null, pending: 0 });
    expect(server.periods.map(p => p.id).sort()).toEqual(['c1', 'c9']);
  });

  test('onSignOut clears outbox memory only when a clearAll happened', async () => {
    const reset = jest.spyOn(outbox, 'resetMemory');
    try {
      onSignOut();
      expect(reset).not.toHaveBeenCalled();
      await store.clearAll();
      onSignOut();
      expect(reset).toHaveBeenCalledTimes(1);
      onSignOut();
      expect(reset).toHaveBeenCalledTimes(1);
    } finally { reset.mockRestore(); }
  });

  test('reset() does not clear the outbox memory of other engines', async () => {
    const reset = jest.spyOn(outbox, 'resetMemory');
    try {
      make().reset();
      expect(reset).not.toHaveBeenCalled();
    } finally { reset.mockRestore(); }
  });

  test('sign-out during an async getToken sends nothing', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const getToken = async () => { await store.clearAll(); return 'tok'; };
    expect(await make({ getToken }).syncNow()).toMatchObject({ stoppedBy: 'signed-out', synced: 0 });
    expect(server.calls).toEqual([]);
  });

  test('sign-out between claimNext and the first request sends nothing', async () => {
    await outbox.enqueue(E, pcreate('c1'));
    const realClaim = outbox.claimNext;
    const claim = jest.spyOn(outbox, 'claimNext').mockImplementation(async (...a) => {
      const item = await realClaim(...a);
      store.clearAll();
      return item;
    });
    const getToken = jest.fn(() => 'tok');
    try {
      expect(await make({ getToken }).syncNow()).toMatchObject({ stoppedBy: 'signed-out' });
    } finally { claim.mockRestore(); }
    expect(getToken).not.toHaveBeenCalled();
    expect(server.calls).toEqual([]);
  });
});
