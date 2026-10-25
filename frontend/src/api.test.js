import { API, ApiError, messageFromDetail, req } from './api';
import { setLanguage } from './i18n';

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

  test('googleIdToken posts the token and flags with no Authorization header', async () => {
    fetch.mockResolvedValue(reply(200, {}));

    await API.auth.googleIdToken('idtok', { accepted: true, adult: true });

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/auth\/google\/id-token$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ id_token: 'idtok', accepted_privacy_policy: true, confirmed_18_plus: true });
    expect((opts.headers || {}).Authorization).toBeUndefined();
  });

  test('googleIdToken defaults both flags to false', async () => {
    fetch.mockResolvedValue(reply(200, {}));

    await API.auth.googleIdToken('idtok');

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ id_token: 'idtok', accepted_privacy_policy: false, confirmed_18_plus: false });
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

    await API.verify.complete('tok-1', 'password123', { accepted: true, adult: true });

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/verify\/complete$/);
    expect(JSON.parse(opts.body)).toEqual({ token: 'tok-1', password: 'password123', accepted_privacy_policy: true, confirmed_18_plus: true });
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

test('periods.prediction GETs the prediction with the bearer token', async () => {
  fetch.mockResolvedValue(reply(200, {}));

  await API.periods.prediction('tok');

  const [url, opts] = fetch.mock.calls[0];
  expect(url).toMatch(/\/periods\/prediction$/);
  expect(opts.headers.Authorization).toBe('Bearer tok');
});

describe('logs and medications', () => {
  const call = async fn => {
    fetch.mockResolvedValue(reply(200, {}));
    await fn();
    const [url, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok');
    return [url, opts];
  };

  test('logs.list GETs the range', async () => {
    const [url, opts] = await call(() => API.logs.list('2026-09-27', '2026-10-31', 'tok'));
    expect(url).toMatch(/\/logs\/\?from=2026-09-27&to=2026-10-31$/);
    expect(opts.method).toBeUndefined();
  });

  test('logs.put PUTs the body to the date', async () => {
    const [url, opts] = await call(() => API.logs.put('2026-10-25', { mood: 'ok' }, 'tok'));
    expect(url).toMatch(/\/logs\/2026-10-25$/);
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ mood: 'ok' });
  });

  test('logs.remove DELETEs the date', async () => {
    const [url, opts] = await call(() => API.logs.remove('2026-10-25', 'tok'));
    expect(url).toMatch(/\/logs\/2026-10-25$/);
    expect(opts.method).toBe('DELETE');
  });

  test('medications.list hides archived by default and can include them', async () => {
    const [url] = await call(() => API.medications.list('tok'));
    expect(url).toMatch(/\/medications\/$/);
    fetch.mockClear();
    const [url2] = await call(() => API.medications.list('tok', true));
    expect(url2).toMatch(/\/medications\/\?include_archived=true$/);
  });

  test('medications.create POSTs the name', async () => {
    const [url, opts] = await call(() => API.medications.create('Iron', 'tok'));
    expect(url).toMatch(/\/medications\/$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Iron' });
  });

  test('medications.update PATCHes and remove DELETEs by id', async () => {
    const [url, opts] = await call(() => API.medications.update('m1', { archived: true }, 'tok'));
    expect(url).toMatch(/\/medications\/m1$/);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ archived: true });
    fetch.mockClear();
    const [url2, opts2] = await call(() => API.medications.remove('m1', 'tok'));
    expect(url2).toMatch(/\/medications\/m1$/);
    expect(opts2.method).toBe('DELETE');
  });
});

