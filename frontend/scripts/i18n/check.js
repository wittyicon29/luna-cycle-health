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

// Reads a string literal starting at pos (after whitespace). Returns { value, end } or null.
function readString(source, pos) {
  while (/\s/.test(source[pos])) pos++;
  const quote = source[pos];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  let i = pos + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const n = source[i + 1];
      value += n === 'n' ? '\n' : n;
      i += 2;
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
function skipExpression(source, pos) {
  let depth = 0;
  let i = pos;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < source.length && source[i] !== q) i += source[i] === '\\' ? 2 : 1;
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return -1;
      depth--;
    } else if (c === ',' && depth === 0) return i;
    i++;
  }
  return -1;
}

function extract(source, file = '') {
  const calls = [];
  const invalid = [];
  const re = /(^|[^\w.$])(tn?)\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const kind = m[2];
    const start = m.index + m[0].length;
    const bad = () => invalid.push(`${file}:${lineOf(source, start)}: ${source.slice(m.index + m[1].length, m.index + m[1].length + 60).split('\n')[0]}`);
    if (kind === 't') {
      const s = readString(source, start);
      const after = s ? source[nextNonSpace(source, s.end)] : null;
      if (!s || (after !== ',' && after !== ')')) bad();
      else calls.push({ kind, text: s.value });
    } else {
      const comma = skipExpression(source, start);
      const one = comma < 0 ? null : readString(source, comma + 1);
      const sep = one ? source[nextNonSpace(source, one.end)] : null;
      const other = sep === ',' ? readString(source, nextNonSpace(source, one.end) + 1) : null;
      const after = other ? source[nextNonSpace(source, other.end)] : null;
      if (!one || !other || (after !== ',' && after !== ')')) bad();
      else calls.push({ kind, text: one.value, other: other.value });
    }
  }
  return { calls, invalid };
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

module.exports = { checkCatalog, extract, collect };

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
