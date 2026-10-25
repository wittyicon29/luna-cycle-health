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
  const raw = mockData.get('luna_vault_key');
  expect(JSON.stringify(Object.values(localStorage))).not.toContain(raw);
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
