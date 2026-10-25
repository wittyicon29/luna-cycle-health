const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const { makeServer, EMPTY_ENTRY, apiErr } = require('./testing/fakeServer');
const store = require('./store');
const outbox = require('./outbox');
const snapshot = require('./snapshot');
const { resetSyncState } = require('./sync');
const { createOffline } = require('./index');

const E = 'a@x.com';
const B = 'b@x.com';
const D1 = '2026-03-01';
const D2 = '2026-03-02';
const D3 = '2026-03-03';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const offlineKeys = () => Object.keys(localStorage).filter(k => k.startsWith('luna_offline_'));

let server;
const make = (opts = {}) => createOffline({ email: E, getToken: () => 'tok', api: server.api, ...opts });
const items = (email = E) => outbox.loadOutbox(email);
const entry = (date, fields) => ({ ...EMPTY_ENTRY, ...fields, date, updated_at: '2026-03-03T00:00:00Z' });
const noPending = list => list.every(x => !('pending' in x));

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
});

afterEach(() => { jest.restoreAllMocks(); });

describe('online happy path', () => {
  test('reads make exactly the original request, cache the slice and return the server result', async () => {
    server.periods = [{ id: 'p1', start_date: '2026-02-01', end_date: null }];
    server.logs = { [D1]: entry(D1, { mood: 3 }) };
    server.medications = [{ id: 'm1', name: 'Iron', archived: false }];
    server.consents = { ai_processing: true };
    server.authStatus = { has_completed_questionnaire: true };
    const { data } = make();

    expect(await data.listPeriods('tok')).toEqual(server.periods);
    expect(await data.listLogs(D1, D3, 'tok')).toEqual([server.logs[D1]]);
    expect(await data.listMedications('tok', true)).toEqual(server.medications);
    expect(await data.getConsents('tok')).toEqual({ ai_processing: true });
    expect(await data.getAuthStatus('tok')).toEqual({ has_completed_questionnaire: true });
    expect(server.names()).toEqual(['periods.list', 'logs.list', 'medications.list', 'consents.get', 'auth.status']);
    expect(server.calls[1].args).toEqual([D1, D3]);
    expect(server.calls[2].args).toEqual([true]);

    const snap = await snapshot.loadSnapshot(E);
    expect(snap.periods).toEqual(server.periods);
    expect(snap.logs).toEqual({ [D1]: server.logs[D1] });
    expect(snap.medications).toEqual(server.medications);
    expect(snap.consents).toEqual({ ai_processing: true });
    expect(snap.authStatus).toEqual({ has_completed_questionnaire: true });
  });

  test('writes make exactly the original requests; createPeriod sends a client uuid', async () => {
    const { data, sync } = make();
    const p = await data.createPeriod({ start_date: '2026-02-01' }, 'tok');
    expect(p.id).toMatch(UUID);
    expect(server.calls[0].args[0]).toEqual({ start_date: '2026-02-01', id: p.id });
    expect(p).toEqual({ start_date: '2026-02-01', id: p.id, end_date: null });

    expect(await data.saveLog(D1, { mood: 2, note: 'n' }, 'tok')).toMatchObject({ date: D1, mood: 2, note: 'n' });
    expect(await data.saveLog(D2, {}, 'tok')).toEqual({ date: D2, deleted: true });
    expect(await data.removeLog(D2, 'tok')).toEqual({ deleted: true });
    await sync.whenIdle();
    expect(server.names()).toEqual(['periods.create', 'logs.put', 'logs.put', 'logs.remove']);
    expect(await items()).toEqual([]);
  });

  test('patchLog online: fresh list, merge, PUT; clearing the last field deletes the day', async () => {
    server.logs = { [D1]: entry(D1, { note: 'kept', mood: 2 }) };
    const { data } = make();
    expect(await data.patchLog(D1, { set: { mood: 4 } }, 'tok')).toMatchObject({ date: D1, note: 'kept', mood: 4 });
    expect(server.names()).toEqual(['logs.list', 'logs.put']);
    expect(server.calls[1].args).toEqual([D1, { note: 'kept', mood: 4 }]);

    server.calls = [];
    server.logs = { [D2]: entry(D2, { mood: 2 }) };
    expect(await data.patchLog(D2, { clear: ['mood'] }, 'tok')).toEqual({ date: D2, deleted: true });
    expect(server.names()).toEqual(['logs.list', 'logs.remove']);
    expect(server.logs[D2]).toBeUndefined();
    expect((await snapshot.loadSnapshot(E)).logs[D2]).toBeUndefined();
  });

  test('a pending change still shows over an online read', async () => {
    server.logs = { [D1]: entry(D1, { mood: 1 }) };
    server.periods = [{ id: 'p1', start_date: '2026-01-01', end_date: null }];
    await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-02-01' } });
    await outbox.enqueue(E, { kind: 'log.patch', date: D1, set: { note: 'queued' }, clear: [] });
    const { data } = make();
    const periods = await data.listPeriods('tok');
    expect(periods.map(p => [p.id, !!p.pending])).toEqual([['c1', true], ['p1', false]]);
    expect(await data.listLogs(D1, D1, 'tok')).toEqual([{ date: D1, mood: 1, note: 'queued', pending: true }]);
    expect(server.names()).toEqual(['periods.list', 'logs.list']);
    // the cached slice holds only server data
    expect((await snapshot.loadSnapshot(E)).logs[D1]).toEqual(server.logs[D1]);
  });

  test('listMedications active-only keeps archived cache entries; offline filters by includeArchived', async () => {
    server.medications = [{ id: 'm1', name: 'Iron', archived: false }, { id: 'm2', name: 'Old', archived: true }];
    const { data } = make();
    await data.listMedications('tok', true);
    server.medications = [{ id: 'm1', name: 'Iron 2', archived: false }, { id: 'm2', name: 'Old', archived: true }];
    expect(await data.listMedications('tok')).toEqual([{ id: 'm1', name: 'Iron 2', archived: false }]);
    expect((await snapshot.loadSnapshot(E)).medications).toEqual([
      { id: 'm1', name: 'Iron 2', archived: false }, { id: 'm2', name: 'Old', archived: true }]);
    server.setOffline(true);
    expect(await data.listMedications('tok')).toEqual([{ id: 'm1', name: 'Iron 2', archived: false }]);
    expect(await data.listMedications('tok', true)).toHaveLength(2);
  });
});

