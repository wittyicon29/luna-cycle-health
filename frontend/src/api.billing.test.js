import { API, ApiError, messageFromDetail, rawMessageFromDetail } from './api';
import { setLanguage } from './i18n';
import hi from './i18n/catalogs/hi.json';

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const PLAN_REQUIRED = { code: 'plan_required', message: 'Luna AI plan required' };

beforeEach(() => {
  global.fetch = jest.fn();
  localStorage.clear();
  setLanguage('en');
});

afterAll(() => setLanguage('en'));

describe('API.billing request shapes', () => {
  test('status is an authenticated GET of /billing/status', async () => {
    fetch.mockResolvedValue(reply(200, { enabled: false, active: false, plan: 'free', account_token: 'acct', product_ids: [] }));

    const body = await API.billing.status('tok');

    expect(body.enabled).toBe(false);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/billing\/status$/);
    expect(opts.method).toBeUndefined();
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  test('verify posts exactly the purchase token and product id', async () => {
    fetch.mockResolvedValue(reply(200, { enabled: true, active: true, plan: 'ai', account_token: 'acct', product_ids: ['luna_ai_monthly'] }));

    await API.billing.verify({ purchase_token: 'ptok', product_id: 'luna_ai_monthly', extra: 'dropped' }, 'tok');

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/billing\/verify$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ purchase_token: 'ptok', product_id: 'luna_ai_monthly' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  test('refresh is an authenticated POST of /billing/refresh with no body fields', async () => {
    fetch.mockResolvedValue(reply(200, { enabled: true, active: false, plan: 'free', account_token: 'acct', product_ids: [] }));

    await API.billing.refresh('tok');

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/billing\/refresh$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body || '{}')).toEqual({});
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });
});

describe('plan_required', () => {
  test('a 403 plan_required emits luna:plan-required once and rejects with a translated ApiError', async () => {
    const planHandler = jest.fn();
    const consentHandler = jest.fn();
    window.addEventListener('luna:plan-required', planHandler);
    window.addEventListener('luna:consent-required', consentHandler);
    fetch.mockResolvedValue(reply(403, { detail: PLAN_REQUIRED }));
    setLanguage('hi');

    let error;
    try { await API.chat.send({ question: 'hi' }, 'tok'); } catch (e) { error = e; }

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'plan_required' });
    expect(error.message).toBe(hi['Luna AI plan required']);
    expect(error.rawMessage).toBeUndefined();
    expect(planHandler).toHaveBeenCalledTimes(1);
    expect(consentHandler).not.toHaveBeenCalled();
    window.removeEventListener('luna:plan-required', planHandler);
    window.removeEventListener('luna:consent-required', consentHandler);
  });

  test('plan_required on another status does not emit the event', async () => {
    const handler = jest.fn();
    window.addEventListener('luna:plan-required', handler);
    fetch.mockResolvedValue(reply(400, { detail: PLAN_REQUIRED }));

    await expect(API.analysis.list('tok')).rejects.toMatchObject({ status: 400, code: 'plan_required' });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('luna:plan-required', handler);
  });

  test('messageFromDetail suppresses the server text and returns the translated plan message', () => {
    expect(rawMessageFromDetail(PLAN_REQUIRED)).toBeUndefined();
    expect(rawMessageFromDetail({ code: 'plan_required' })).toBeUndefined();
    expect(messageFromDetail({ code: 'plan_required' }, 403)).toBe('Luna AI plan required');
    setLanguage('hi');
    expect(messageFromDetail(PLAN_REQUIRED, 403)).toBe(hi['Luna AI plan required']);
  });

  test('consent_required behaviour is unchanged and never emits plan-required', async () => {
    const planHandler = jest.fn();
    const consentHandler = jest.fn();
    window.addEventListener('luna:plan-required', planHandler);
    window.addEventListener('luna:consent-required', consentHandler);
    fetch.mockResolvedValue(reply(403, { detail: { code: 'consent_required', purpose: 'ai_processing' } }));

    await expect(API.chat.history('tok')).rejects.toMatchObject({ status: 403, code: 'consent_required' });

    expect(consentHandler).toHaveBeenCalledTimes(1);
    expect(consentHandler.mock.calls[0][0].detail).toEqual({ purpose: 'ai_processing' });
    expect(planHandler).not.toHaveBeenCalled();
    window.removeEventListener('luna:plan-required', planHandler);
    window.removeEventListener('luna:consent-required', consentHandler);
  });
});

describe('purchase-failure messages from /billing/verify are translated', () => {
  const MESSAGES = [
    'This purchase belongs to a different account',
    'This purchase is already linked to another account',
    'This purchase is not for a Luna AI plan',
    'This subscription is not active',
    'Could not confirm the purchase with Google Play. Try again.',
    'Google Play is unavailable right now. Try again.',
    'This purchase could not be verified',
  ];

  test.each(MESSAGES)('%s', async text => {
    expect(hi[text]).toEqual(expect.any(String));
    setLanguage('hi');
    fetch.mockResolvedValue(reply(409, { detail: text }));

    const error = await API.billing.verify({ purchase_token: 'p', product_id: 'luna_ai_monthly' }, 'tok').catch(e => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(hi[text]);
    expect(error.rawMessage).toBe(text);
  });
});
