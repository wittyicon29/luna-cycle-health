#!/usr/bin/env node
// Edge-to-edge layout probe (manual, not run in CI).
//
// Measures the fixed / edge-anchored parts of the signed-in shell (top bar,
// bottom dock, a bottom drawer, a modal footer) at phone viewports, in English
// and Hindi, twice: with the Capacitor SystemBars CSS variables
// (--safe-area-inset-*) set to 24/0/48/0 px (top/right/bottom/left) on :root,
// and with them all at 0. For each element it prints the bounding box and
// whether the box overlaps the top 24 px or the bottom 48 px of the viewport.
//
// How to read the result: Luna does not use viewport-fit=cover, so on Android
// the SystemBars plugin pads the WebView inside the system bars and the
// browser viewport here equals the WebView area on the device. The overlap
// columns therefore say what WOULD sit under a bar if the page ever switched
// to viewport-fit=cover; with the current design nothing can. If the boxes
// with insets 24/48 equal the boxes with insets 0, nothing in the page reads
// the variables (expected today).
//
// Usage (dev server already running, any API base; the probe stubs the API):
//   cd frontend && BROWSER=none REACT_APP_API_BASE=https://api.example.com npm start
//   PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright/index.mjs \
//   [CHROMIUM_PATH=/abs/path/to/chrome] node scripts/probe-insets.mjs http://localhost:3000
// Playwright is not a project dependency on purpose; install it anywhere
// outside the repo and point PLAYWRIGHT_MODULE at it.

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/probe-insets.mjs <dev-server-url>');
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const VIEWPORTS = [[320, 568], [360, 640], [412, 915]];
const LANGS = ['en', 'hi'];
const INSETS = [{ top: 0, right: 0, bottom: 0, left: 0 }, { top: 24, right: 0, bottom: 48, left: 0 }];
const STRIP_TOP = 24;
const STRIP_BOTTOM = 48;
const EMAIL = 'probe@example.com';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
function stub(path) {
  if (path.startsWith('/consents')) return { terms_privacy: true, age_18_plus: true, ai_processing: false };
  if (path.startsWith('/auth/status')) return { has_completed_questionnaire: true, email_verified: true };
  if (/^\/(periods|logs|medications|reminders)\/?(\?|$)/.test(path)) return [];
  return {};
}

async function box(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  const b = await el.boundingBox();
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

function row(lang, [w, h], inset, name, b) {
  const ins = `${inset.top}/${inset.bottom}`;
  if (!b) return `| ${lang} | ${w}x${h} | ${ins} | ${name} | not reached | - | - |`;
  const top = b.y < STRIP_TOP ? 'yes' : 'no';
  const bottom = b.y + b.h > h - STRIP_BOTTOM ? 'yes' : 'no';
  return `| ${lang} | ${w}x${h} | ${ins} | ${name} | ${b.x},${b.y} ${b.w}x${b.h} | ${top} | ${bottom} |`;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const rows = [];
const pageErrors = [];
for (const lang of LANGS) {
  for (const vp of VIEWPORTS) {
    for (const inset of INSETS) {
      const context = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2 });
      await context.addInitScript(([email, language]) => {
        localStorage.setItem('access_token', 'probe');
        localStorage.setItem('refresh_token', 'probe');
        localStorage.setItem('email', email);
        localStorage.setItem(`luna_onboarding_done_${email}`, '1');
        localStorage.setItem('luna_language', language);
      }, [EMAIL, lang]);
      const page = await context.newPage();
      page.on('pageerror', (e) => pageErrors.push(`${lang} ${vp.join('x')}: ${e.message}`));
      await page.route((u) => !u.href.startsWith(url), (route) => {
        const u = new URL(route.request().url());
        if (/\/api\/v1\//.test(u.pathname) || u.hostname === 'api.example.com') {
          return route.fulfill(json(stub(u.pathname.replace(/^.*\/api\/v1/, '') + u.search)));
        }
        return route.abort(); // fonts, analytics, anything external: not needed for layout
      });
      const setInsets = () => page.evaluate((i) => {
        for (const side of ['top', 'right', 'bottom', 'left']) {
          document.documentElement.style.setProperty(`--safe-area-inset-${side}`, `${i[side]}px`);
        }
      }, inset);

      await page.goto(`${url.replace(/\/$/, '')}/app`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.dock', { timeout: 15000 }).catch(() => {});
      await setInsets();
      rows.push(row(lang, vp, inset, 'top bar (.topbar)', await box(page, '.topbar')));
      rows.push(row(lang, vp, inset, 'dock (.dock)', await box(page, '.dock')));

      // A bottom drawer: the Calendar dock tab.
      const dockButtons = await page.$$('.dock .dk');
      if (dockButtons[1]) {
        await dockButtons[1].click();
        await page.waitForSelector('.drawer', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500); // drawIn animation
        await setInsets();
      }
      rows.push(row(lang, vp, inset, 'drawer (.drawer, Calendar)', await box(page, '.drawer')));

      // A modal footer: the AI consent modal behind the Chat dock tab.
      await page.goto(`${url.replace(/\/$/, '')}/app`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.dock', { timeout: 15000 }).catch(() => {});
      await setInsets();
      const again = await page.$$('.dock .dk');
      if (again[3]) {
        await again[3].click();
        await page.waitForSelector('.modal-foot', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      rows.push(row(lang, vp, inset, 'modal footer (.modal-foot, AI consent)', await box(page, '.modal-foot')));
      await context.close();
    }
  }
}
await browser.close();

console.log(`Strips: top ${STRIP_TOP} px, bottom ${STRIP_BOTTOM} px. Insets column: --safe-area-inset-top/bottom in px.`);
console.log('| lang | viewport | insets | element | box x,y wxh | overlaps top strip | overlaps bottom strip |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
if (pageErrors.length) {
  console.log('\nPage errors:');
  for (const e of [...new Set(pageErrors)]) console.log(`- ${e}`);
}
