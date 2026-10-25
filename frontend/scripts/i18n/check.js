/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const SKIP_FILES = new Set(['setupTests.js', 'index.js', 'reportWebVitals.js', 'LandingPage.js', 'LegalPage.js', 'legalContent.js']);

function collect(srcDir, exclude = []) {
  return fs.readdirSync(srcDir)
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && !SKIP_FILES.has(name) && !exclude.includes(name))
    .filter(name => fs.statSync(path.join(srcDir, name)).isFile())
    .sort()
    .map(name => path.join(srcDir, name));
}

const placeholders = text => [...new Set((String(text).match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1)))].sort();
const samePlaceholders = (a, b) => JSON.stringify(placeholders(a)) === JSON.stringify(placeholders(b));

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

// Walks the source once. Returns { code, mask }: `code` is the source with comments blanked (newlines kept, so
// line numbers survive) and `mask[i]` is 1 for characters inside string literals, template-literal text and
// regex literals (so calls "inside" them are not real calls). `${...}` expressions inside templates are code.
// A `/` directly after `}` is never treated as a regex start (so `{n}/10 {t("x")}` and `<A x={y} />` work); the
// price is that a regex literal written right after a closing brace at statement start is not recognised.
// JSX text is NOT tokenised: an apostrophe in JSX text (Don't) is treated as an unterminated string that ends
// at the end of the line, and t( written as plain JSX text may be seen as a call.
function tokenize(source) {
  const n = source.length;
  const out = source.split('');
  const mask = new Uint8Array(n);
  const stack = [];
  const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);
  let lastSig = '';
  let lastWord = '';
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };

  function readTemplate() { // i is just after the backtick or after a closing `}` of ${}
    const start = i;
    while (i < n) {
      const c = source[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; mask.fill(1, start - 1 < 0 ? 0 : start - 1, i); return; }
      if (c === '$' && source[i + 1] === '{') { mask.fill(1, start, i); i += 2; stack.push('tpl'); return; }
      i++;
    }
    mask.fill(1, start, n);
  }

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      let e = source.indexOf('\n', i);
      if (e < 0) e = n;
      blank(i, e); i = e; continue;
    }
    if (c === '/' && d === '*') {
      let e = source.indexOf('*/', i + 2);
      e = e < 0 ? n : e + 2;
      blank(i, e); i = e; continue;
    }
    if (c === "'" || c === '"') {
      const start = i; i++;
      while (i < n && source[i] !== c && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
      if (source[i] === c) i++;
      mask.fill(1, start, Math.min(i, n)); lastSig = c; lastWord = ''; continue;
    }
    if (c === '`') { i++; readTemplate(); lastSig = '`'; lastWord = ''; continue; }
    if (c === '/') {
      // `</tag>` and `<tag ... />` are JSX, never a regex literal.
      // A `/` right after `}` is division or JSX text (`{n}/10 {t("x")}`, `<A x={y} />`), never a regex.
      // `/>` is JSX only when it follows something JSX-ish; after `(`, `,`, `=` ... it is the regex /> /.
      const regexPos = lastSig === '' || (REGEX_PREV.has(lastSig) && lastSig !== '}') || REGEX_WORDS.has(lastWord);
      const jsxSlash = lastSig === '<' || lastSig === '}' || (d === '>' && !regexPos);
      if (!jsxSlash && regexPos) {
        const start = i; i++;
        let inClass = false;
        while (i < n && source[i] !== '\n') {
          const r = source[i];
          if (r === '\\') { i += 2; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) { i++; break; }
          i++;
        }
        mask.fill(1, start, Math.min(i, n)); lastSig = '/'; lastWord = ''; continue;
      }
      lastSig = '/'; lastWord = ''; i++; continue;
    }
    if (c === '{') stack.push('brace');
    if (c === '}') {
      if (stack.pop() === 'tpl') { i++; readTemplate(); lastSig = '`'; lastWord = ''; continue; }
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let e = i;
      while (e < n && /[A-Za-z0-9_$]/.test(source[e])) e++;
      lastWord = source.slice(i, e); lastSig = 'w'; i = e; continue;
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i++;
  }
  return { code: out.join(''), mask };
}

