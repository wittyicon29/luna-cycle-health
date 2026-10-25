const path = require('path');
const { checkCatalog } = require('../scripts/i18n/check');

test('the Hindi catalog is complete, current and well-formed', () => {
  const problems = checkCatalog({
    srcDir: path.join(__dirname),
    catalogPath: path.join(__dirname, 'i18n', 'catalogs', 'hi.json'),
  });
  expect(problems).toEqual({ missing: [], unused: [], placeholderMismatches: [], emptyTranslations: [], invalidCalls: [] });
});

describe('the checker itself', () => {
  const fs = require('fs');
  const os = require('os');
  function project(files, catalog) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
    Object.entries(files).forEach(([name, text]) => fs.writeFileSync(path.join(dir, name), text));
    const catalogPath = path.join(dir, 'hi.json');
    fs.writeFileSync(catalogPath, JSON.stringify(catalog));
    return { srcDir: dir, catalogPath, exclude: [] };
  }

  test('reports a missing translation', () => {
    const r = checkCatalog(project({ 'a.js': "const x = t('Hello');" }, {}));
    expect(r.missing).toEqual(['Hello']);
  });
  test('reports unused catalog entries', () => {
    const r = checkCatalog(project({ 'a.js': "const x = t('Hello');" }, { Hello: 'नमस्ते', Old: 'पुराना' }));
    expect(r.unused).toEqual(['Old']);
    expect(r.missing).toEqual([]);
  });
  test('reports placeholder mismatches and empty translations', () => {
    const r = checkCatalog(project({ 'a.js': "t('Hi {name}'); t('Bye');" }, { 'Hi {name}': 'नमस्ते {नाम}', Bye: '' }));
    expect(r.placeholderMismatches).toEqual(['Hi {name}']);
    expect(r.emptyTranslations).toEqual(['Bye']);
  });
  test('handles tn plural entries and checks both forms', () => {
    const ok = checkCatalog(project({ 'a.js': "tn(n, '{count} day', '{count} days');" }, { '{count} day': { one: '{count} दिन', other: '{count} दिन' } }));
    expect(ok).toEqual({ missing: [], unused: [], placeholderMismatches: [], emptyTranslations: [], invalidCalls: [] });
    const bad = checkCatalog(project({ 'a.js': "tn(n, '{count} day', '{count} days');" }, { '{count} day': { one: '{count} दिन', other: 'दिन' } }));
    expect(bad.placeholderMismatches).toEqual(['{count} day']);
  });
  test('rejects dynamic arguments and template interpolation', () => {
    const r = checkCatalog(project({ 'a.js': 't(label); t(`Hi ${name}`); t("a" + b);' }, {}));
    expect(r.invalidCalls.length).toBe(3);
  });
  test('accepts double quotes, backticks without interpolation and escaped quotes; ignores .t( member calls and excluded files', () => {
    const r = checkCatalog({
      ...project({ 'a.js': 't("It\'s fine"); t(`Plain`); i.t(foo); const t2 = 1;', 'skip.js': "t('Skipped');" }, { "It's fine": 'ठीक है', Plain: 'सादा' }),
      exclude: ['skip.js'],
    });
    expect(r).toEqual({ missing: [], unused: [], placeholderMismatches: [], emptyTranslations: [], invalidCalls: [] });
  });
  const EMPTY = { missing: [], unused: [], placeholderMismatches: [], emptyTranslations: [], invalidCalls: [] };

  test('ignores t() inside line and block comments, and inside string literals', () => {
    const src = "// t('x')\n/* t('y') */\nconst a = \"t('z')\";\nconst b = 'a // not a comment'; t('Real');\nconst c = `t('w')`;";
    const r = checkCatalog(project({ 'a.js': src }, { Real: 'असली' }));
    expect(r).toEqual(EMPTY);
  });
  test('still finds calls inside template ${} expressions and after a URL in a string', () => {
    const src = "const u = 'http://x.y/z'; const s = `a ${t('Inner')} b`;";
    expect(checkCatalog(project({ 'a.js': src }, {})).missing).toEqual(['Inner']);
  });
  test('decodes JS escapes like the runtime', () => {
    const src = String.raw`t('café'); t('a\u{1F600}b'); t('x\x41y'); t('t\tab'); t('line\
cont'); t('un\qknown'); t('nul\0');`;
    const keys = ['café', 'a\u{1F600}b', 'xAy', 't\tab', 'linecont', 'unqknown', 'nul\0'];
    const catalog = {};
    keys.forEach(k => { catalog[k] = 'अनुवाद'; });
    expect(checkCatalog(project({ 'a.js': src }, catalog))).toEqual(EMPTY);
  });
  test('handles multiline calls and tn with a regex literal in the first argument', () => {
    const src = "t(\n  'Multi'\n);\ntn(items.filter(x => /[,)(]\\//.test(x)).length, '{count} a', '{count} b');";
    const r = checkCatalog(project({ 'a.js': src }, { Multi: 'बहु', '{count} a': { one: '{count} क', other: '{count} ख' } }));
    expect(r).toEqual(EMPTY);
  });
  test('regex literal containing quotes does not swallow later calls', () => {
    const r = checkCatalog(project({ 'a.js': "const re = /['\"`]/g; t('After');" }, {}));
    expect(r.missing).toEqual(['After']);
  });
  test('JSX closing and self-closing tags are not regex literals', () => {
    const src = "const a = <A x={y} />; const b = <b>{c}</b>; const s = `${d}%`; const e = <i>{t('After JSX')}</i>;";
    expect(checkCatalog(project({ 'a.js': src }, {})).missing).toEqual(['After JSX']);
  });
  test('a regex literal starting with > is still a regex, and JSX text after a brace is not', () => {
    const re = "const a = x.replace(/>/g, t('Gt')); const b = f(/>/, t('Gt2')); const c = y = /> /.test(z) && t('Gt3');";
    expect(checkCatalog(project({ 'a.js': re }, {})).missing).toEqual(['Gt', 'Gt2', 'Gt3']);
    const jsx = "const a = <A x={y} />; const b = <B z=\"1\" />; const c = <C disabled />; const d = <p>{n}/10 {t('Score')}</p>; t('Tail');";
    expect(checkCatalog(project({ 'a.js': jsx }, {})).missing).toEqual(['Score', 'Tail']);
  });
  test('flags aliased imports and bare references to t/tn', () => {
    const alias = checkCatalog(project({ 'a.js': "import { t as tr } from './i18n';\ntr('x');" }, {}));
    expect(alias.invalidCalls.length).toBe(1);
    const bare = checkCatalog(project({ 'a.js': "import { t } from './i18n';\nconst out = list.map(t);" }, {}));
    expect(bare.invalidCalls.length).toBe(1);
    const fine = checkCatalog(project({ 'a.js': "import { t, tn } from './i18n';\nt('Ok');" }, { Ok: 'ठीक' }));
    expect(fine).toEqual(EMPTY);
  });
});
