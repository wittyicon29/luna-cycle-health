/* global globalThis */
// AES-GCM vault for the offline cache. The random 256-bit key lives only in the platform secure
// storage; blobs are `v1.<b64 iv>.<b64 ciphertext>` with the namespace hash bound as additional data.
import { isNative } from '../platform';

const KEY_NAME = 'luna_vault_key';
const subtle = () => globalThis.crypto.subtle;
const enc = s => new TextEncoder().encode(s);

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(out);
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

let cachedKey = null;
let inflight = null; // tail of the serialised key loads

// The plugin object is a Capacitor Proxy whose `then` throws on native: resolve with a plain wrapper.
async function secure() {
  const { SecureStorage: plugin } = await import('@aparajita/capacitor-secure-storage');
  return { get: k => plugin.get(k), set: (k, v) => plugin.set(k, v), remove: k => plugin.remove(k) };
}

// A key is created only when storage answered "no value"; a failed read never creates one, so an
// existing key (and the data sealed with it) cannot be silently replaced.
async function loadOnce(create) {
  if (cachedKey) return cachedKey;
  try {
    const storage = await secure();
    let raw = await storage.get(KEY_NAME);
    if (!raw) {
      if (!create) return null;
      raw = b64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
      await storage.set(KEY_NAME, raw);
    }
    cachedKey = await subtle().importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return cachedKey;
  } catch (e) { return null; }
}

// Loads run one at a time so a concurrent open (no create) and seal (create) cannot race.
function loadKey(create) {
  const run = (inflight || Promise.resolve()).then(() => loadOnce(create));
  inflight = run.catch(() => null);
  return run;
}

export async function seal(value, aad) {
  const key = await loadKey(true);
  if (!key) throw new Error('vault unavailable');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc(aad) }, key, enc(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function open(blob, aad) {
  try {
    const [v, ivB, ctB] = String(blob).split('.');
    if (v !== 'v1') return null;
    const key = await loadKey(false);
    if (!key) return null;
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(ivB), additionalData: enc(aad) }, key, unb64(ctB));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) { return null; }
}

export async function dropKey() {
  try { await inflight; } catch (e) { /* ignore */ }
  cachedKey = null;
  if (!isNative()) return;
  try { await (await secure()).remove(KEY_NAME); } catch (e) { /* nothing to remove */ }
}

// Forget the in-memory key only (simulates an app restart).
export function __resetCacheForTests() { cachedKey = null; inflight = null; }
