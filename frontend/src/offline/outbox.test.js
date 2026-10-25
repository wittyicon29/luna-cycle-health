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
  outbox.__resetForTests();
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
  const detailed = await outbox.loadOutboxDetailed(E);
  expect(detailed).toEqual({ items: [], unreadable: true });
  const res = await outbox.enqueue(E, patch(D, { mood: 2 }));
  expect(res).toMatchObject({ persisted: true, lostPending: true });
  const items = await outbox.loadOutbox(E);
  expect(items).toHaveLength(1);
  expect(items[0].set).toEqual({ mood: 2 });
  expect(outbox.consumeOutboxLoss(E)).toBe(true);
  expect(outbox.consumeOutboxLoss(E)).toBe(false);
  expect((await outbox.enqueue(E, patch(D, { mood: 3 }))).lostPending).toBe(false);
});

test('a healthy or empty outbox reports no loss', async () => {
  expect(await outbox.loadOutboxDetailed(E)).toEqual({ items: [], unreadable: false });
  expect((await outbox.enqueue(E, patch(D, { mood: 1 }))).lostPending).toBe(false);
  expect(outbox.consumeOutboxLoss(E)).toBe(false);
});

test('invalid items are dropped and signalled', async () => {
  await outbox.enqueue(E, patch(D, { mood: 1 }));
  await store.write(E, 'outbox', { nextSeq: 5, items: [{ id: 'ob-x', seq: 1, kind: 'log.delete', date: D }, { id: 3, seq: 2, kind: 'log.delete' }, { id: 'y', seq: 'z', kind: 'log.delete' }, { id: 'w', seq: 4, kind: 'bogus' }] });
  const d = await outbox.loadOutboxDetailed(E);
  expect(d.items.map(i => i.id)).toEqual(['ob-x']);
  expect(d.unreadable).toBe(true);
  expect(outbox.consumeOutboxLoss(E)).toBe(true);
});

test('ids stay unique across a reset', async () => {
  const a = await outbox.enqueue(E, patch(D, { mood: 1 }));
  const key = Object.keys(localStorage).find(k => k.endsWith('_outbox'));
  localStorage.setItem(key, 'garbage');
  await new Promise(r => setTimeout(r, 3));
  const b = await outbox.enqueue(E, patch(D, { mood: 2 }));
  expect(b.item.seq).toBe(a.item.seq);
  expect(b.item.id).not.toBe(a.item.id);
});

test('enqueue reports persisted:false when the write fails', async () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  const res = await outbox.enqueue(E, patch(D, { mood: 1 }));
  spy.mockRestore();
  expect(res.persisted).toBe(false);
  expect(await outbox.loadOutbox(E)).toEqual([]);
});

test('enqueue racing clearAll is not persisted', async () => {
  await outbox.enqueue(E, patch(D, { mood: 1 }));
  const p = outbox.enqueue(E, patch('2026-03-05', { mood: 1 }));
  const cleared = store.clearAll();
  expect((await p).persisted).toBe(false);
  await cleared;
  expect(await outbox.loadOutbox(E)).toEqual([]);
});

test('an empty patch is a no-op; a duplicate period neither bumps seq nor writes', async () => {
  expect(await outbox.enqueue(E, patch(D, {}, []))).toMatchObject({ item: null, dropped: [] });
  expect(await outbox.loadOutbox(E)).toEqual([]);
  await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01' } });
  const spy = jest.spyOn(Storage.prototype, 'setItem');
  const dup = await outbox.enqueue(E, { kind: 'period.create', clientId: 'c1', payload: { start_date: '2026-01-01' } });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  expect(dup.item.clientId).toBe('c1');
  expect((await outbox.enqueue(E, patch(D, { mood: 1 }))).item.seq).toBe(2);
});

describe('in-flight locks', () => {
  test('claimNext locks the lowest seq item and returns a copy', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    await outbox.enqueue(E, patch('2026-03-02', { mood: 1 }));
    const c = await outbox.claimNext(E, 0);
    expect(c.seq).toBe(1);
    c.set.mood = 99;
    expect((await outbox.loadOutbox(E))[0].set.mood).toBe(1);
  });
  test('returns null when empty or when the head is backing off (never skips)', async () => {
    expect(await outbox.claimNext(E, 0)).toBeNull();
    const a = await outbox.enqueue(E, patch(D, { mood: 1 }));
    await outbox.enqueue(E, patch('2026-03-02', { mood: 1 }));
    await outbox.markFailed(E, a.item.id, 5000);
    expect(await outbox.claimNext(E, 1000)).toBeNull();
    expect((await outbox.claimNext(E, 5000)).id).toBe(a.item.id);
  });
  test('concurrent claims never return the same id', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    await outbox.enqueue(E, patch('2026-03-02', { mood: 1 }));
    const [x, y, z] = await Promise.all([outbox.claimNext(E, 0), outbox.claimNext(E, 0), outbox.claimNext(E, 0)]);
    expect(x.id).not.toBe(y.id);
    expect(z).toBeNull();
  });
  test('a patch enqueued while locked is a separate later item and survives remove', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    const c = await outbox.claimNext(E, 0);
    await outbox.enqueue(E, patch(D, { note: 'later' }));
    await outbox.remove(E, c.id);
    const items = await outbox.loadOutbox(E);
    expect(items).toHaveLength(1);
    expect(items[0].set).toEqual({ note: 'later' });
  });
  test('after release a later patch merges again', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    const c = await outbox.claimNext(E, 0);
    outbox.release(E, c.id);
    await outbox.enqueue(E, patch(D, { note: 'm' }));
    const items = await outbox.loadOutbox(E);
    expect(items).toHaveLength(1);
    expect(items[0].set).toEqual({ mood: 1, note: 'm' });
  });
  test('markFailed unlocks', async () => {
    const a = await outbox.enqueue(E, patch(D, { mood: 1 }));
    await outbox.claimNext(E, 0);
    await outbox.markFailed(E, a.item.id, 0);
    await outbox.enqueue(E, patch(D, { note: 'm' }));
    expect(await outbox.loadOutbox(E)).toHaveLength(1);
  });
  test('replace and delete keep a locked item', async () => {
    await outbox.enqueue(E, patch(D, { mood: 1 }));
    const c = await outbox.claimNext(E, 0);
    await outbox.enqueue(E, { kind: 'log.replace', date: D, payload: { mood: 2 } });
    await outbox.enqueue(E, { kind: 'log.delete', date: D });
    const items = await outbox.loadOutbox(E);
    expect(items.map(i => i.kind)).toEqual(['log.patch', 'log.delete']);
    expect(items[0].id).toBe(c.id);
  });
  test('the cap never drops a locked item', async () => {
    for (let i = 0; i < 500; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await outbox.enqueue(E, { kind: 'log.delete', date: `d${i}` });
    }
    const c = await outbox.claimNext(E, 0);
    const res = await outbox.enqueue(E, { kind: 'log.delete', date: 'extra' });
    expect(res.dropped.map(i => i.date)).toEqual(['d1']);
    const items = await outbox.loadOutbox(E);
    expect(items).toHaveLength(500);
    expect(items[0].id).toBe(c.id);
  }, 60000);
});
