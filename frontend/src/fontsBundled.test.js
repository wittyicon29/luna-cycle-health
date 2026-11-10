// Fonts and styles are self-hosted: no stylesheet, font or script is loaded from a third
// party (that would send the user's IP and user agent to it on every launch and break
// offline use). All @font-face rules live in public/fonts.css next to the font files.
import fs from 'fs';
import path from 'path';

const FRONTEND = path.join(__dirname, '..');
const PUBLIC = path.join(FRONTEND, 'public');
const read = relative => fs.readFileSync(path.join(FRONTEND, relative), 'utf8');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(js|jsx|ts|tsx|css)$/.test(entry.name)) return [];
    if (/\.test\.(js|jsx|ts|tsx)$/.test(entry.name) || entry.name === 'setupTests.js') return [];
    return [full];
  });
}

const SRC_FILES = sourceFiles(__dirname).map(file => ({
  file: path.relative(FRONTEND, file),
  text: fs.readFileSync(file, 'utf8'),
}));

const REMOTE = /^\s*['"]?\s*(?:https?:)?\/\//i;
const FONT_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|fast\.fonts\.net|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/i;

const stripCssComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

function fontFaces(css) {
  return (stripCssComments(css).match(/@font-face\s*\{[^}]*\}/g) || []).map(block => {
    const prop = name => {
      const m = block.match(new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;}]*)`));
      return m ? m[1].trim() : '';
    };
    return {
      block,
      family: prop('font-family').replace(/^['"]|['"]$/g, ''),
      style: prop('font-style') || 'normal',
      weight: prop('font-weight'),
      display: prop('font-display'),
      unicodeRange: prop('unicode-range'),
      urls: [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]),
    };
  });
}

function inRange(unicodeRange, codePoint) {
  return unicodeRange.split(',').map(part => part.trim().replace(/^U\+/i, '')).some(part => {
    const [lo, hi = lo] = part.split('-').map(h => parseInt(h, 16));
    return codePoint >= lo && codePoint <= hi;
  });
}

const FONTS_CSS = read('public/fonts.css');
const FACES = fontFaces(FONTS_CSS);
const INDEX_HTML = read('public/index.html');

describe('(a) nothing loads styles, fonts or scripts from a third party', () => {
  test('no CSS @import or url() under src points at a remote URL', () => {
    const offenders = [];
    for (const { file, text } of SRC_FILES) {
      for (const m of text.matchAll(/@import\s+(?:url\()?\s*([^;\n]*)/g)) {
        if (REMOTE.test(m[1])) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
      for (const m of text.matchAll(/url\(\s*([^)]*)\)/g)) {
        if (REMOTE.test(m[1])) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no font host or script CDN is named anywhere under src', () => {
    const offenders = SRC_FILES.filter(({ text }) => FONT_HOSTS.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test('src never declares fonts itself (all @font-face rules live in public/fonts.css)', () => {
    const offenders = SRC_FILES.filter(({ text }) => /@font-face|new FontFace\s*\(/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test('src never injects a <link> or <script> element pointing at a remote URL', () => {
    const offenders = [];
    for (const { file, text } of SRC_FILES) {
      for (const m of text.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)\s*=\s*\{?\s*['"`]([^'"`]*)/gi)) {
        if (REMOTE.test(m[1])) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
      if (/createElement\(\s*['"](?:link|script)['"]\s*\)/.test(text)) offenders.push(`${file}: createElement(link|script)`);
    }
    expect(offenders).toEqual([]);
  });

  test('plain CSS files under src contain no remote URL at all', () => {
    const offenders = SRC_FILES.filter(({ file, text }) => file.endsWith('.css') && /https?:\/\//i.test(stripCssComments(text)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test('index.html links and scripts are all same-origin, with no inline @import', () => {
    const html = INDEX_HTML.replace(/<!--[\s\S]*?-->/g, '');
    const refs = [...html.matchAll(/<(link|script)\b[^>]*?\b(?:href|src)\s*=\s*"([^"]*)"/gi)].map(m => m[2]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter(ref => REMOTE.test(ref))).toEqual([]);
    expect(refs.every(ref => ref.startsWith('%PUBLIC_URL%/'))).toBe(true);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(FONT_HOSTS);
  });

  test('fonts.css and the web manifest contain no remote URL', () => {
    expect(stripCssComments(FONTS_CSS)).not.toMatch(/https?:\/\/|url\(\s*['"]?\/\//i);
    expect(FONTS_CSS).not.toMatch(/@import/);
    const manifest = JSON.parse(read('public/manifest.json'));
    const urls = [manifest.start_url, ...(manifest.icons || []).map(icon => icon.src)];
    expect(urls.filter(u => REMOTE.test(String(u)))).toEqual([]);
  });
});

describe('(b) every font family the styles name is self-hosted', () => {
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset']);

  // Families named by the app's own styles (CSS strings and inline fontFamily props in JS).
  // index.css only names the CRA system-font stack (never downloaded), so it is not scanned.
  const named = new Set();
  for (const { file, text } of SRC_FILES) {
    if (!file.endsWith('.js')) continue;
    const stacks = [
      ...[...text.matchAll(/font-family\s*:\s*([^;}`"]+)/g)].map(m => m[1]),
      ...[...text.matchAll(/fontFamily\s*:\s*(["'`])((?:(?!\1).)*)\1/g)].map(m => m[2]),
    ];
    for (const stack of stacks) {
      for (const raw of stack.split(',')) {
        const fam = raw.trim().replace(/^['"]|['"]$/g, '');
        if (fam && !GENERIC.has(fam.toLowerCase()) && !/[${}()[\]\\/]/.test(fam)) named.add(fam);
      }
    }
  }

  test('the styles name exactly the bundled families', () => {
    expect([...named].sort()).toEqual(['Cormorant Garamond', 'Fira Code', 'Noto Sans Devanagari', 'Outfit']);
  });

  test.each(['Outfit', 'Cormorant Garamond', 'Fira Code', 'Noto Sans Devanagari'])(
    '%s has a swap @font-face in fonts.css whose files exist and are woff2',
    family => {
      const faces = FACES.filter(face => face.family === family);
      expect(faces.length).toBeGreaterThan(0);
      for (const face of faces) {
        expect(face.display).toBe('swap');
        expect(face.unicodeRange).not.toBe('');
        expect(face.urls.length).toBeGreaterThan(0);
        for (const url of face.urls) {
          expect(url).toMatch(/^fonts\/[\w.-]+\.woff2$/);
          const file = path.join(PUBLIC, url);
          expect(fs.existsSync(file)).toBe(true);
          const bytes = fs.readFileSync(file);
          expect(bytes.length).toBeGreaterThan(1000);
          expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
        }
        expect(face.block).toMatch(/format\('woff2'\)/);
      }
    }
  );

  test('every family named in src is covered by fonts.css', () => {
    const declared = new Set(FACES.map(face => face.family));
    expect([...named].filter(fam => !declared.has(fam))).toEqual([]);
  });

  test('the faces the old Google Fonts request served are all still there', () => {
    const has = (family, style, weight) => FACES.some(face => face.family === family && face.style === style && face.weight === weight);
    expect(has('Outfit', 'normal', '300 600')).toBe(true);
    expect(has('Cormorant Garamond', 'normal', '400')).toBe(true);
    expect(has('Cormorant Garamond', 'normal', '500')).toBe(true);
    expect(has('Cormorant Garamond', 'normal', '600')).toBe(true);
    expect(has('Cormorant Garamond', 'italic', '400')).toBe(true);
    expect(has('Fira Code', 'normal', '300 500')).toBe(true);
  });

  test('Latin faces leave Devanagari and ZWNJ/ZWJ to Noto Sans Devanagari', () => {
    const latin = FACES.filter(face => face.family !== 'Noto Sans Devanagari');
    const noto = FACES.filter(face => face.family === 'Noto Sans Devanagari');
    const overlaps = latin.flatMap(face => [0x0905, 0x093f, 0x094d, 0x200c, 0x200d, 0x20b9]
      .filter(cp => inRange(face.unicodeRange, cp))
      .map(cp => `${face.urls[0]} U+${cp.toString(16).toUpperCase()}`));
    expect(overlaps).toEqual([]);
    const latinText = FACES.filter(face => face.family === 'Outfit');
    for (const cp of [0x41, 0x7a, 0x30, 0xe9, 0x2014, 0x2026, 0x200b, 0x200e]) expect(inRange(latinText[0].unicodeRange, cp)).toBe(true);
    expect(noto.length).toBe(1);
    for (const cp of [0x0900, 0x097f, 0x200c, 0x200d, 0x25cc]) expect(inRange(noto[0].unicodeRange, cp)).toBe(true);
  });
});

describe('(c) licences', () => {
  test.each([
    ['Outfit', 'fonts/OFL-Outfit.txt', /Outfit Project Authors/],
    ['Cormorant Garamond', 'fonts/OFL-CormorantGaramond.txt', /Cormorant Project Authors/],
    ['Fira Code', 'fonts/OFL-FiraCode.txt', /Fira Code Project Authors/],
    ['Noto Sans Devanagari', 'fonts/OFL.txt', /Noto Project Authors/],
  ])('%s ships its SIL OFL 1.1 licence text', (_family, file, copyright) => {
    const text = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    expect(text).toMatch(copyright);
    expect(text).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/);
    expect(text).toMatch(/PERMISSION & CONDITIONS/);
  });
});

describe('(d) index.html wiring', () => {
  test('fonts.css is linked from <head>', () => {
    const head = INDEX_HTML.split('</head>')[0].replace(/<!--[\s\S]*?-->/g, '');
    expect(head).toMatch(/<link rel="stylesheet" href="%PUBLIC_URL%\/fonts\.css" \/>/);
  });

  test('preloads are same-origin woff2 files that fonts.css actually uses', () => {
    const head = INDEX_HTML.split('</head>')[0].replace(/<!--[\s\S]*?-->/g, '');
    const preloads = [...head.matchAll(/<link rel="preload" href="%PUBLIC_URL%\/([^"]+)" as="font" type="font\/woff2" crossorigin \/>/g)].map(m => m[1]);
    expect(preloads.length).toBeGreaterThanOrEqual(1);
    expect(preloads.length).toBeLessThanOrEqual(2);
    const used = new Set(FACES.flatMap(face => face.urls));
    for (const file of preloads) {
      expect(used.has(file)).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC, file))).toBe(true);
    }
  });
});
