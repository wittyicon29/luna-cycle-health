const KEY = 'luna_google_consent';

// The Google sign-in round trip leaves the app, so the sign-up checkboxes are parked in
// sessionStorage and read back (once) by the callback page.
export function saveGoogleConsent({ accepted, adult }) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ accepted: !!accepted, adult: !!adult }));
  } catch (e) {
    // Storage unavailable (private mode): the user will be asked again on the callback page.
  }
}

export function takeGoogleConsent() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const value = raw ? JSON.parse(raw) : {};
    return { accepted: value.accepted === true, adult: value.adult === true };
  } catch (e) {
    return { accepted: false, adult: false };
  }
}
