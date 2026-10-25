/* global globalThis */
import { isNative } from '../platform';
import * as vault from './vault';

// Encrypted per-user cache in localStorage. Names: luna_offline_<sha256(email) hex>_<name>.
// Offline caching is native-only (the vault key needs secure storage); on web every call is a no-op.
const PREFIX = 'luna_offline_';
let chain = Promise.resolve();
let lastError = null;
let generation = 0; // bumped by clearAll so earlier-queued tasks are dropped

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
const aadFor = (hash, name) => `${hash}|${name}`;
const usable = email => isNative() && typeof email === 'string' && email.trim() !== '';

export const lastStoreError = () => lastError;

// status: 'ok' (decrypted), 'empty' (nothing cached) or 'unreadable' (a blob exists but cannot be opened).
export async function readDetailed(email, name) {
  if (!usable(email)) return { value: null, status: 'empty' };
  try {
    const hash = await emailHash(email);
    const blob = localStorage.getItem(keyFor(hash, name));
    if (!blob) return { value: null, status: 'empty' };
    const value = await vault.open(blob, aadFor(hash, name));
    if (value === null) {
      lastError = new Error('offline cache unreadable');
      return { value: null, status: 'unreadable' };
    }
    return { value, status: 'ok' };
  } catch (e) { return { value: null, status: 'empty' }; }
}

export async function read(email, name) {
  return (await readDetailed(email, name)).value;
}

// A task queued before clearAll() must not run afterwards (it would recreate data or the key).
function enqueueGuarded(task) {
  const queuedAt = generation;
  return enqueue(async () => { if (generation === queuedAt) await task(); });
}

export function write(email, name, value) {
  if (!usable(email)) return Promise.resolve();
  return enqueueGuarded(async () => {
    let key = null;
    try {
      const hash = await emailHash(email);
      key = keyFor(hash, name);
      localStorage.setItem(key, await vault.seal(value, aadFor(hash, name)));
      lastError = null;
    } catch (e) {
      lastError = e;
      // Never leave the previous blob behind: stale data (e.g. synced outbox items) must not return.
      if (key) { try { localStorage.removeItem(key); } catch (e2) { /* storage unavailable */ } }
    }
  });
}

export function remove(email, name) {
  if (!usable(email)) return Promise.resolve();
  return enqueueGuarded(async () => {
    try { localStorage.removeItem(keyFor(await emailHash(email), name)); } catch (e) { lastError = e; }
  });
}

function offlineKeys() {
  try { return Object.keys(localStorage).filter(k => k.startsWith(PREFIX)); } catch (e) { return []; }
}

export function clearOthers(email) {
  if (!usable(email)) return Promise.resolve();
  return enqueueGuarded(async () => {
    try {
      const keep = keyFor(await emailHash(email), '');
      offlineKeys().filter(k => !k.startsWith(keep)).forEach(k => localStorage.removeItem(k));
    } catch (e) { lastError = e; }
  });
}

export function clearAll() {
  generation += 1;
  return enqueue(async () => {
    offlineKeys().forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } });
    await vault.dropKey(); // no-op for the plugin on web
  });
}

// Fire-and-forget for synchronous callers such as clearLocalUserData().
export function clearOfflineData() { clearAll().catch(() => {}); }

// Resolves once everything queued so far has run (lets tests await the chain).
export function __flush() { return enqueue(async () => {}); }

export async function __resetForTests() {
  await chain.catch(() => {});
  chain = Promise.resolve();
  lastError = null;
  generation = 0;
  vault.__resetCacheForTests();
  await vault.dropKey();
}
