import fs from 'fs';
import path from 'path';

// Edge-to-edge on Capacitor 8 depends on three settings staying as they are: SystemBars pads the WebView
// itself (insetsHandling 'css'), the removed Capacitor 7 options stay removed, and the page does not opt in
// to viewport-fit=cover.

const frontend = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(frontend, 'capacitor.config.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(frontend, 'public', 'index.html'), 'utf8');

test('SystemBars handles the insets', () => {
  const insets = config.plugins && config.plugins.SystemBars && config.plugins.SystemBars.insetsHandling;
  if (insets !== 'css') {
    throw new Error(`plugins.SystemBars.insetsHandling is ${insets}, expected 'css': the app has no safe-area CSS.`);
  }
});

test('removed Capacitor 7 options stay removed', () => {
  const keyboard = (config.plugins && config.plugins.Keyboard) || {};
  if ('resizeOnFullScreen' in keyboard) {
    throw new Error('Keyboard.resizeOnFullScreen does nothing on Capacitor 8 with SystemBars; keep it out.');
  }
  const android = config.android || {};
  if ('adjustMarginsForEdgeToEdge' in android) {
    throw new Error('android.adjustMarginsForEdgeToEdge was removed in Capacitor 8; SystemBars replaces it.');
  }
});

test('the page does not use viewport-fit=cover', () => {
  if (/viewport-fit\s*=\s*cover/i.test(indexHtml)) {
    throw new Error(
      'public/index.html sets viewport-fit=cover: SystemBars skips the decor padding on WebView 140+ when cover ' +
        'is set, which would put the dock and top bar under the system bars. Adopting cover needs safe-area CSS ' +
        'and a new inset probe.',
    );
  }
});
