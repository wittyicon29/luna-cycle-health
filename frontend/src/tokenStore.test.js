const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const { isNative } = require('./platform');
const store = require('./tokenStore');

beforeEach(() => {
  localStorage.clear();
  mockSecure.get.mockReset(); mockSecure.set.mockReset(); mockSecure.remove.mockReset();
  mockSecure.get.mockResolvedValue(null);
  mockSecure.set.mockResolvedValue(undefined);
  mockSecure.remove.mockResolvedValue(undefined);
  store.__resetTokenStoreForTests();
});

describe('web', () => {
  beforeEach(() => isNative.mockReturnValue(false));

  test('reads and writes the same localStorage keys as before', async () => {
    await store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e@gmail.com' });
    expect(localStorage.getItem('access_token')).toBe('a');
    expect(localStorage.getItem('refresh_token')).toBe('r');
    expect(localStorage.getItem('email')).toBe('e@gmail.com');
    expect(store.getAccessToken()).toBe('a');
    expect(mockSecure.set).not.toHaveBeenCalled();
  });

  test('getters see values seeded directly in localStorage (existing tests rely on this)', () => {
    localStorage.setItem('access_token', 'seeded');
    expect(store.getAccessToken()).toBe('seeded');
    expect(store.getRefreshToken()).toBeNull();
  });

  test('clearSession removes all three keys', async () => {
    await store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e' });
    await store.clearSession();
    expect(store.getAccessToken()).toBeNull();
    expect(localStorage.getItem('email')).toBeNull();
  });
});

describe('native', () => {
  beforeEach(() => isNative.mockReturnValue(true));

  test('hydrates the cache from secure storage once at init', async () => {
    mockSecure.get.mockImplementation(async key => ({ access_token: 'A', refresh_token: 'R', email: 'e@gmail.com' }[key] ?? null));
    await store.initTokenStore();
    expect(store.getAccessToken()).toBe('A');
    expect(store.getRefreshToken()).toBe('R');
    expect(store.getEmail()).toBe('e@gmail.com');
  });

  test('a throwing secure store at startup means logged out, not a crash', async () => {
    mockSecure.get.mockRejectedValue(new Error('keystore unavailable'));
    await expect(store.initTokenStore()).resolves.toBeUndefined();
    expect(store.getAccessToken()).toBeNull();
  });

  test('setSession updates the cache immediately and persists to secure storage, never localStorage', async () => {
    const pending = store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e' });
    expect(store.getAccessToken()).toBe('a');
    await pending;
    expect(mockSecure.set).toHaveBeenCalledWith('access_token', 'a');
    expect(mockSecure.set).toHaveBeenCalledWith('refresh_token', 'r');
    expect(mockSecure.set).toHaveBeenCalledWith('email', 'e');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  test('a failing write does not reject and keeps the in-memory session', async () => {
    mockSecure.set.mockRejectedValue(new Error('disk full'));
    await expect(store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e' })).resolves.toBeUndefined();
    expect(store.getAccessToken()).toBe('a');
  });

  test('clearSession empties the cache and removes the secure entries', async () => {
    await store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e' });
    await store.clearSession();
    expect(store.getAccessToken()).toBeNull();
    expect(mockSecure.remove).toHaveBeenCalledWith('access_token');
    expect(mockSecure.remove).toHaveBeenCalledWith('refresh_token');
    expect(mockSecure.remove).toHaveBeenCalledWith('email');
  });

  test('setTokens leaves the stored email untouched', async () => {
    await store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'keep@gmail.com' });
    await store.setTokens({ accessToken: 'a2', refreshToken: 'r2' });
    expect(store.getEmail()).toBe('keep@gmail.com');
    expect(store.getAccessToken()).toBe('a2');
  });
});

describe('hardening', () => {
  beforeEach(() => isNative.mockReturnValue(true));

  test('startup gives up on a hung secure store after the timeout and a late hydration cannot overwrite a newer session', async () => {
    jest.useFakeTimers();
    try {
      let release;
      mockSecure.get.mockImplementation(() => new Promise(resolve => { release = resolve; }));
      const started = store.initTokenStoreWithTimeout(3000);
      jest.advanceTimersByTime(3000);
      await expect(started).resolves.toBeUndefined();
      expect(store.getAccessToken()).toBeNull();

      await store.setSession({ accessToken: 'new', refreshToken: 'nr', email: 'n@gmail.com' });
      release('OLD');
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(store.getAccessToken()).toBe('new');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a clear issued while a write is in flight is not undone by it', async () => {
    const calls = [];
    mockSecure.set.mockImplementation(async (k) => { await new Promise(r => setTimeout(r, 20)); calls.push(`set:${k}`); });
    mockSecure.remove.mockImplementation(async (k) => { calls.push(`remove:${k}`); });
    const w = store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e' });
    const c = store.clearSession();
    expect(store.getAccessToken()).toBeNull();
    await Promise.all([w, c]);
    const lastSet = Math.max(...calls.map((x, i) => (x.startsWith('set:') ? i : -1)));
    const firstRemove = calls.findIndex(x => x.startsWith('remove:'));
    expect(firstRemove).toBeGreaterThan(lastSet);
  });
});
