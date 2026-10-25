import { clearSession } from './tokenStore';
import { resetPlayful } from './playful/playfulPrefs';

// Everything the app keeps on the device for a signed-in user.
export function clearLocalUserData() {
  clearSession();
  Object.keys(localStorage)
    .filter(key => key.startsWith('luna_'))
    .forEach(key => localStorage.removeItem(key));
  resetPlayful();
  ['luna_google_state', 'luna_google_consent'].forEach(key => {
    try { sessionStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  });
}
