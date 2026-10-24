import { GOOGLE_WEB_CLIENT_ID } from './config';

let initialized = false;

export async function signInWithGoogleNative() {
  if (!GOOGLE_WEB_CLIENT_ID) throw new Error('Google sign-in is not configured');
  try {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    if (!initialized) {
      await SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } });
      initialized = true;
    }
    const res = await SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'] } });
    const idToken = res && res.result && res.result.idToken;
    if (!idToken) throw new Error('missing token');
    return idToken;
  } catch (e) {
    // Never surface the plugin's message: it can carry account hints.
    if (/cancel/i.test(String(e && e.message))) throw new Error('Google sign-in was cancelled');
    throw new Error('Google sign-in failed');
  }
}