describe('offline reads', () => {
  test('serve snapshot + overlay, logs filtered to the requested range', async () => {
    server.logs = { [D1]: entry(D1, { mood: 1 }), [D2]: entry(D2, { mood: 2 }), [D3]: entry(D3, { mood: 3 }) };
    server.periods = [{ id: 'p1', start_date: '2026-01-01', end_date: null }];
    const { data, status } = make();
    await data.listLogs(D1, D3, 'tok');
    await data.listPeriods('tok');
    server.setOffline(true);

    expect(await data.listLogs(D2, D2, 'tok')).toEqual([server.logs[D2]]);
    expect(status.getState().online).toBe(false);
    await data.patchLog(D3, { set: { note: 'x' } }, 'tok');
    const rows = await data.listLogs(D1, D3, 'tok');
    expect(rows.map(r => r.date)).toEqual([D1, D2, D3]);
    expect(rows[2]).toEqual({ date: D3, mood: 3, note: 'x', pending: true });
    expect(await data.listLogs(D1, D2, 'tok')).toEqual([server.logs[D1], server.logs[D2]]);
    expect(await data.listPeriods('tok')).toEqual(server.periods);
  });

  test('no snapshot at all: the network error is re-thrown', async () => {
    server.setOffline(true);
    const { data } = make();
    await expect(data.listPeriods('tok')).rejects.toMatchObject({ status: 0 });
    await expect(data.listLogs(D1, D2, 'tok')).rejects.toMatchObject({ status: 0 });
    await expect(data.listMedications('tok')).rejects.toMatchObject({ status: 0 });
  });

  test('non-network errors propagate unchanged even with a snapshot', async () => {
    server.periods = [{ id: 'p1', start_date: '2026-01-01' }];
    const { data } = make();
    await data.listPeriods('tok');
    const err = apiErr(500);
    server.failNext('periods.list', err);
    await expect(data.listPeriods('tok')).rejects.toBe(err);
  });

  test('consents and auth status: cached value reused offline, never fabricated', async () => {
    server.setOffline(true);
    const { data } = make();
    await expect(data.getConsents('tok')).rejects.toMatchObject({ status: 0 });
    await expect(data.getAuthStatus('tok')).rejects.toMatchObject({ status: 0 });
    expect(await snapshot.loadSnapshot(E)).toMatchObject({ consents: null, authStatus: null });

    server.setOffline(false);
    server.consents = { ai_processing: false };
    server.authStatus = { has_completed_questionnaire: false };
    await data.getConsents('tok');
    await data.getAuthStatus('tok');
    server.setOffline(true);
    expect(await data.getConsents('tok')).toEqual({ ai_processing: false });
    expect(await data.getAuthStatus('tok')).toEqual({ has_completed_questionnaire: false });
    const err = apiErr(403);
    server.setOffline(false);
    server.failNext('consents.get', err);
    await expect(data.getConsents('tok')).rejects.toBe(err);
  });
});