// Decodes one JS escape sequence at source[i] === '\\'. Returns { value, next }.
function readEscape(source, i) {
  const n = source[i + 1];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' };
  if (n === undefined) return { value: '', next: i + 1 };
  if (simple[n] !== undefined) return { value: simple[n], next: i + 2 };
  if (n === '\r') return { value: '', next: source[i + 2] === '\n' ? i + 3 : i + 2 };
  if (n === '\n' || n === ' ' || n === ' ') return { value: '', next: i + 2 };
  if (n === '0' && !/[0-9]/.test(source[i + 2] || '')) return { value: '\0', next: i + 2 };
  if (n === 'x') {
    const h = source.slice(i + 2, i + 4);
    if (/^[0-9a-fA-F]{2}$/.test(h)) return { value: String.fromCharCode(parseInt(h, 16)), next: i + 4 };
  }
  if (n === 'u') {
    if (source[i + 2] === '{') {
      const e = source.indexOf('}', i + 3);
      const h = e < 0 ? '' : source.slice(i + 3, e);
      if (/^[0-9a-fA-F]+$/.test(h) && parseInt(h, 16) <= 0x10ffff) return { value: String.fromCodePoint(parseInt(h, 16)), next: e + 1 };
    } else {
      const h = source.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(h)) return { value: String.fromCharCode(parseInt(h, 16)), next: i + 6 };
    }
  }
  return { value: n, next: i + 2 };
}

// Reads a string literal starting at pos (after whitespace). Returns { value, end } or null.
function readString(source, pos) {
  while (pos < source.length && /\s/.test(source[pos])) pos++;
  const quote = source[pos];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  let i = pos + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const esc = readEscape(source, i);
      value += esc.value;
      i = esc.next;
      continue;
    }
    if (c === quote) return { value, end: i + 1 };
    if (quote === '`' && c === '$' && source[i + 1] === '{') return null;
    if (c === '\n' && quote !== '`') return null;
    value += c;
    i++;
  }
  return null;
}

const nextNonSpace = (source, pos) => {
  while (pos < source.length && /\s/.test(source[pos])) pos++;
  return pos;
};

// Skips an arbitrary expression up to the first top-level comma. Returns index of that comma or -1.
// Characters inside string/regex literals (per mask) are skipped, so they cannot confuse bracket counting.
function skipExpression(source, mask, pos) {
  let depth = 0;
  for (let i = pos; i < source.length; i++) {
    if (mask[i]) continue;
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return -1;
      depth--;
    } else if (c === ',' && depth === 0) return i;
  }
  return -1;
}

