import { isNative } from './platform';

const KEYS = ['access_token', 'refresh_token', 'email'];
let cache = {};

async function secureStorage() {
  const mod = await import('@aparajita/capacitor-secure-storage');
  return mod.SecureStorage;
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
  try {
    const storage = await secureStorage();
    const values = await Promise.all(KEYS.map(async key => {
      try { return [key, await storage.get(key)]; } catch (e) { return [key, null]; }
    }));
    cache = Object.fromEntries(values.filter(([, v]) => typeof v === 'string' && v));
  } catch (e) {
    cache = {};
  }
}

async function write(entries) {
  if (!isNative()) {
    try { Object.entries(entries).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) { /* storage unavailable */ }
    return;
  }
  Object.assign(cache, entries);
  try {
    const storage = await secureStorage();
    await Promise.all(Object.entries(entries).map(([k, v]) => storage.set(k, v)));
  } catch (e) { /* kept in memory for this run only */ }
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
  cache = {};
  try {
    const storage = await secureStorage();
    await Promise.all(KEYS.map(k => storage.remove(k).catch(() => {})));
  } catch (e) { /* nothing to remove */ }
}

export function __resetTokenStoreForTests() { cache = {}; }
