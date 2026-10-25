const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const store = require('./store');

const outbox = require('./outbox');

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  localStorage.clear();
  mockData.clear();
  await store.__resetForTests();
});

const E = 'a@x.com';
const patch = (date, set = {}, clear = []) => ({ kind: 'log.patch', date, set, clear });
const D = '2026-03-01';

test('ordering by seq survives reload; seq is monotonic', async () => {
  await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01' } });
  await outbox.enqueue(E, patch(D, { mood: 1 }));
  await outbox.enqueue(E, { kind: 'period.create', clientId: 'c2', payload: { start_date: '2026-02-01' } });
  const items = await outbox.loadOutbox(E);
  expect(items.map(i => i.seq)).toEqual([1, 2, 3]);
  expect(items[0]).toMatchObject({ attempts: 0, nextTryAt: 0 });
});

test('seq keeps growing after items are removed (also across reload)', async () => {
  const a = await outbox.enqueue(E, patch(D, { mood: 1 }));
  await outbox.remove(E, a.item.id);
  expect(await outbox.loadOutbox(E)).toEqual([]);
  const b = await outbox.enqueue(E, patch(D, { mood: 2 }));
  expect(b.item.seq).toBe(2);
  expect(b.item.id).not.toBe(a.item.id);
});

test('two enqueues in a row (not awaited) lose nothing', async () => {
  await Promise.all([
    outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01' } }),
    outbox.enqueue(E, { kind: 'period.create', clientId: 'c2', payload: { start_date: '2026-02-01' } }),
    outbox.enqueue(E, patch(D, { mood: 1 })),
  ]);
  expect((await outbox.loadOutbox(E)).map(i => i.seq)).toEqual([1, 2, 3]);
});

test('same period clientId is not queued twice', async () => {
  await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01' } });
  await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01' } });
  expect(await outbox.loadOutbox(E)).toHaveLength(1);
});

describe('coalescing', () => {
  test('patches for the same date merge (set->set, set->clear, clear->set)', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1, note: 'a' }));
    await outbox.enqueue(E, patch(D, { mood: 2 }, ['note']));
    await outbox.enqueue(E, patch(D, { note: 'b' }));
    const items = await outbox.loadOutbox(E);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ set: { mood: 2, note: 'b' }, clear: [], seq: 1 });
  });
  test('patches for different dates stay separate', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    await outbox.enqueue(E, patch('2026-03-02', { mood: 1 }));
    expect(await outbox.loadOutbox(E)).toHaveLength(2);
  });
  test('replace removes earlier patch/replace/delete for that date, keeps other dates', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    await outbox.enqueue(E, { kind: 'log.delete', date: D });
    await outbox.enqueue(E, patch('2026-03-02', { mood: 3 }));
    await outbox.enqueue(E, { kind: 'log.replace', date: D, payload: { mood: 4 } });
    await outbox.enqueue(E, { kind: 'log.replace', date: D, payload: { mood: 5 } });
    const items = await outbox.loadOutbox(E);
    expect(items.map(i => [i.kind, i.date])).toEqual([['log.patch', '2026-03-02'], ['log.replace', D]]);
    expect(items[1].payload).toEqual({ mood: 5 });
  });
  test('patch after replace is a separate later item; further patches merge into it, not the replace', async () => {
    await outbox.enqueue(E, { kind: 'log.replace', date: D, payload: { mood: 4 } });
    await outbox.enqueue(E, patch(D, { note: 'x' }));
    await outbox.enqueue(E, patch(D, { note: 'y' }));
    const items = await outbox.loadOutbox(E);
    expect(items.map(i => i.kind)).toEqual(['log.replace', 'log.patch']);
    expect(items[0].payload).toEqual({ mood: 4 });
    expect(items[1].set).toEqual({ note: 'y' });
  });
  test('delete supersedes earlier items for that date and is kept', async () => {
    await outbox.enqueue(E, { kind: 'log.replace', date: D, payload: { mood: 4 } });
    await outbox.enqueue(E, patch(D, { note: 'x' }));
    await outbox.enqueue(E, { kind: 'log.delete', date: D });
    const items = await outbox.loadOutbox(E);
    expect(items.map(i => i.kind)).toEqual(['log.delete']);
  });
  test('patch after delete is a separate item', async () => {
    await outbox.enqueue(E, { kind: 'log.delete', date: D });
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    expect((await outbox.loadOutbox(E)).map(i => i.kind)).toEqual(['log.delete', 'log.patch']);
  });
  test('zeros survive coalescing', async () => {
    await outbox.enqueue(E, patch(D, { sleep_hours: 0 }));
    await outbox.enqueue(E, patch(D, { water_glasses: 0 }));
    expect((await outbox.loadOutbox(E))[0].set).toEqual({ sleep_hours: 0, water_glasses: 0 });
  });
  test('enqueue does not mutate the caller item', async () => {
    const it = patch(D, { symptoms: ['a'] });
    const copy = JSON.parse(JSON.stringify(it));
    await outbox.enqueue(E, it);
    expect(it).toEqual(copy);
  });
});

test('the 500 cap drops the oldest and reports dropped', async () => {
  for (let i = 0; i < 500; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await outbox.enqueue(E, { kind: 'log.delete', date: `d${i}` });
  }
  const res = await outbox.enqueue(E, { kind: 'log.delete', date: 'extra' });
  expect(res.dropped).toHaveLength(1);
  expect(res.dropped[0].date).toBe('d0');
  const items = await outbox.loadOutbox(E);
  expect(items).toHaveLength(500);
  expect(items[0].date).toBe('d1');
  expect(items[499].date).toBe('extra');
}, 60000);

test('markFailed stores nextTryAt and increments attempts', async () => {
  const { item } = await outbox.enqueue(E, patch(D, { mood: 1 }));
  await outbox.markFailed(E, item.id, 5000);
  await outbox.markFailed(E, item.id, 10000);
  expect((await outbox.loadOutbox(E))[0]).toMatchObject({ attempts: 2, nextTryAt: 10000 });
  await outbox.markFailed(E, 'nope', 1); // unknown id is a no-op
});

test('another email cannot see the outbox', async () => {
  await outbox.enqueue(E, patch(D, { mood: 1 }));
  expect(await outbox.loadOutbox('b@x.com')).toEqual([]);
  expect(await outbox.loadOutbox(E)).toHaveLength(1);
});

test('nothing readable is left in localStorage', async () => {
  await outbox.enqueue(E, patch(D, { note: 'SENTINEL-NOTE' }));
  Object.values(localStorage).forEach(v => expect(v).not.toContain('SENTINEL'));
});

test('a corrupt blob gives an empty outbox and the next enqueue works', async () => {
  await outbox.enqueue(E, patch(D, { mood: 1 }));
  const key = Object.keys(localStorage).find(k => k.endsWith('_outbox'));
  localStorage.setItem(key, 'garbage');
  expect(await outbox.loadOutbox(E)).toEqual([]);
  await outbox.enqueue(E, patch(D, { mood: 2 }));
  const items = await outbox.loadOutbox(E);
  expect(items).toHaveLength(1);
  expect(items[0].set).toEqual({ mood: 2 });
});