function extractDetailed(rawSource, file = '') {
  const { code: source, mask } = tokenize(rawSource);
  const calls = [];
  const invalid = [];

  // Files that import t/tn from the i18n module: aliased imports and bare references (map(t), [t]) would evade
  // the scan, so they are reported. Files that never import it (a local variable named t) are left alone.
  let importsI18n = false;
  const bareSource = source.replace(/import\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]*)\2/g, (whole, specifiers, q, mod, offset) => {
    if (!/(^|\/)i18n(\/index)?$/.test(mod)) return whole;
    if (/\b(tn?)\b/.test(specifiers)) importsI18n = true;
    if (/\b(tn?)\s+as\s+\w+/.test(specifiers)) invalid.push(`${file}:${lineOf(source, offset)}: aliased import of t/tn: ${whole.replace(/\s+/g, ' ').slice(0, 60)}`);
    return whole.replace(/[^\n]/g, ' ');
  });
  const bare = /(^|[^\w.$])(tn?)\s*[,)\]]/g;
  let b;
  while (importsI18n && (b = bare.exec(bareSource))) {
    const at = b.index + b[1].length;
    if (!mask[at]) invalid.push(`${file}:${lineOf(source, at)}: bare reference to ${b[2]} (call t/tn directly so it can be checked)`);
  }

  const re = /(^|[^\w.$])(tn?)\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const at = m.index + m[1].length;
    if (mask[at]) continue; // inside a string, template text or regex literal
    const kind = m[2];
    const start = m.index + m[0].length;
    const bad = () => invalid.push(`${file}:${lineOf(source, start)}: ${source.slice(at, at + 60).split('\n')[0]}`);
    if (kind === 't') {
      const s = readString(source, start);
      const after = s ? source[nextNonSpace(source, s.end)] : null;
      if (!s || (after !== ',' && after !== ')')) bad();
      else calls.push({ kind, text: s.value, line: lineOf(source, at) });
    } else {
      const comma = skipExpression(source, mask, start);
      const one = comma < 0 ? null : readString(source, comma + 1);
      const sep = one ? source[nextNonSpace(source, one.end)] : null;
      const other = sep === ',' ? readString(source, nextNonSpace(source, one.end) + 1) : null;
      const after = other ? source[nextNonSpace(source, other.end)] : null;
      if (!one || !other || (after !== ',' && after !== ')')) bad();
      else calls.push({ kind, text: one.value, other: other.value, line: lineOf(source, at) });
    }
  }
  return { calls, invalid };
}

// Same as extractDetailed without the `line` field, which callers of the checker do not see.
function extract(rawSource, file = '') {
  const { calls, invalid } = extractDetailed(rawSource, file);
  return { calls: calls.map(({ line, ...rest }) => rest), invalid };
}

const uniqSorted = list => [...new Set(list)].sort();
const nonEmptyString = v => typeof v === 'string' && v.length > 0;

function checkCatalog({ srcDir, catalogPath, exclude = [] }) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const missing = [];
  const placeholderMismatches = [];
  const emptyTranslations = [];
  const invalidCalls = [];
  const used = new Set();

  collect(srcDir, exclude).forEach(file => {
    const { calls, invalid } = extract(fs.readFileSync(file, 'utf8'), path.basename(file));
    invalidCalls.push(...invalid);
    calls.forEach(call => {
      const key = call.text;
      used.add(key);
      if (!Object.prototype.hasOwnProperty.call(catalog, key)) { missing.push(key); return; }
      const entry = catalog[key];
      if (call.kind === 't') {
        if (entry === '') emptyTranslations.push(key);
        else if (!nonEmptyString(entry)) missing.push(key);
        else if (!samePlaceholders(key, entry)) placeholderMismatches.push(key);
      } else if (!entry || typeof entry !== 'object' || typeof entry.one !== 'string' || typeof entry.other !== 'string') {
        missing.push(key);
      } else if (!entry.one || !entry.other) {
        emptyTranslations.push(key);
      } else if (!samePlaceholders(call.text, entry.one) || !samePlaceholders(call.other, entry.other)) {
        placeholderMismatches.push(key);
      }
    });
  });

  const unused = Object.keys(catalog).filter(k => !used.has(k));
  return {
    missing: uniqSorted(missing),
    unused: uniqSorted(unused),
    placeholderMismatches: uniqSorted(placeholderMismatches),
    emptyTranslations: uniqSorted(emptyTranslations),
    invalidCalls: uniqSorted(invalidCalls),
  };
}

module.exports = { checkCatalog, extract, extractDetailed, collect };

if (require.main === module) {
  const srcDir = path.join(__dirname, '..', '..', 'src');
  const catalogPath = path.join(srcDir, 'i18n', 'catalogs', 'hi.json');
  const result = checkCatalog({ srcDir, catalogPath });
  let problems = 0;
  Object.entries(result).forEach(([category, list]) => {
    if (!list.length) return;
    problems += list.length;
    console.log(`${category} (${list.length}):`);
    list.forEach(item => console.log(`  ${item}`));
  });
  if (problems) process.exit(1);
  console.log(`i18n check passed (${Object.keys(JSON.parse(fs.readFileSync(catalogPath, 'utf8'))).length} strings)`);
}
