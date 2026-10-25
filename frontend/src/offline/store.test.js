const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const store = require('./store');

const offlineKeys = () => Object.keys(localStorage).filter(k => k.startsWith('luna_offline_'));

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  localStorage.clear();
  mockData.clear();
  await store.__resetForTests();
});

test('round trips per email and isolates emails', async () => {
  await store.write('a@x.com', 'logs', { n: 1 });
  await store.write('b@x.com', 'logs', { n: 2 });
  expect(await store.read('a@x.com', 'logs')).toEqual({ n: 1 });
  expect(await store.read('b@x.com', 'logs')).toEqual({ n: 2 });
  expect(await store.read('a@x.com', 'missing')).toBeNull();
});

test('key names are luna_offline_<64 hex>_<name> and values hold no plaintext', async () => {
  await store.write('a@x.com', 'logs', { secret: 'SENTINEL-VALUE' });
  const keys = offlineKeys();
  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatch(/^luna_offline_[0-9a-f]{64}_logs$/);
  expect(keys[0]).toContain(await store.emailHash('a@x.com'));
  Object.values(localStorage).forEach(v => expect(v).not.toContain('SENTINEL'));
});

test('short and numeric values leave no plaintext either', async () => {
  await store.write('a@x.com', 'n', { code: 7391846, tag: 'Zq9' });
  Object.values(localStorage).forEach(v => { expect(v).not.toContain('7391846'); expect(v).not.toContain('Zq9'); });
});

test('writes are serialised', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.write('a@x.com', 'c', { i })));
  expect(await store.read('a@x.com', 'c')).toEqual({ i: 19 });
});

test('remove deletes one entry', async () => {
  await store.write('a@x.com', 'logs', 1);
  await store.remove('a@x.com', 'logs');
  expect(await store.read('a@x.com', 'logs')).toBeNull();
});

test('clearOthers keeps the given email only', async () => {
  await store.write('a@x.com', 'logs', 1);
  await store.write('b@x.com', 'logs', 2);
  await store.clearOthers('a@x.com');
  expect(await store.read('a@x.com', 'logs')).toBe(1);
  expect(await store.read('b@x.com', 'logs')).toBeNull();
  expect(offlineKeys()).toHaveLength(1);
});

test('clearAll removes every offline key and the vault key', async () => {
  await store.write('a@x.com', 'logs', 1);
  await store.write('b@x.com', 'logs', 2);
  localStorage.setItem('unrelated', 'keep');
  await store.clearAll();
  expect(offlineKeys()).toHaveLength(0);
  expect(mockData.has('luna_vault_key')).toBe(false);
  expect(localStorage.getItem('unrelated')).toBe('keep');
});

test('clearLocalUserData triggers clearAll', async () => {
  await store.write('a@x.com', 'logs', 1);
  require('../session').clearLocalUserData();
  await store.__flush();
  expect(mockData.has('luna_vault_key')).toBe(false);
  expect(offlineKeys()).toHaveLength(0);
});

test('a throwing localStorage.setItem is swallowed and recorded', async () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await expect(store.write('a@x.com', 'logs', 1)).resolves.toBeUndefined();
  expect(store.lastStoreError()).toBeTruthy();
  expect(await store.read('a@x.com', 'logs')).toBeNull();
  spy.mockRestore();
});

test('emails are case-insensitive', async () => {
  await store.write('A@X.com', 'logs', 5);
  expect(await store.read('a@x.com', 'logs')).toBe(5);
});

test('web mode touches nothing', async () => {
  require('../platform').isNative.mockReturnValue(false);
  await store.write('a@x.com', 'logs', 1);
  await store.remove('a@x.com', 'logs');
  expect(await store.read('a@x.com', 'logs')).toBeNull();
  expect(Object.keys(localStorage)).toHaveLength(0);
  expect(mockSecure.get).not.toHaveBeenCalled();
  expect(mockSecure.set).not.toHaveBeenCalled();
});

test('blank email reads null and writes/removes nothing', async () => {
  for (const e of ['', '  ', null, undefined]) {
    await store.write(e, 'logs', 1);
    await store.remove(e, 'logs');
    expect(await store.read(e, 'logs')).toBeNull();
  }
  expect(Object.keys(localStorage)).toHaveLength(0);
  expect(mockSecure.set).not.toHaveBeenCalled();
});

test('readDetailed tells empty, ok and unreadable apart', async () => {
  expect(await store.readDetailed('a@x.com', 'logs')).toEqual({ value: null, status: 'empty' });
  await store.write('a@x.com', 'logs', { n: 1 });
  expect(await store.readDetailed('a@x.com', 'logs')).toEqual({ value: { n: 1 }, status: 'ok' });
  expect(store.lastStoreError()).toBeNull();
  const key = offlineKeys()[0];
  localStorage.setItem(key, 'v1.AAAAAAAAAAAAAAAA.AAAA');
  expect(await store.readDetailed('a@x.com', 'logs')).toEqual({ value: null, status: 'unreadable' });
  expect(store.lastStoreError()).toBeTruthy();
  expect(await store.read('a@x.com', 'logs')).toBeNull();
});

test('a blob sealed for one name does not open as another for the same user', async () => {
  await store.write('a@x.com', 'snapshot', { s: 1 });
  await store.write('a@x.com', 'outbox', { o: 1 });
  const hash = await store.emailHash('a@x.com');
  const snapKey = `luna_offline_${hash}_snapshot`;
  const boxKey = `luna_offline_${hash}_outbox`;
  expect(offlineKeys()).toHaveLength(2);
  localStorage.setItem(boxKey, localStorage.getItem(snapKey));
  expect(await store.readDetailed('a@x.com', 'outbox')).toEqual({ value: null, status: 'unreadable' });
});

test('writes queued before clearAll do not run; writes after it do', async () => {
  const early = store.write('a@x.com', 'logs', 1);
  const cleared = store.clearAll();
  await Promise.all([early, cleared]);
  expect(offlineKeys()).toHaveLength(0);
  expect(mockData.has('luna_vault_key')).toBe(false);
  await store.write('a@x.com', 'logs', 2);
  expect(await store.read('a@x.com', 'logs')).toBe(2);
});

test('a failed write removes the stale blob', async () => {
  await store.write('a@x.com', 'outbox', { items: [1] });
  expect(offlineKeys()).toHaveLength(1);
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await store.write('a@x.com', 'outbox', { items: [] });
  spy.mockRestore();
  expect(offlineKeys()).toHaveLength(0);
  expect(await store.read('a@x.com', 'outbox')).toBeNull();
});

test('clearAll on web only clears localStorage keys', async () => {
  require('../platform').isNative.mockReturnValue(false);
  localStorage.setItem('luna_offline_x_y', 'z');
  mockSecure.remove.mockClear();
  await store.clearAll();
  expect(offlineKeys()).toHaveLength(0);
  expect(mockSecure.remove).not.toHaveBeenCalled();
});
