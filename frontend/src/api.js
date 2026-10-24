import { API_BASE } from './config';

// Endpoints where a 401 means "wrong credentials", not "expired session".
const NO_REFRESH_PREFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/google',
  '/auth/request-password-reset',
  '/auth/reset-password',
];

export class ApiError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail.code : undefined;
  }
}

export function messageFromDetail(detail, status) {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail[0] && detail[0].msg) {
    return String(detail[0].msg).replace(/^Value error, /, '');
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    if (detail.code === 'consent_required') return 'Please review and accept the required consent to continue.';
    if (typeof detail.message === 'string') return detail.message;
  }
  return `Error ${status}`;
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function expireSession() {
  ['access_token', 'refresh_token', 'email'].forEach(key => localStorage.removeItem(key));
  emit('luna:session-expired');
}

async function toApiError(res) {
  const body = await res.json().catch(() => ({}));
  const detail = body ? body.detail : undefined;
  const error = new ApiError(messageFromDetail(detail, res.status), { status: res.status, detail });
  if (res.status === 403 && error.code === 'consent_required') {
    emit('luna:consent-required', { purpose: detail.purpose });
  }
  return error;
}

let refreshing = null;

// One refresh at a time: concurrent 401s share the same in-flight refresh.
function refreshTokens() {
  if (refreshing) return refreshing;
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return Promise.resolve(null);

  refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      emit('luna:tokens-refreshed', { accessToken: data.access_token });
      return data.access_token;
    } catch (e) {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function req(path, opts = {}, token = null, retried = false) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...opts.headers,
  };
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && token && !retried && !NO_REFRESH_PREFIXES.some(p => path.startsWith(p))) {
    const fresh = await refreshTokens();
    if (fresh) return req(path, opts, fresh, true);
    expireSession();
  }
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

const post = (path, body, token) => req(path, { method: 'POST', body: JSON.stringify(body) }, token);

export const API = {
  auth: {
    register: d => post('/auth/register', d),
    login: d => post('/auth/login', d),
    status: t => req('/auth/status', {}, t),
    requestPasswordReset: d => post('/auth/request-password-reset', d),
    resetPassword: d => post('/auth/reset-password', d),
    getGoogleAuthUrl: () => req('/auth/google/auth-url'),
    googleCallback: (code, { accepted = false, adult = false } = {}) => {
      const query = new URLSearchParams({
        code,
        accepted_privacy_policy: String(accepted),
        confirmed_18_plus: String(adult),
      });
      return req(`/auth/google/callback?${query}`, { method: 'POST' });
    },
  },
  verify: {
    verify: token => post('/verify/verify', { token }),
    resend: email => post('/verify/resend', { email }),
  },
  periods: {
    list: t => req('/periods/', {}, t),
    create: (d, t) => post('/periods/', d, t),
    update: (id, d, t) => req(`/periods/${id}`, { method: 'PUT', body: JSON.stringify(d) }, t),
  },
  questionnaires: {
    latest: t => req('/questionnaires/latest', {}, t),
    submit: (d, t) => post('/questionnaires/', d, t),
  },
  analysis: {
    list: t => req('/analysis/', {}, t),
    generate: (d, t) => post('/analysis/', d, t),
    latest: (type, t) => req(`/analysis/latest/${type}`, {}, t),
  },
  chat: {
    send: (d, t) => post('/chat/ask', d, t),
    history: t => req('/chat/history', {}, t),
  },
  consents: {
    get: t => req('/consents', {}, t),
    set: (purpose, granted, t) => post('/consents', { purpose, granted }, t),
  },
  account: {
    export: t => req('/account/export', {}, t),
    delete: t => post('/account/delete', { confirm: 'DELETE' }, t),
  },
};
