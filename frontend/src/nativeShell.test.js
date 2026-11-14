import { initNativeShell } from './nativeShell';
import { isNative } from './platform';
import fs from 'fs';
import path from 'path';
import { App } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('@capacitor/core', () => ({
  ...jest.requireActual('@capacitor/core'),
  SystemBars: { setStyle: jest.fn() },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));
jest.mock('@capacitor/splash-screen', () => ({
  SplashScreen: { hide: jest.fn() },
}));

describe('initNativeShell', () => {
  beforeEach(() => jest.clearAllMocks());

  test('is a no-op on web', async () => {
    isNative.mockReturnValue(false);
    await initNativeShell();
    expect(App.addListener).not.toHaveBeenCalled();
    expect(SystemBars.setStyle).not.toHaveBeenCalled();
    expect(SplashScreen.hide).not.toHaveBeenCalled();
  });

  test('registers one backButton listener on native', async () => {
    isNative.mockReturnValue(true);
    await initNativeShell();
    expect(App.addListener).toHaveBeenCalledTimes(1);
    expect(App.addListener.mock.calls[0][0]).toBe('backButton');
  });

  test.each(['/', '/landing', '/app', '/login', '/register', '/app/'])(
    'back button minimizes on root path %s', async (path) => {
      isNative.mockReturnValue(true);
      window.history.pushState({}, '', path);
      const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
      await initNativeShell();
      App.addListener.mock.calls[0][1]({ canGoBack: true });
      expect(App.minimizeApp).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
      back.mockRestore();
    });

  test.each(['/privacy', '/terms', '/verify-email', '/reset-password'])(
    'back button goes back in history on %s', async (path) => {
      isNative.mockReturnValue(true);
      window.history.pushState({}, '', path);
      const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
      await initNativeShell();
      App.addListener.mock.calls[0][1]({ canGoBack: false });
      expect(back).toHaveBeenCalledTimes(1);
      expect(App.minimizeApp).not.toHaveBeenCalled();
      back.mockRestore();
    });

  test('styles the system bars and hides the splash', async () => {
    isNative.mockReturnValue(true);
    await initNativeShell();
    expect(SystemBars.setStyle).toHaveBeenCalledWith({ style: SystemBarsStyle.Dark });
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  test('does not import the retired @capacitor/status-bar plugin', () => {
    // Its setBackgroundColor does nothing under Android 15+ edge-to-edge; the
    // strips behind the bars show the Activity window background instead.
    const source = fs.readFileSync(path.join(__dirname, 'nativeShell.js'), 'utf8');
    expect(source).not.toMatch(/@capacitor\/status-bar/);
  });

  test('still hides splash if the system bars call is unsupported', async () => {
    isNative.mockReturnValue(true);
    SystemBars.setStyle.mockRejectedValueOnce(new Error('unsupported'));
    await initNativeShell();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  test('a rejecting splash hide does not break back-button registration or resolve with error', async () => {
    isNative.mockReturnValue(true);
    SplashScreen.hide.mockRejectedValueOnce(new Error('boom'));
    await expect(initNativeShell()).resolves.toBeUndefined();
    expect(App.addListener).toHaveBeenCalledTimes(1);
  });

  test('a rejecting addListener does not skip system bars and splash', async () => {
    isNative.mockReturnValue(true);
    App.addListener.mockRejectedValueOnce(new Error('boom'));
    await initNativeShell();
    expect(SystemBars.setStyle).toHaveBeenCalled();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });
});
