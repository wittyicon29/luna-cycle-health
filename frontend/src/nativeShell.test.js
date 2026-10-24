import { initNativeShell } from './nativeShell';
import { isNative } from './platform';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: jest.fn(), setBackgroundColor: jest.fn() },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
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
    expect(StatusBar.setStyle).not.toHaveBeenCalled();
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

  test('styles the status bar and hides the splash', async () => {
    isNative.mockReturnValue(true);
    await initNativeShell();
    expect(StatusBar.setStyle).toHaveBeenCalledWith({ style: Style.Dark });
    expect(StatusBar.setBackgroundColor).toHaveBeenCalledWith({ color: '#1A0F2E' });
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  test('still hides splash if status bar is unsupported', async () => {
    isNative.mockReturnValue(true);
    StatusBar.setStyle.mockRejectedValueOnce(new Error('unsupported'));
    await initNativeShell();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  test('a rejecting splash hide does not break back-button registration or resolve with error', async () => {
    isNative.mockReturnValue(true);
    SplashScreen.hide.mockRejectedValueOnce(new Error('boom'));
    await expect(initNativeShell()).resolves.toBeUndefined();
    expect(App.addListener).toHaveBeenCalledTimes(1);
  });

  test('a rejecting addListener does not skip status bar and splash', async () => {
    isNative.mockReturnValue(true);
    App.addListener.mockRejectedValueOnce(new Error('boom'));
    await initNativeShell();
    expect(StatusBar.setStyle).toHaveBeenCalled();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });
});
