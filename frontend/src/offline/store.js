/* global globalThis */
import { isNative } from '../platform';
import * as vault from './vault';

// Encrypted per-user cache in localStorage. Names: luna_offline_<sha256(email) hex>_<name>.
// Offline caching is native-only (the vault key needs secure storage); on web every call is a no-op.
const PREFIX = 'luna_offline_';
let chain = Promise.resolve();
let lastError = null;

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

export async function emailHash(email) {
  const data = new TextEncoder().encode(String(email || '').trim().toLowerCase());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const keyFor = (hash, name) => `${PREFIX}${hash}_${name}`;

export const lastStoreError = () => lastError;

export async function read(email, name) {
  if (!isNative()) return null;
  try {
    const hash = await emailHash(email);
    const blob = localStorage.getItem(keyFor(hash, name));
    return blob ? await vault.open(blob, hash) : null;
  } catch (e) { return null; }
}

export function write(email, name, value) {
  if (!isNative()) return Promise.resolve();
  return enqueue(async () => {
    try {
      const hash = await emailHash(email);
      localStorage.setItem(keyFor(hash, name), await vault.seal(value, hash));
      lastError = null;
    } catch (e) { lastError = e; }
  });
}

export function remove(email, name) {
  return enqueue(async () => {
    try { localStorage.removeItem(keyFor(await emailHash(email), name)); } catch (e) { lastError = e; }
  });
}

function offlineKeys() {
  try { return Object.keys(localStorage).filter(k => k.startsWith(PREFIX)); } catch (e) { return []; }
}

export function clearOthers(email) {
  return enqueue(async () => {
    try {
      const keep = keyFor(await emailHash(email), '');
      offlineKeys().filter(k => !k.startsWith(keep)).forEach(k => localStorage.removeItem(k));
    } catch (e) { lastError = e; }
  });
}

export function clearAll() {
  return enqueue(async () => {
    offlineKeys().forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } });
    await vault.dropKey();
  });
}

// Fire-and-forget for synchronous callers such as clearLocalUserData().
export function clearOfflineData() { clearAll().catch(() => {}); }

export async function __resetForTests() {
  await chain.catch(() => {});
  chain = Promise.resolve();
  lastError = null;
  await vault.dropKey();
}
