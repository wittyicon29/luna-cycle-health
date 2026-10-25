const fs = require('fs');
const path = require('path');
const hi = require('./i18n/catalogs/hi.json');
const { serverMessageCatalog } = require('./serverMessages');

const API_DIR = path.join(__dirname, '..', '..', 'backend', 'app', 'api');

// Messages deliberately left English, with the reason each is not shown to a person.
const NOT_USER_FACING = {
  'Invalid analysis type': 'the app only requests fixed analysis types; a bad value is a programming error',
  'Invalid or expired refresh token': 'handled by the session-expiry flow (silent sign-out), the text is never rendered',
  'Invalid token': 'access-token failure leads to the refresh / session-expiry flow, the text is never rendered',
  'Invalid user ID': 'malformed access token, treated as session expiry, the text is never rendered',
  'User not found': 'token for a deleted user, treated as session expiry, the text is never rendered',
};

const PY_STRING = /(?:detail\s*=\s*|"message"\s*:\s*)(["'])((?:\\.|(?!\1).)*)\1/g;
const DETAIL_CONST = /detail\s*=\s*([A-Z][A-Z0-9_]*)\s*[,)\n]/g;

function pyValue(raw) {
  return raw.replace(/\\(["'\\])/g, '$1');
}

function backendMessages() {
  const found = new Map();
  fs.readdirSync(API_DIR).filter(f => f.endsWith('.py')).forEach(file => {
    const src = fs.readFileSync(path.join(API_DIR, file), 'utf8');
    let m;
    PY_STRING.lastIndex = 0;
    while ((m = PY_STRING.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 1), m.index);
      if (/[fFrRbB]/.test(before) && m[0].startsWith('detail') === false) continue;
      found.set(pyValue(m[2]), file);
    }
    DETAIL_CONST.lastIndex = 0;
    while ((m = DETAIL_CONST.exec(src))) {
      const def = new RegExp(`^${m[1]}\\s*=\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`, 'm').exec(src);
      if (def) found.set(pyValue(def[2]), file);
    }
  });
  return found;
}

const messages = backendMessages();

test('the extractor finds the backend messages', () => {
  expect(messages.size).toBeGreaterThan(30);
  expect(messages.has('Email already registered')).toBe(true);
  expect(messages.has("You've reached today's chat limit. It resets at midnight IST.")).toBe(true);
  expect(messages.has('Log at least two periods (about a month apart) so Luna can find your pattern.')).toBe(true);
});

test('every static backend message is translated or explicitly allow-listed', () => {
  const untracked = [...messages.keys()].filter(text => !hi[text] && !NOT_USER_FACING[text]);
  expect(untracked).toEqual([]);
  const translated = [...messages.keys()].filter(text => hi[text]).length;
  const allowListed = [...messages.keys()].filter(text => !hi[text] && NOT_USER_FACING[text]).length;
  expect({ translated: translated > 0, allowListed }).toEqual({ translated: true, allowListed: Object.keys(NOT_USER_FACING).length });
});

test('the allow-list holds only messages the backend still sends', () => {
  Object.keys(NOT_USER_FACING).forEach(text => expect(messages.has(text)).toBe(true));
});

test('serverMessageCatalog (which feeds i18n:check) lists every translated backend message', () => {
  const listed = new Set(serverMessageCatalog());
  const translated = [...messages.keys()].filter(text => hi[text]);
  expect(translated.filter(text => !listed.has(text))).toEqual([]);
});