describe('offline writes', () => {
  test('createPeriod returns a pending period and queues one period.create with the same client id', async () => {
    server.setOffline(true);
    const { data, sync, status } = make();
    const p = await data.createPeriod({ start_date: '2026-02-01' }, 'tok');
    expect(p).toMatchObject({ start_date: '2026-02-01', pending: true });
    expect(p.id).toMatch(UUID);
    await sync.whenIdle();
    const queued = await items();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: 'period.create', clientId: p.id, payload: { start_date: '2026-02-01' } });
    expect(status.getState().pendingCount).toBe(1);
    expect(await data.pendingSummary()).toEqual({ count: 1 });
  });

  test('patchLog then listLogs shows the patched day pending; saveLog / removeLog queue replace / delete', async () => {
    server.logs = { [D1]: entry(D1, { note: 'n', flow: 'light' }) };
    const { data, sync } = make();
    await data.listLogs(D1, D3, 'tok');
    server.setOffline(true);
    expect(await data.patchLog(D1, { set: { mood: 4 } }, 'tok')).toEqual({ date: D1, note: 'n', flow: 'light', mood: 4, pending: true });
    expect(await data.listLogs(D1, D1, 'tok')).toEqual([{ date: D1, note: 'n', flow: 'light', mood: 4, pending: true }]);
    await sync.whenIdle();
    expect(await data.saveLog(D2, { mood: 5, date: D2, updated_at: 'x' }, 'tok')).toEqual({ date: D2, mood: 5, pending: true });
    await sync.whenIdle();
    expect(await data.saveLog(D1, { mood: null, symptoms: [] }, 'tok')).toEqual({ date: D1, deleted: true });
    await sync.whenIdle();
    expect(await data.removeLog(D2, 'tok')).toEqual({ deleted: true });
    await sync.whenIdle();
    expect((await items()).map(i => [i.kind, i.date])).toEqual([['log.delete', D1], ['log.delete', D2]]);
    expect(await data.listLogs(D1, D3, 'tok')).toEqual([]);
  });

  test('a write is queued, not sent, while the queue is non-empty; the sync then sends both in order', async () => {
    await outbox.enqueue(E, { kind: 'log.patch', date: D1, set: { mood: 2 }, clear: [] });
    const { data, sync } = make();
    const p = await data.createPeriod({ start_date: '2026-02-01' }, 'tok');
    expect(p.pending).toBe(true);
    await sync.whenIdle();
    expect(server.names()).toEqual(['logs.list', 'logs.put', 'periods.create', 'periods.list']);
    expect(server.calls[2].args[0].id).toBe(p.id);
    expect(await items()).toEqual([]);
  });

  test('a non-network 4xx on a write propagates and queues nothing', async () => {
    const { data, sync } = make();
    const e1 = apiErr(422);
    server.failNext('periods.create', e1);
    await expect(data.createPeriod({ start_date: '2026-02-01' }, 'tok')).rejects.toBe(e1);
    const e2 = apiErr(422);
    server.failNext('logs.put', e2);
    await expect(data.saveLog(D1, { mood: 2 }, 'tok')).rejects.toBe(e2);
    const e3 = apiErr(400);
    server.failNext('logs.put', e3);
    await expect(data.patchLog(D1, { set: { mood: 2 } }, 'tok')).rejects.toBe(e3);
    await sync.whenIdle();
    expect(await items()).toEqual([]);
    expect(server.names()).toEqual(['periods.create', 'logs.put', 'logs.list', 'logs.put']);
  });

  test('network failure after the list (PUT lost) queues the patch; replay is idempotent', async () => {
    server.logs = { [D1]: entry(D1, { note: 'n' }) };
    const { data, sync } = make();
    server.failNext('logs.put', apiErr(0), { after: true });
    expect(await data.patchLog(D1, { set: { mood: 3 } }, 'tok')).toMatchObject({ mood: 3, pending: true });
    await sync.whenIdle();
    await sync.syncNow({ force: true });
    expect(await items()).toEqual([]);
    expect(server.logs[D1]).toMatchObject({ note: 'n', mood: 3 });
  });

  test('storage failure still returns the optimistic result and sets lastError', async () => {
    server.setOffline(true);
    const { data, status, sync } = make();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const p = await data.createPeriod({ start_date: '2026-02-01' }, 'tok');
    expect(p).toMatchObject({ start_date: '2026-02-01', pending: true });
    expect(await data.patchLog(D1, { set: { mood: 2 } }, 'tok')).toEqual({ date: D1, mood: 2, pending: true });
    expect(status.getState().lastError).toBeInstanceOf(Error);
    await sync.whenIdle();
  });
});

