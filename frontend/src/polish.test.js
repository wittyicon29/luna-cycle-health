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
  expect(app).toMatch(/className="avatar-btn"[^>]*aria-label=(?:"Open profile"|\{t\("Open profile"\)\})|aria-label=(?:"Open profile"|\{t\("Open profile"\)\})[^>]*className="avatar-btn"/);
});

test('small controls are at least 44px to tap', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/\.drawer-close\{[^}]*min-width:44px[^}]*min-height:44px/);
  expect(app).toMatch(/\.avatar-btn\{[^}]*(width:44px|min-width:44px)/);
  expect(app).toMatch(/\.btn-sm\{[^}]*min-height:44px/);
});

test('close buttons and the new-chat button have a 44px hit area and a label', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/\.mk-card-close\{[^}]*min-width:44px[^}]*min-height:44px/);
  expect(app).toMatch(/\.modal-close\{[^}]*min-width:44px[^}]*min-height:44px/);
  expect(app).toMatch(/\.new-chat-btn\{[^}]*min-width:44px[^}]*min-height:44px/);
  expect(app).toMatch(/className="modal-close"[^>]*aria-label=(?:"Close"|\{t\("Close"\)\})|aria-label=(?:"Close"|\{t\("Close"\)\})[^>]*className="modal-close"/);
  expect(app).toMatch(/className="mk-card-close"[^>]*aria-label=(?:"Close"|\{t\("Close"\)\})|aria-label=(?:"Close"|\{t\("Close"\)\})[^>]*className="mk-card-close"/);
  expect(app).toMatch(/aria-label=(?:"New chat"|\{t\("New chat"\)\})/);
  expect(app.match(/className="drawer-close"[^>]*aria-label=(?:"Close"|\{t\("Close"\)\})/g)).toHaveLength(3);
});

test('symptom chips are at least 40px tall', () => {
  expect(read('src/App.js')).toMatch(/\.chip\{[^}]*min-height:40px/);
});

test('the Phase stat shrinks and truncates instead of overflowing its cell', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/\.st-item\{[^}]*min-width:0/);
  expect(app).toMatch(/\.st-val-phase\{[^}]*font-size:\.85rem[^}]*overflow:hidden[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  expect(app).toMatch(/className="st-val st-val-phase"/);
});

test('marker card first rows leave room for the close button', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/\.mk-card-head\{[^}]*padding-right:48px/);
  expect(app.match(/className="mk-card-head"/g).length).toBeGreaterThanOrEqual(2);
});

test('the chat header hides the AI companion label on narrow screens', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/@media\(max-width:400px\)\{[^}]*\.chat-ai-label\{display:none/);
  expect(app).toMatch(/className="chat-ai-label"/);
});

const rule = (css, selector) => {
  const esc = selector.replace(/[.]/g, '\\.');
  const m = css.match(new RegExp('(^|\\n)' + esc + '\\{([^}]*)\\}'));
  return m ? m[2] : '';
};

test('auth wrapper cannot scroll sideways, has a gutter, and the card is fluid', () => {
  const app = read('src/App.js');
  const wrap = rule(app, '.auth-wrap');

  expect(wrap).toMatch(/overflow:\s*hidden/);
  expect(wrap).toMatch(/overflow:\s*clip/);
  expect(wrap).toMatch(/padding:\s*1rem/);
  expect(wrap).toMatch(/overflow-y:\s*auto/);
  expect(wrap).toMatch(/overflow-x:\s*clip/);
  expect(rule(app, '.auth-card')).toMatch(/margin:\s*auto/);
  expect(rule(app, '.auth-card')).toMatch(/width:\s*100%/);
});

test('marker card is width-limited and wraps its text', () => {
  const card = rule(read('src/App.js'), '.mk-card');

  expect(card).toMatch(/max-width:\s*min\(280px,\s*calc\(100vw - 16px\)\)/);
  expect(card).toMatch(/overflow-wrap:\s*anywhere/);
  expect(card).toMatch(/white-space:\s*normal/);
});

test('period markers have a 44px hit area without changing the dot', () => {
  const app = read('src/App.js');

  expect(rule(app, '.p-dot')).toMatch(/position:\s*absolute/);
  expect(app).toMatch(/\.p-dot::before\{[^}]*content:""[^}]*position:absolute[^}]*inset:-20px/);
});

test('Insights tiles use lining numerals in the sans font', () => {
  const val = rule(read('src/App.js'), '.pred-val');

  expect(val).toMatch(/font-family:'Outfit','Noto Sans Devanagari',sans-serif/);
  expect(val).toMatch(/font-variant-numeric:\s*lining-nums/);
});

test('welcome tour Skip is a real ghost button and the header row can wrap', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/<button[^>]*className="btn btn-g btn-sm"[^>]*onClick=\{finish\}[^>]*>(?:Skip|\{t\("Skip"\)\})<\/button>/);
  expect(app).toMatch(/justifyContent: "space-between", alignItems: "center", flexWrap: "wrap"/);
});

test('profile buttons separate the emoji from the label', () => {
  const app = read('src/App.js');

  expect(app).toMatch(/<span aria-hidden="true" className="btn-ico">📋<\/span>/);
  expect(app).toMatch(/<span aria-hidden="true" className="btn-ico">⏻<\/span>/);
  expect(rule(app, '.btn-ico')).toMatch(/margin-right:\s*\.6rem/);
});
