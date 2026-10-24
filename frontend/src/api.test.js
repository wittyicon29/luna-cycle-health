import { API, ApiError, messageFromDetail, req } from './api';

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  global.fetch = jest.fn();
  localStorage.clear();
});

describe('messageFromDetail', () => {
  test('keeps plain strings', () => {
    expect(messageFromDetail('Invalid credentials', 401)).toBe('Invalid credentials');
  });

  test('turns FastAPI 422 arrays into the first readable message', () => {
    const detail = [{ msg: 'Value error, You must accept the Privacy Policy and Terms to create an account' }];

    expect(messageFromDetail(detail, 422)).toBe('You must accept the Privacy Policy and Terms to create an account');
  });

  test('turns consent_required objects into readable text', () => {
    const text = messageFromDetail({ code: 'consent_required', purpose: 'ai_processing' }, 403);

    expect(text).toMatch(/consent/i);
    expect(text).not.toMatch(/object/i);
  });

  test('falls back to the status code', () => {
    expect(messageFromDetail(undefined, 500)).toBe('Error 500');
    expect(messageFromDetail({ foo: 1 }, 400)).toBe('Error 400');
  });
});

describe('req', () => {
  test('sends the bearer token and returns the JSON body', async () => {
    fetch.mockResolvedValue(reply(200, { ok: true }));

    const data = await req('/periods/', {}, 'tok');

    expect(data).toEqual({ ok: true });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(fetch.mock.calls[0][0]).toMatch(/\/periods\/$/);
  });

  test('throws an ApiError carrying status and code', async () => {
    fetch.mockResolvedValue(reply(400, { detail: { code: 'consent_required', purposes: ['terms_privacy'] } }));

    await expect(req('/x')).rejects.toMatchObject({ status: 400, code: 'consent_required' });
    await expect(req('/x')).rejects.toBeInstanceOf(ApiError);
  });

  test('a 403 consent_required announces itself to the app', async () => {
    const handler = jest.fn();
    window.addEventListener('luna:consent-required', handler);
    fetch.mockResolvedValue(reply(403, { detail: { code: 'consent_required', purpose: 'ai_processing' } }));

    await expect(req('/chat/ask', { method: 'POST' }, 'tok')).rejects.toBeInstanceOf(ApiError);

    window.removeEventListener('luna:consent-required', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ purpose: 'ai_processing' });
  });

  test('a 401 refreshes the token once and retries the request', async () => {
    localStorage.setItem('refresh_token', 'r1');
    const refreshed = jest.fn();
    window.addEventListener('luna:tokens-refreshed', refreshed);
    fetch
      .mockResolvedValueOnce(reply(401, { detail: 'expired' }))
      .mockResolvedValueOnce(reply(200, { access_token: 'a2', refresh_token: 'r2', token_type: 'bearer' }))
      .mockResolvedValueOnce(reply(200, { ok: true }));

    const data = await req('/periods/', {}, 'old');

    window.removeEventListener('luna:tokens-refreshed', refreshed);
    expect(data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer a2');
    expect(localStorage.getItem('access_token')).toBe('a2');
    expect(localStorage.getItem('refresh_token')).toBe('r2');
    expect(refreshed.mock.calls[0][0].detail).toEqual({ accessToken: 'a2' });
  });

  test('simultaneous 401s trigger exactly one refresh', async () => {
    localStorage.setItem('refresh_token', 'r1');
    let refreshCalls = 0;
    fetch.mockImplementation(async (url, opts) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return reply(200, { access_token: 'a2', refresh_token: 'r2', token_type: 'bearer' });
      }
      return opts.headers.Authorization === 'Bearer a2' ? reply(200, { ok: true }) : reply(401, { detail: 'expired' });
    });

    const results = await Promise.all([req('/periods/', {}, 'old'), req('/analysis/', {}, 'old')]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  test('a failed refresh ends the session instead of looping', async () => {
    localStorage.setItem('access_token', 'old');
    localStorage.setItem('refresh_token', 'r1');
    localStorage.setItem('email', 'u@gmail.com');
    const expired = jest.fn();
    window.addEventListener('luna:session-expired', expired);
    fetch
      .mockResolvedValueOnce(reply(401, { detail: 'expired' }))
      .mockResolvedValueOnce(reply(401, { detail: 'Invalid or expired refresh token' }));

    await expect(req('/periods/', {}, 'old')).rejects.toMatchObject({ status: 401 });

    window.removeEventListener('luna:session-expired', expired);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  test('a refresh answered 400 also ends the session', async () => {
    localStorage.setItem('access_token', 'old');
    localStorage.setItem('refresh_token', 'r1');
    const expired = jest.fn();
    window.addEventListener('luna:session-expired', expired);
    fetch.mockResolvedValueOnce(reply(401, { detail: 'expired' })).mockResolvedValueOnce(reply(400, { detail: 'bad' }));

    await expect(req('/periods/', {}, 'old')).rejects.toBeInstanceOf(ApiError);

    window.removeEventListener('luna:session-expired', expired);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  test('no stored refresh token ends the session', async () => {
    localStorage.setItem('access_token', 'old');
    const expired = jest.fn();
    window.addEventListener('luna:session-expired', expired);
    fetch.mockResolvedValueOnce(reply(401, { detail: 'expired' }));

    await expect(req('/periods/', {}, 'old')).rejects.toMatchObject({ status: 401 });

    window.removeEventListener('luna:session-expired', expired);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  describe.each([
    ['503', () => fetch.mockResolvedValueOnce(reply(503, { detail: 'down' }))],
    ['429', () => fetch.mockResolvedValueOnce(reply(429, { detail: 'slow down' }))],
    ['a network error', () => fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
  ])('a transient refresh failure (%s)', (_name, failRefresh) => {
    test('keeps the session and rejects with a readable ApiError', async () => {
      localStorage.setItem('access_token', 'old');
      localStorage.setItem('refresh_token', 'r1');
      const expired = jest.fn();
      window.addEventListener('luna:session-expired', expired);
      fetch.mockResolvedValueOnce(reply(401, { detail: 'expired' }));
      failRefresh();

      const error = await req('/periods/', {}, 'old').catch(e => e);

      window.removeEventListener('luna:session-expired', expired);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBeTruthy();
      expect(expired).not.toHaveBeenCalled();
      expect(localStorage.getItem('access_token')).toBe('old');
      expect(localStorage.getItem('refresh_token')).toBe('r1');
    });
  });

  test('uses the freshest stored access token over a stale argument', async () => {
    localStorage.setItem('access_token', 'fresh');
    fetch.mockResolvedValue(reply(200, {}));

    await req('/x', {}, 'stale');

    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh');
  });

  test('uses the passed token when none is stored', async () => {
    fetch.mockResolvedValue(reply(200, {}));

    await req('/x', {}, 'passed');

    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer passed');
  });

  test('after a refresh, a caller still holding the stale token does not refresh again', async () => {
    localStorage.setItem('access_token', 'old');
    localStorage.setItem('refresh_token', 'r1');
    let refreshCalls = 0;
    fetch.mockImplementation(async (url, opts) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return reply(200, { access_token: 'a2', refresh_token: 'r2', token_type: 'bearer' });
      }
      return opts.headers.Authorization === 'Bearer a2' ? reply(200, { ok: true }) : reply(401, { detail: 'expired' });
    });

    await req('/a', {}, 'old');
    await req('/b', {}, 'old');

    expect(refreshCalls).toBe(1);
    expect(fetch.mock.calls.filter(([u]) => u.endsWith('/b'))).toHaveLength(1);
  });

  test('a wrong password does not trigger a refresh', async () => {
    localStorage.setItem('refresh_token', 'r1');
    fetch.mockResolvedValue(reply(401, { detail: 'Invalid credentials' }));

    await expect(req('/auth/login', { method: 'POST' }, null)).rejects.toThrow('Invalid credentials');

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('API', () => {
  test('googleCallback sends the code and flags as query params with no body', async () => {
    fetch.mockResolvedValue(reply(200, { access_token: 'a' }));

    await API.auth.googleCallback('abc code', { accepted: true, adult: true });

    const [url, opts] = fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toMatch(/\/auth\/google\/callback$/);
    expect(parsed.searchParams.get('code')).toBe('abc code');
    expect(parsed.searchParams.get('accepted_privacy_policy')).toBe('true');
    expect(parsed.searchParams.get('confirmed_18_plus')).toBe('true');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeUndefined();
  });

  test('googleCallback defaults both flags to false', async () => {
    fetch.mockResolvedValue(reply(200, {}));

    await API.auth.googleCallback('abc');

    const parsed = new URL(fetch.mock.calls[0][0]);
    expect(parsed.searchParams.get('accepted_privacy_policy')).toBe('false');
    expect(parsed.searchParams.get('confirmed_18_plus')).toBe('false');
  });

  test('consents.set posts purpose and granted', async () => {
    fetch.mockResolvedValue(reply(200, {}));

    await API.consents.set('ai_processing', true, 'tok');

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/consents$/);
    expect(JSON.parse(opts.body)).toEqual({ purpose: 'ai_processing', granted: true });
  });

  test('account.delete sends the exact confirmation word', async () => {
    fetch.mockResolvedValue(reply(200, { message: 'deleted' }));

    await API.account.delete('tok');

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/account\/delete$/);
    expect(JSON.parse(opts.body)).toEqual({ confirm: 'DELETE' });
  });

  test('verify.check posts the token to /verify/check', async () => {
    fetch.mockResolvedValue(reply(200, { email: 'u@gmail.com' }));

    await API.verify.check('tok-1');

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/verify\/check$/);
    expect(JSON.parse(opts.body)).toEqual({ token: 'tok-1' });
  });

  test('verify.complete posts token and password to /verify/complete', async () => {
    fetch.mockResolvedValue(reply(200, { access_token: 'a', refresh_token: 'r' }));

    await API.verify.complete('tok-1', 'password123');

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/verify\/complete$/);
    expect(JSON.parse(opts.body)).toEqual({ token: 'tok-1', password: 'password123' });
  });

  test('verify.verify no longer exists', () => {
    expect(API.verify.verify).toBeUndefined();
  });

  test('verify.resend posts a JSON email body', async () => {
    fetch.mockResolvedValue(reply(200, {}));

    await API.verify.resend('u@gmail.com');

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: 'u@gmail.com' });
  });
});

test('periods.remove sends DELETE to the period', async () => {
  fetch.mockResolvedValue(reply(200, { message: 'Period deleted' }));

  await API.periods.remove('p1', 'tok');

  const [url, opts] = fetch.mock.calls[0];
  expect(url).toMatch(/\/periods\/p1$/);
  expect(opts.method).toBe('DELETE');
});
