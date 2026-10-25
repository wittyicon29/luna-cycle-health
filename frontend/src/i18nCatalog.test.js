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
});
