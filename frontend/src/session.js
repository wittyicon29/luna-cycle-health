// Everything the app keeps on the device for a signed-in user.
export function clearLocalUserData() {
  ['access_token', 'refresh_token', 'email'].forEach(key => localStorage.removeItem(key));
  Object.keys(localStorage)
    .filter(key => key.startsWith('luna_'))
    .forEach(key => localStorage.removeItem(key));
}