test('end-to-end: offline createPeriod + patchLog + saveLog, back online, syncNow merges into the server', async () => {
  server.logs = { [D1]: entry(D1, { note: 'old', flow: 'light' }) };
  const { data, sync, status } = make();
  await data.listLogs(D1, D3, 'tok');
  await data.listPeriods('tok');
  server.setOffline(true);

  const p = await data.createPeriod({ start_date: '2026-02-01' }, 'tok');
  await data.patchLog(D1, { set: { mood: 4 } }, 'tok');
  await data.saveLog(D2, { mood: 1, symptoms: ['cramps'] }, 'tok');
  await sync.whenIdle();
  expect(status.getState().pendingCount).toBe(3);

  server.setOffline(false);
  const r = await sync.syncNow({ force: true });
  expect(r).toMatchObject({ synced: 3, stoppedBy: null, pending: 0 });
  expect(server.periods).toEqual([{ start_date: '2026-02-01', id: p.id, end_date: null }]);
  expect(server.logs[D1]).toMatchObject({ note: 'old', flow: 'light', mood: 4 });
  expect(server.logs[D2]).toMatchObject({ mood: 1, symptoms: ['cramps'] });
  expect(status.getState()).toMatchObject({ pendingCount: 0, online: true });

  const periods = await data.listPeriods('tok');
  expect(periods).toEqual([{ start_date: '2026-02-01', id: p.id, end_date: null }]);
  expect(noPending(periods)).toBe(true);
  expect(noPending(await data.listLogs(D1, D3, 'tok'))).toBe(true);
  server.setOffline(true);
  expect(await data.listPeriods('tok')).toEqual([{ start_date: '2026-02-01', id: p.id, end_date: null }]);
});

