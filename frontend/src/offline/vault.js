/* global globalThis */
// AES-GCM vault for the offline cache. The random 256-bit key lives only in the platform secure
// storage; blobs are `v1.<b64 iv>.<b64 ciphertext>` with the namespace hash bound as additional data.
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

let keyPromise = null;

// The plugin object is a Capacitor Proxy whose `then` throws on native: resolve with a plain wrapper.
async function secure() {
  const { SecureStorage: plugin } = await import('@aparajita/capacitor-secure-storage');
  return { get: k => plugin.get(k), set: (k, v) => plugin.set(k, v), remove: k => plugin.remove(k) };
}

async function loadKey(create) {
  if (keyPromise) return keyPromise;
  const attempt = (async () => {
    const storage = await secure();
    let raw = null;
    try { raw = await storage.get(KEY_NAME); } catch (e) { raw = null; }
    if (!raw && create) {
      raw = b64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
      await storage.set(KEY_NAME, raw);
    }
    if (!raw) return null;
    return subtle().importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  })().catch(() => null);
  keyPromise = attempt;
  const key = await attempt;
  if (!key && keyPromise === attempt) keyPromise = null; // allow a later seal to create one
  return key;
}

export async function seal(value, emailHash) {
  const key = await loadKey(true);
  if (!key) throw new Error('vault unavailable');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc(emailHash) }, key, enc(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function open(blob, emailHash) {
  try {
    const [v, ivB, ctB] = String(blob).split('.');
    if (v !== 'v1') return null;
    const key = await loadKey(false);
    if (!key) return null;
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(ivB), additionalData: enc(emailHash) }, key, unb64(ctB));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) { return null; }
}

export async function dropKey() {
  keyPromise = null;
  try { await (await secure()).remove(KEY_NAME); } catch (e) { /* nothing to remove */ }
}
