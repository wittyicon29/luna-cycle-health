import fs from 'fs';
import path from 'path';

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('the page has a real title, description and theme colour', () => {
  const html = read('public/index.html');

  expect(html).toMatch(/<title>Luna Health[^<]*<\/title>/);
  expect(html).not.toMatch(/Web site created using create-react-app/);
  expect(html).toMatch(/name="description"\s+content="[^"]*cycle/i);
  expect(html).toMatch(/name="theme-color"\s+content="#1A0F2E"/i);
});

test('the web manifest is branded', () => {
  const manifest = JSON.parse(read('public/manifest.json'));

  expect(manifest.short_name).toBe('Luna');
  expect(manifest.name).toBe('Luna Health');
  expect(manifest.theme_color.toUpperCase()).toBe('#1A0F2E');
  expect(manifest.background_color.toUpperCase()).toBe('#1A0F2E');
});

test('interactive elements keep a visible keyboard focus ring', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/(^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid #E8A09A/);
  expect(app).toMatch(/:focus:not\(:focus-visible\)\s*\{[^}]*outline:\s*none/);
  expect(app).toMatch(/\.f input:focus-visible[^{]*\{[^}]*outline:\s*2px solid/);
  expect(app).toMatch(/\.chat-in textarea:focus-visible[^{]*\{[^}]*outline:\s*2px solid/);
});

test('reduced motion keeps the loading spinner moving and the avatar is labelled', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/prefers-reduced-motion[\s\S]*\.spinner\{[^}]*animation-duration:\.6s/);
  expect(app).toMatch(/className="avatar-btn"[^>]*aria-label="Open profile"|aria-label="Open profile"[^>]*className="avatar-btn"/);
});

test('small controls are at least 44px to tap', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/\.drawer-close\{[^}]*min-width:44px[^}]*min-height:44px/);
  expect(app).toMatch(/\.avatar-btn\{[^}]*(width:44px|min-width:44px)/);
  expect(app).toMatch(/\.btn-sm\{[^}]*min-height:44px/);
});