test('check-in data safety: an offline patch keeps a note changed on the server in between', async () => {
  server.logs = { [D1]: entry(D1, { note: 'from phone A', flow: 'light', mood: 2 }) };
  const { data, sync } = make();
  await data.listLogs(D1, D1, 'tok');
  server.setOffline(true);
  await data.patchLog(D1, { set: { mood: 5 } }, 'tok');
  await sync.whenIdle();
  server.logs[D1] = entry(D1, { note: 'from phone B', flow: 'light', mood: 2 });
  server.setOffline(false);
  await sync.syncNow({ force: true });
  expect(server.logs[D1]).toMatchObject({ note: 'from phone B', flow: 'light', mood: 5 });
  const put = server.calls.filter(c => c.name === 'logs.put').pop();
  expect(put.args).toEqual([D1, { note: 'from phone B', flow: 'light', mood: 5 }]);
});

const lossRises = fn => {
  let prev = false; let n = 0;
  fn.mock.calls.forEach(([st]) => { if (st.queueLost && !prev) n += 1; prev = st.queueLost; });
  return n;
};

test('a lost queue is surfaced once: enqueue and sync reporting the same loss notify once; acknowledge clears', async () => {
  await outbox.enqueue(E, { kind: 'log.patch', date: D1, set: { mood: 1 }, clear: [] });
  localStorage.setItem(offlineKeys().find(k => k.endsWith('_outbox')), 'garbage');
  server.setOffline(true);
  const { data, sync, status } = make();
  const fn = jest.fn();
  status.subscribe(fn);
  await data.patchLog(D2, { set: { mood: 3 } }, 'tok');
  await sync.whenIdle();
  expect(status.getState().queueLost).toBe(true);
  server.setOffline(false);
  await sync.syncNow({ force: true });
  expect(status.getState().queueLost).toBe(true);
  expect(lossRises(fn)).toBe(1);

  status.acknowledge();
  expect(status.getState()).toMatchObject({ queueLost: false, dropped: [] });
  await sync.syncNow({ force: true });
  await data.patchLog(D3, { set: { mood: 2 } }, 'tok');
  await sync.whenIdle();
  expect(status.getState().queueLost).toBe(false);
  expect(lossRises(fn)).toBe(1);
});

test('a loss that sync keeps re-detecting (blob still unreadable) is surfaced once', async () => {
  await outbox.enqueue(E, { kind: 'log.patch', date: D1, set: { mood: 1 }, clear: [] });
  localStorage.setItem(offlineKeys().find(k => k.endsWith('_outbox')), 'garbage');
  const { sync, status } = make();
  const fn = jest.fn();
  status.subscribe(fn);
  await sync.syncNow();
  expect(status.getState().queueLost).toBe(true);
  await sync.syncNow();
  status.acknowledge();
  await sync.whenIdle();
  await sync.syncNow();
  await sync.syncNow();
  expect(status.getState().queueLost).toBe(false);
  expect(lossRises(fn)).toBe(1);
});

test('a dropped (rejected) change is reported in status.dropped', async () => {
  await outbox.enqueue(E, { kind: 'log.patch', date: D1, set: { mood: 1 }, clear: [] });
  server.failNext('logs.list', apiErr(422));
  const { sync, status } = make();
  await sync.syncNow();
  expect(status.getState().dropped).toEqual([{ kind: 'log.patch', date: D1, reason: 'rejected', status: 422 }]);
  status.acknowledge();
  expect(status.getState().dropped).toEqual([]);
});

