const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const vault = require('./vault');

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  mockData.clear();
  localStorage.clear();
  mockSecure.set.mockClear();
  await vault.dropKey();
  mockSecure.remove.mockClear();
});

test('round trips a value and uses a random IV with no plaintext in the blob', async () => {
  const a = await vault.seal({ a: 1 }, 'h');
  const b = await vault.seal({ a: 1 }, 'h');
  expect(a).not.toBe(b);
  expect(a.startsWith('v1.')).toBe(true);
  expect(a).not.toContain('"a"');
  expect(await vault.open(a, 'h')).toEqual({ a: 1 });
});

test('tampered ciphertext, wrong emailHash and garbage open as null', async () => {
  const blob = await vault.seal({ a: 1 }, 'h');
  const [v, iv, ct] = blob.split('.');
  const flipped = ct[0] === 'A' ? 'B' + ct.slice(1) : 'A' + ct.slice(1);
  expect(await vault.open([v, iv, flipped].join('.'), 'h')).toBeNull();
  expect(await vault.open(blob, 'other')).toBeNull();
  expect(await vault.open('not a blob', 'h')).toBeNull();
  expect(await vault.open(undefined, 'h')).toBeNull();
});

test('open never creates a key', async () => {
  expect(await vault.open('v1.AAAAAAAAAAAAAAAA.AAAA', 'h')).toBeNull();
  expect(mockSecure.set).not.toHaveBeenCalled();
  expect(mockData.has('luna_vault_key')).toBe(false);
});

test('the key lives only in secure storage; dropKey invalidates old blobs', async () => {
  const blob = await vault.seal({ a: 1 }, 'h');
  expect(mockData.has('luna_vault_key')).toBe(true);
  expect(Object.keys(localStorage)).toHaveLength(0);
  await vault.dropKey();
  expect(mockData.has('luna_vault_key')).toBe(false);
  expect(await vault.open(blob, 'h')).toBeNull();
});

test('seals a large value without overflowing the stack', async () => {
  const big = { s: 'x'.repeat(300000) };
  expect(await vault.open(await vault.seal(big, 'h'), 'h')).toEqual(big);
});

test('seal rejects when the vault cannot create a key', async () => {
  mockSecure.set.mockRejectedValueOnce(new Error('keystore down'));
  await expect(vault.seal({ a: 1 }, 'h')).rejects.toThrow();
});

test('a failed key read never creates a new key and the old blob stays readable', async () => {
  const blob = await vault.seal({ a: 1 }, 'h');
  const original = mockData.get('luna_vault_key');
  vault.__resetCacheForTests();
  mockSecure.set.mockClear();
  mockSecure.get.mockRejectedValueOnce(new Error('keystore locked'));
  await expect(vault.seal({ b: 2 }, 'h')).rejects.toThrow('vault unavailable');
  expect(mockSecure.set).not.toHaveBeenCalled();
  expect(mockData.get('luna_vault_key')).toBe(original);
  expect(await vault.open(blob, 'h')).toEqual({ a: 1 });
  await expect(vault.seal({ b: 2 }, 'h')).resolves.toMatch(/^v1\./);
});

test('an open running concurrently with a seal does not stop the seal creating the key', async () => {
  const [opened, sealed] = await Promise.all([vault.open('v1.AAAAAAAAAAAAAAAA.AAAA', 'h'), vault.seal({ a: 1 }, 'h')]);
  expect(opened).toBeNull();
  expect(sealed).toMatch(/^v1\./);
  expect(mockSecure.set).toHaveBeenCalledTimes(1);
});

test('two concurrent seals create exactly one key', async () => {
  const [a, b] = await Promise.all([vault.seal(1, 'h'), vault.seal(2, 'h')]);
  expect(mockSecure.set).toHaveBeenCalledTimes(1);
  expect(await vault.open(a, 'h')).toBe(1);
  expect(await vault.open(b, 'h')).toBe(2);
});

test('dropKey waits for a pending key creation before removing it', async () => {
  const sealing = vault.seal(1, 'h');
  await vault.dropKey();
  await sealing.catch(() => {});
  expect(mockData.has('luna_vault_key')).toBe(false);
});

test('dropKey does not touch secure storage on web', async () => {
  require('../platform').isNative.mockReturnValue(false);
  mockSecure.remove.mockClear();
  await vault.dropKey();
  expect(mockSecure.remove).not.toHaveBeenCalled();
});

test('a key read racing dropKey never puts the old key back in memory; the next seal persists a fresh key', async () => {
  const blob = await vault.seal({ a: 1 }, 'h');
  const oldRaw = mockData.get('luna_vault_key');
  vault.__resetCacheForTests(); // app restart: key only in secure storage
  let release;
  const gate = new Promise(r => { release = r; });
  mockSecure.remove.mockImplementationOnce(async k => { await gate; mockData.delete(k); });
  const dropping = vault.dropKey();
  const opening = vault.open(blob, 'h');
  await new Promise(r => setTimeout(r, 0));
  release();
  await dropping;
  await opening;
  expect(mockData.has('luna_vault_key')).toBe(false);
  expect(await vault.open(blob, 'h')).toBeNull();
  const fresh = await vault.seal({ b: 2 }, 'h');
  expect(mockData.get('luna_vault_key')).toBeTruthy();
  expect(mockData.get('luna_vault_key')).not.toBe(oldRaw);
  vault.__resetCacheForTests();
  expect(await vault.open(fresh, 'h')).toEqual({ b: 2 });
});
