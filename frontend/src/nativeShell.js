import { isNative } from './platform';

// Screens where Back should leave the app. App.js moves between these with
// history.pushState, so history.back() would be a no-op or reload the page there.
const ROOT_PATHS = ['/', '/landing', '/app', '/login', '/register'];

export async function initNativeShell() {
  if (!isNative()) return;
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);
  try {
    await App.addListener('backButton', () => {
      const path = window.location.pathname.replace(/(.)\/+$/, '$1');
      if (ROOT_PATHS.includes(path)) App.minimizeApp();
      else window.history.back();
    });
  } catch (e) { /* keep going: styling and splash must still run */ }
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#1A0F2E' });
  } catch (e) { /* not supported on this Android version */ }
  try {
    await SplashScreen.hide();
  } catch (e) { /* splash auto-hides after launchShowDuration */ }
}