test('web: every method passes straight to API and touches no storage', async () => {
  require('../platform').isNative.mockReturnValue(false);
  const get = jest.spyOn(Storage.prototype, 'getItem');
  const set = jest.spyOn(Storage.prototype, 'setItem');
  server.logs = { [D1]: entry(D1, { note: 'n' }) };
  const { data, sync, status } = make();
  await data.listPeriods('tok');
  await data.listLogs(D1, D2, 'tok');
  await data.listMedications('tok', true);
  await data.getConsents('tok');
  await data.getAuthStatus('tok');
  const p = await data.createPeriod({ start_date: '2026-02-01' }, 'tok');
  await data.saveLog(D2, { mood: 2 }, 'tok');
  await data.patchLog(D1, { set: { mood: 4 } }, 'tok');
  await data.removeLog(D2, 'tok');
  await sync.syncNow();
  expect(server.names()).toEqual(['periods.list', 'logs.list', 'medications.list', 'consents.get', 'auth.status',
    'periods.create', 'logs.put', 'logs.list', 'logs.put', 'logs.remove']);
  expect(server.calls[5].args[0]).toEqual({ start_date: '2026-02-01' });
  expect(p.id).toBe('srv-1');
  expect(server.calls[8].args).toEqual([D1, { note: 'n', mood: 4 }]);
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  expect(status.getState()).toMatchObject({ online: true, pendingCount: 0 });
  expect(await data.pendingSummary()).toEqual({ count: 0 });

  server.setOffline(true);
  await expect(data.listPeriods('tok')).rejects.toMatchObject({ status: 0 });
});

describe('wipe', () => {
  test('leaves nothing readable, resets status, and another email sees nothing', async () => {
    server.periods = [{ id: 'p1', start_date: '2026-01-01' }];
    server.consents = { ai_processing: true };
    const a = make();
    await a.data.listPeriods('tok');
    await a.data.getConsents('tok');
    server.setOffline(true);
    await a.data.createPeriod({ start_date: '2026-02-01' }, 'tok');
    await a.sync.whenIdle();
    expect(offlineKeys().length).toBeGreaterThan(0);

    await a.data.wipe();
    expect(offlineKeys()).toEqual([]);
    expect(mockData.size).toBe(0);
    expect(a.status.getState()).toMatchObject({ pendingCount: 0, lastError: null, queueLost: false, dropped: [] });

    const b = createOffline({ email: B, getToken: () => 'tok', api: server.api });
    await expect(b.data.listPeriods('tok')).rejects.toMatchObject({ status: 0 });
    await expect(b.data.getConsents('tok')).rejects.toMatchObject({ status: 0 });
    expect(await b.data.pendingSummary()).toEqual({ count: 0 });
    expect(await items(E)).toEqual([]);
  });

  test('reads and writes after (or racing) a wipe do not recreate data', async () => {
    server.periods = [{ id: 'p1', start_date: '2026-01-01' }];
    const a = make();
    let release;
    const gate = new Promise(r => { release = r; });
    const realList = server.api.periods.list;
    server.api.periods.list = async t => { await gate; return realList(t); };
    const inFlight = a.data.listPeriods('tok');
    await a.data.wipe();
    release();
    await inFlight;
    server.api.periods.list = realList;

    await a.data.listPeriods('tok');
    await a.data.getConsents('tok');
    await a.data.createPeriod({ start_date: '2026-02-01' }, 'tok');
    server.setOffline(true);
    await expect(a.data.saveLog(D1, { mood: 2 }, 'tok')).rejects.toMatchObject({ status: 0 });
    await store.__flush();
    expect(offlineKeys()).toEqual([]);
  });
});

test('startSync / stopSync add and remove the engine listeners; createOffline does not start it', () => {
  const add = jest.spyOn(window, 'addEventListener');
  const remove = jest.spyOn(window, 'removeEventListener');
  const off = make();
  expect(add.mock.calls.filter(([n]) => n === 'online')).toHaveLength(0);
  off.startSync();
  expect(add.mock.calls.filter(([n]) => n === 'online').length).toBeGreaterThan(0);
  off.stopSync();
  expect(remove.mock.calls.filter(([n]) => n === 'online').length).toBeGreaterThan(0);
});
