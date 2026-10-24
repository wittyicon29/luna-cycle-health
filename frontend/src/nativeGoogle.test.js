const mockInitialize = jest.fn();
const mockLogin = jest.fn();

jest.mock('@capgo/capacitor-social-login', () => ({
  SocialLogin: {
    initialize: (...a) => mockInitialize(...a),
    login: (...a) => mockLogin(...a),
  },
}));

function load(clientId) {
  jest.resetModules();
  jest.doMock('./config', () => ({ GOOGLE_WEB_CLIENT_ID: clientId }));
  return require('./nativeGoogle').signInWithGoogleNative;
}

beforeEach(() => {
  mockInitialize.mockReset().mockResolvedValue(undefined);
  mockLogin.mockReset();
});

test('returns the ID token', async () => {
  mockLogin.mockResolvedValue({ provider: 'google', result: { idToken: 'tok' } });
  const signIn = load('client-id');

  await expect(signIn()).resolves.toBe('tok');
  expect(mockInitialize).toHaveBeenCalledWith({ google: { webClientId: 'client-id' } });
  expect(mockLogin).toHaveBeenCalledWith({ provider: 'google', options: { scopes: ['email', 'profile'] } });
});

test('is not configured without a client ID and never touches the plugin', async () => {
  const signIn = load('');

  await expect(signIn()).rejects.toThrow('Google sign-in is not configured');
  expect(mockInitialize).not.toHaveBeenCalled();
  expect(mockLogin).not.toHaveBeenCalled();
});

test('maps a cancellation to a cancelled error', async () => {
  mockLogin.mockRejectedValue(new Error('User CANCELLED the request'));
  const signIn = load('client-id');

  await expect(signIn()).rejects.toThrow('Google sign-in was cancelled');
});

test('hides other plugin errors behind a generic message', async () => {
  mockLogin.mockRejectedValue(new Error('boom for someone@gmail.com'));
  const signIn = load('client-id');

  await expect(signIn()).rejects.toThrow(/^Google sign-in failed$/);
});

test('a response without a token is a generic failure', async () => {
  mockLogin.mockResolvedValue({ provider: 'google', result: { idToken: null } });
  const signIn = load('client-id');

  await expect(signIn()).rejects.toThrow('Google sign-in failed');
});

test('initialises the plugin once across two calls', async () => {
  mockLogin.mockResolvedValue({ result: { idToken: 'tok' } });
  const signIn = load('client-id');

  await signIn();
  await signIn();

  expect(mockInitialize).toHaveBeenCalledTimes(1);
  expect(mockLogin).toHaveBeenCalledTimes(2);
});
