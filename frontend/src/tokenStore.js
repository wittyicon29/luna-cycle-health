import { isNative } from './platform';

const KEYS = ['access_token', 'refresh_token', 'email'];
let cache = {};
let chain = Promise.resolve();
let generation = 0; // bumped by every write/clear/timeout so a late hydration cannot clobber newer state

// Native persistence runs strictly in call order; tasks never reject.
function enqueue(task) {
  chain = chain.then(task, task).catch(() => {});
  return chain;
}

// The plugin object is a Capacitor Proxy whose `then` throws on native. Never return it from an
// async function (promise resolution reads `.then`); resolve with a plain wrapper instead.
async function secureStorage() {
  const { SecureStorage: plugin } = await import('@aparajita/capacitor-secure-storage');
  return {
    get: key => plugin.get(key),
    set: (key, value) => plugin.set(key, value),
    remove: key => plugin.remove(key),
  };
}

function readLocal(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function read(key) {
  return isNative() ? (cache[key] ?? null) : readLocal(key);
}

export const getAccessToken = () => read('access_token');
export const getRefreshToken = () => read('refresh_token');
export const getEmail = () => read('email');

export async function initTokenStore() {
  if (!isNative()) return;
  const startedAt = generation;
  try {
    const storage = await secureStorage();
    const values = await Promise.all(KEYS.map(async key => {
      try { return [key, await storage.get(key)]; } catch (e) { return [key, null]; }
    }));
    if (generation === startedAt) {
      cache = Object.fromEntries(values.filter(([, v]) => typeof v === 'string' && v));
    }
  } catch (e) {
    if (generation === startedAt) cache = {};
  }
}

// Resolves when hydration finishes or after `ms`, whichever is first. After a timeout the
// session starts logged out and any late hydration result is discarded.
export function initTokenStoreWithTimeout(ms = 3000) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { generation += 1; resolve(); }, ms);
  });
  return Promise.race([initTokenStore(), timeout]).finally(() => clearTimeout(timer));
}

async function write(entries) {
  if (!isNative()) {
    try { Object.entries(entries).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) { /* storage unavailable */ }
    return;
  }
  generation += 1;
  Object.assign(cache, entries);
  await enqueue(async () => {
    try {
      const storage = await secureStorage();
      await Promise.all(Object.entries(entries).map(([k, v]) => storage.set(k, v)));
    } catch (e) { /* kept in memory for this run only */ }
  });
}

export function setSession({ accessToken, refreshToken, email }) {
  return write({ access_token: accessToken, refresh_token: refreshToken, email });
}

export function setTokens({ accessToken, refreshToken }) {
  return write({ access_token: accessToken, refresh_token: refreshToken });
}

export async function clearSession() {
  if (!isNative()) {
    try { KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* storage unavailable */ }
    return;
  }
  generation += 1;
  cache = {};
  await enqueue(async () => {
    try {
      const storage = await secureStorage();
      await Promise.all(KEYS.map(k => storage.remove(k).catch(() => {})));
    } catch (e) { /* nothing to remove */ }
  });
}

export function __resetTokenStoreForTests() { cache = {}; chain = Promise.resolve(); generation = 0; }
