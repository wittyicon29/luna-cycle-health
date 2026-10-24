import { isNative } from './platform';

export async function initNativeShell() {
  if (!isNative()) return;
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);
  try {
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else App.minimizeApp();
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
