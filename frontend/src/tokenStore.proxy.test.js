// Regression: the real Capacitor plugin is a Proxy whose `then` throws on native. Resolving a
// promise with it rejected every read/write, and the catch blocks hid it (tokens never persisted).
const mockStore = {};
const mockPlugin = {
  get: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  get then() { throw new Error('"SecureStorage.then()" is not implemented on android'); },
};

jest.mock('./platform', () => ({ isNative: () => true }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockPlugin }));

const store = require('./tokenStore');

beforeEach(() => {
  Object.keys(mockStore).forEach(k => delete mockStore[k]);
  // CRA sets resetMocks, so implementations must be (re)installed per test.
  mockPlugin.get.mockImplementation(async key => (key in mockStore ? mockStore[key] : null));
  mockPlugin.set.mockImplementation(async (key, value) => { mockStore[key] = value; });
  mockPlugin.remove.mockImplementation(async key => { delete mockStore[key]; });
  store.__resetTokenStoreForTests();
});

test('persists, hydrates and clears through a plugin whose then() throws', async () => {
  await store.setSession({ accessToken: 'a', refreshToken: 'r', email: 'e@gmail.com' });
  expect(mockPlugin.set).toHaveBeenCalledWith('access_token', 'a');
  expect(mockPlugin.set).toHaveBeenCalledWith('refresh_token', 'r');
  expect(mockPlugin.set).toHaveBeenCalledWith('email', 'e@gmail.com');

  store.__resetTokenStoreForTests(); // simulate a fresh process
  await store.initTokenStore();
  expect(store.getAccessToken()).toBe('a');
  expect(store.getRefreshToken()).toBe('r');
  expect(store.getEmail()).toBe('e@gmail.com');

  await store.clearSession();
  expect(mockPlugin.remove).toHaveBeenCalledWith('access_token');
  expect(mockPlugin.remove).toHaveBeenCalledWith('refresh_token');
  expect(mockPlugin.remove).toHaveBeenCalledWith('email');
  expect(mockStore).toEqual({});
});
