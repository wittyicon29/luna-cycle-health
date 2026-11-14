import fs from 'fs';
import path from 'path';

// On Android 15+ (targetSdk 36) the app is edge-to-edge and the WebView is
// padded inside the system bars, so the strips behind the status and
// navigation bars show the Activity window background. It must stay the same
// colour as the page background (--bg in App.js), or a redesign that changes
// one without the other leaves mismatched bands at the top and bottom.

const frontend = path.join(__dirname, '..');
const res = path.join(frontend, 'android', 'app', 'src', 'main', 'res', 'values');
const read = (p) => fs.readFileSync(p, 'utf8');

function pageBackground() {
  const match = read(path.join(__dirname, 'App.js')).match(/--bg:\s*(#[0-9A-Fa-f]{6})\s*;/);
  if (!match) throw new Error('--bg token not found in App.js');
  return match[1].toUpperCase();
}

function colorResource(name) {
  const match = read(path.join(res, 'colors.xml'))
    .match(new RegExp(`<color name="${name}">\\s*(#[0-9A-Fa-f]{6})\\s*</color>`));
  if (!match) throw new Error(`colour ${name} not found in colors.xml`);
  return match[1].toUpperCase();
}

function appThemeItems() {
  const styles = read(path.join(res, 'styles.xml'));
  const theme = styles.match(/<style name="AppTheme\.NoActionBar"[^>]*>([\s\S]*?)<\/style>/);
  if (!theme) throw new Error('AppTheme.NoActionBar not found in styles.xml');
  return theme[1];
}

describe('Android window background', () => {
  test('luna_window_background equals the web --bg token', () => {
    expect(colorResource('luna_window_background')).toBe(pageBackground());
  });

  test('AppTheme.NoActionBar paints the window, status and navigation bars with it', () => {
    const items = appThemeItems();
    expect(items).toMatch(/<item name="android:windowBackground">@color\/luna_window_background<\/item>/);
    expect(items).toMatch(/<item name="android:statusBarColor">@color\/luna_window_background<\/item>/);
    expect(items).toMatch(/<item name="android:navigationBarColor">@color\/luna_window_background<\/item>/);
    expect(items).not.toMatch(/android:background/);
  });
});
