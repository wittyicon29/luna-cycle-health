import { isNative } from './platform';

// Screens where Back should leave the app. App.js moves between these with
// history.pushState, so history.back() would be a no-op or reload the page there.
const ROOT_PATHS = ['/', '/landing', '/app', '/login', '/register'];

export async function initNativeShell() {
  if (!isNative()) return;
  const [{ App }, { SystemBars, SystemBarsStyle }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/core'),
    import('@capacitor/splash-screen'),
  ]);
  try {
    await App.addListener('backButton', () => {
      const path = window.location.pathname.replace(/(.)\/+$/, '$1');
      if (ROOT_PATHS.includes(path)) App.minimizeApp();
      else window.history.back();
    });
  } catch (e) { /* keep going: styling and splash must still run */ }
  // Dark = light icons for the dark page. The strips behind the bars show the
  // Activity window background (styles.xml), kept equal to --bg by a test.
  try {
    await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
  } catch (e) { /* not supported on this Android version */ }
  try {
    await SplashScreen.hide();
  } catch (e) { /* splash auto-hides after launchShowDuration */ }
}