describe('language sent to the AI endpoints', () => {
  afterEach(() => { setLanguage('en'); });
  const sentBody = () => JSON.parse(fetch.mock.calls[0][1].body);

  test('chat.send defaults to en and sends hi after setLanguage(hi)', async () => {
    fetch.mockResolvedValue(reply(200, {}));
    setLanguage('en');
    await API.chat.send({ question: 'hi', include_context: true }, 'tok');
    expect(fetch.mock.calls[0][0]).toMatch(/\/chat\/ask$/);
    expect(sentBody()).toEqual({ question: 'hi', include_context: true, language: 'en' });
    fetch.mockClear();
    setLanguage('hi');
    await API.chat.send({ question: 'hi' }, 'tok');
    expect(sentBody()).toEqual({ question: 'hi', language: 'hi' });
  });

  test('analysis.generate defaults to en and sends hi after setLanguage(hi)', async () => {
    fetch.mockResolvedValue(reply(200, {}));
    setLanguage('en');
    await API.analysis.generate({ analysis_type: 'cycle_health' }, 'tok');
    expect(sentBody()).toEqual({ analysis_type: 'cycle_health', language: 'en' });
    fetch.mockClear();
    setLanguage('hi');
    await API.analysis.generate({ analysis_type: 'cycle_health' }, 'tok');
    expect(sentBody()).toEqual({ analysis_type: 'cycle_health', language: 'hi' });
  });

  test('the pseudo-locale sends en to both endpoints', async () => {
    fetch.mockResolvedValue(reply(200, {}));
    setLanguage('en-XA');
    await API.chat.send({ question: 'q' }, 'tok');
    expect(sentBody().language).toBe('en');
    fetch.mockClear();
    await API.analysis.generate({ analysis_type: 'cycle_health' }, 'tok');
    expect(sentBody().language).toBe('en');
  });

  test('the caller body is not mutated', async () => {
    fetch.mockResolvedValue(reply(200, {}));
    const body = { question: 'q' };
    await API.chat.send(body, 'tok');
    expect(body).toEqual({ question: 'q' });
  });
});

describe('network failures', () => {
  afterEach(() => setLanguage('en'));
  const offline = () => new TypeError('Failed to fetch');

  test('offline during login is a translated connection error, not the browser text', async () => {
    setLanguage('hi');
    fetch.mockRejectedValue(offline());
    const err = await API.auth.login({ email: 'a@b.c', password: 'x' }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.rawMessage).toBe('Connection problem. Please try again.');
    expect(err.message).toBe('कनेक्शन में समस्या आई। कृपया दोबारा कोशिश करें।');
  });

  test('offline during an authenticated call keeps the session', async () => {
    localStorage.setItem('access_token', 'tok');
    localStorage.setItem('refresh_token', 'r1');
    const expired = jest.fn();
    window.addEventListener('luna:session-expired', expired);
    fetch.mockRejectedValue(offline());
    const err = await API.periods.list('tok').catch(e => e);
    window.removeEventListener('luna:session-expired', expired);
    expect(err.message).toBe('Connection problem. Please try again.');
    expect(err.status).toBe(0);
    expect(expired).not.toHaveBeenCalled();
    expect(localStorage.getItem('refresh_token')).toBe('r1');
  });

  test('offline during the token refresh does not log the user out', async () => {
    localStorage.setItem('access_token', 'old');
    localStorage.setItem('refresh_token', 'r1');
    const expired = jest.fn();
    window.addEventListener('luna:session-expired', expired);
    fetch.mockResolvedValueOnce(reply(401, { detail: 'expired' })).mockRejectedValueOnce(offline());
    const err = await API.periods.list('old').catch(e => e);
    window.removeEventListener('luna:session-expired', expired);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Connection problem. Please try again.');
    expect(expired).not.toHaveBeenCalled();
    expect(localStorage.getItem('refresh_token')).toBe('r1');
  });

  test('rawMessage keeps the untranslated server text while message is translated', async () => {
    setLanguage('hi');
    fetch.mockResolvedValue(reply(422, { detail: 'Date is out of range' }));
    const err = await API.logs.put('2026-01-01', {}, 'tok').catch(e => e);
    expect(err.rawMessage).toBe('Date is out of range');
    expect(err.message).toBe('तारीख सीमा से बाहर है');
  });
});
