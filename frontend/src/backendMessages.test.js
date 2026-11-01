const fs = require('fs');
const path = require('path');
const hi = require('./i18n/catalogs/hi.json');
const { serverMessageCatalog } = require('./serverMessages');

const APP_DIR = path.join(__dirname, '..', '..', 'backend', 'app');
const DIRS = ['api', 'schemas', 'services', 'services/billing'];

// Messages deliberately left English, with the reason each is not shown to a person.
const NOT_USER_FACING = {
  'Invalid analysis type': 'the app only requests fixed analysis types; a bad value is a programming error',
  'Invalid or expired refresh token': 'handled by the session-expiry flow (silent sign-out), the text is never rendered',
  'Invalid token': 'access-token failure leads to the refresh / session-expiry flow, the text is never rendered',
  'Invalid user ID': 'malformed access token, treated as session expiry, the text is never rendered',
  'We need at least 2 completed cycles to make predictions. Continue tracking to build your pattern.': 'internal prediction-service result; the periods API drops it and returns an empty prediction',
  'Billing is not enabled': 'the app only calls /billing/verify when /billing/status says billing is enabled; the text is never rendered',
  'Period id is already in use': 'only the offline sync engine sends client period ids; it treats this as an id conflict and drops the queued item, the text is never rendered',
  'User not found': 'token for a deleted user, treated as session expiry, the text is never rendered',
  'timestamp is not a string': 'internal Google Play response parsing error (services/billing/google.py); caught and turned into a verifier error, never sent to the app',
  'timestamp has no offset': 'internal Google Play response parsing error (services/billing/google.py); caught and turned into a verifier error, never sent to the app',
};

const PY_ESCAPES = { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" };

// Reads one or more adjacent Python string literals (implicit concatenation, possibly across lines and inside
// parentheses) starting at pos. Returns the joined value, or null when there is none or any part is an f-string.
function readPyStrings(src, pos) {
  let i = pos;
  let value = '';
  let count = 0;
  for (;;) {
    while (i < src.length && /[\s(]/.test(src[i])) i++;
    const prefix = /^[fFrRbBuU]{1,2}(?=["'])/.exec(src.slice(i, i + 3));
    if (prefix) {
      if (/[fFbB]/.test(prefix[0])) return null;
      i += prefix[0].length;
    }
    const quote = src[i];
    if (quote !== '"' && quote !== "'") break;
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { value += PY_ESCAPES[src[i + 1]] !== undefined ? PY_ESCAPES[src[i + 1]] : src[i + 1]; i += 2; continue; }
      value += src[i++];
    }
    i++;
    count++;
  }
  return count ? value : null;
}

const CONSTANT = name => new RegExp(`^${name}\\s*=`, 'm');
const STARTS = [
  /detail\s*=\s*(?=["'(frFbB])/g, // detail="..." (also parenthesised / concatenated)
  /ValueError\(\s*/g, // pydantic validators
  /HTTPException\(\s*\d+\s*,\s*/g, // positional HTTPException(400, "...")
  /["']message["']\s*:\s*/g, // {"message": "..."}
];

function backendMessages() {
  const found = new Map();
  DIRS.forEach(dir => {
    const full = path.join(APP_DIR, dir);
    fs.readdirSync(full).filter(f => f.endsWith('.py')).forEach(file => {
      const src = fs.readFileSync(path.join(full, file), 'utf8');
      STARTS.forEach(re => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
          const value = readPyStrings(src, m.index + m[0].length);
          if (value) found.set(value, `${dir}/${file}`);
        }
      });
      // detail=SOME_CONSTANT (or `return SOME_CONSTANT` from a helper whose result becomes a detail, as in
      // services/billing/entitlement.py) -> the constant's literal value
      const consts = /(?:detail\s*=\s*|\breturn\s+)([A-Z][A-Z0-9_]*)\b/g;
      let c;
      while ((c = consts.exec(src))) {
        const def = CONSTANT(c[1]).exec(src);
        const value = def ? readPyStrings(src, def.index + def[0].length) : null;
        if (value) found.set(value, `${dir}/${file}`);
      }
    });
  });
  return found;
}

const messages = backendMessages();

test('the extractor finds the backend messages', () => {
  expect(messages.size).toBeGreaterThan(45);
  expect(messages.has('Email already registered')).toBe(true);
  expect(messages.has('Only Gmail addresses are supported for registration')).toBe(true);
  expect(messages.has('Google sign-in could not be verified')).toBe(true);
  expect(messages.has('Note must be at most 1000 characters')).toBe(true);
  expect(messages.has("You've reached today's chat limit. It resets at midnight IST.")).toBe(true);
  expect(messages.has('Log at least two periods (about a month apart) so Luna can find your pattern.')).toBe(true);
  // billing: detail=CONSTANT and a constant returned by a helper (DIFFERENT_ACCOUNT via _mismatch)
  expect(messages.has('Luna AI plan required')).toBe(true);
  expect(messages.has('This purchase is already linked to another account')).toBe(true);
  expect(messages.has('This purchase belongs to a different account')).toBe(true);
  expect(messages.has('Google Play is unavailable right now. Try again.')).toBe(true);
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
