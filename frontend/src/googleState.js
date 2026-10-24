const KEY = 'luna_google_state';

function randomHex() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// OAuth `state`: parked in sessionStorage before leaving for Google and compared (once) on return.
export function newGoogleState() {
  const value = randomHex();
  try {
    sessionStorage.setItem(KEY, value);
  } catch (e) {
    // Storage unavailable: the callback will fail verification and the user can try again.
  }
  return value;
}

export function takeGoogleState() {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value || null;
  } catch (e) {
    return null;
  }
}

export function buildGoogleRedirect(authUrl, state) {
  const url = new URL(authUrl);
  url.searchParams.set('state', state);
  return url.toString();
}
