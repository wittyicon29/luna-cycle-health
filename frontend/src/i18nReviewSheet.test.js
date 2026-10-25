const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReviewSheet } = require('../scripts/i18n/review-sheet');

function project(files, catalog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-'));
  Object.entries(files).forEach(([name, text]) => fs.writeFileSync(path.join(dir, name), text));
  const catalogPath = path.join(dir, 'hi.json');
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  return { srcDir: dir, catalogPath };
}

const rowsOf = sheet => sheet.split('\n').filter(l => /^\| \d+ \|/.test(l));

describe('buildReviewSheet', () => {
  test('lists translations, shows a dash for a missing one and orders by file then line', () => {
    const sheet = buildReviewSheet(project(
      { 'b.js': "t('Second');", 'a.js': "t('Hello');\nt('Missing');" },
      { Hello: 'नमस्ते', Second: 'दूसरा' },
    ));
    const rows = rowsOf(sheet).slice(0, 3);
    expect(rows[0]).toBe('| 1 | Hello | नमस्ते | a.js:1 |  |');
    expect(rows[1]).toBe('| 2 | Missing | — | a.js:2 |  |');
    expect(rows[2]).toBe('| 3 | Second | दूसरा | b.js:1 |  |');
  });

  test('shows plural entries as one / other', () => {
    const sheet = buildReviewSheet(project(
      { 'a.js': "tn(n, '{count} day', '{count} days');" },
      { '{count} day': { one: '{count} दिन', other: '{count} दिन' } },
    ));
    expect(rowsOf(sheet)[0]).toBe('| 1 | {count} day / {count} days | {count} दिन / {count} दिन | a.js:1 |  |');
  });

  test('merges repeated strings and caps locations at three', () => {
    const src = [1, 2, 3, 4, 5].map(() => "t('Again');").join('\n');
    const sheet = buildReviewSheet(project({ 'a.js': src }, { Again: 'फिर' }));
    expect(rowsOf(sheet)).toHaveLength(1);
    expect(rowsOf(sheet)[0]).toContain('a.js:1, a.js:2, a.js:3 +2 more');
  });

  test('attaches a note from the line above, a multi-line note and a same-line note, and flags them', () => {
    const src = [
      '// i18n-note: unsure about the tone',
      "t('One');",
      '// i18n-note: first part',
      '// second part',
      "t('Two');",
      "t('Three'); // i18n-note: trailing",
      "t('Plain');",
    ].join('\n');
    const sheet = buildReviewSheet(project({ 'a.js': src }, { One: 'एक', Two: 'दो', Three: 'तीन', Plain: 'सादा' }));
    const [flaggedPart] = sheet.split('## Flagged for the reviewer').slice(1);
    expect(sheet).toContain('| 1 | One | एक | a.js:2 | unsure about the tone |');
    expect(sheet).toContain('| 2 | Two | दो | a.js:5 | first part second part |');
    expect(sheet).toContain('| 3 | Three | तीन | a.js:6 | trailing |');
    expect(sheet).toContain('| 4 | Plain | सादा | a.js:7 |  |');
    expect(rowsOf(flaggedPart)).toHaveLength(3);
    expect(flaggedPart).not.toContain('Plain');
  });

  test('a note does not leak to a later call after a blank or code line', () => {
    const src = "// i18n-note: only for One\nt('One');\nt('Two');";
    const sheet = buildReviewSheet(project({ 'a.js': src }, { One: 'एक', Two: 'दो' }));
    expect(sheet).toContain('| 2 | Two | दो | a.js:3 |  |');
  });

  test('escapes pipes and newlines so the table stays intact', () => {
    const sheet = buildReviewSheet(project(
      { 'a.js': 't("A | B");' },
      { 'A | B': 'क | ख\nग' },
    ));
    expect(rowsOf(sheet)[0]).toBe('| 1 | A \\| B | क \\| ख <br> ग | a.js:1 |  |');
  });

  test('is deterministic', () => {
    const p = project({ 'a.js': "t('X'); // i18n-note: n", 'b.js': "t('Y');" }, { X: 'क्स', Y: 'वाई' });
    expect(buildReviewSheet(p)).toBe(buildReviewSheet(p));
  });
});

test('the committed Hindi review sheet is up to date', () => {
  const srcDir = __dirname;
  const catalogPath = path.join(srcDir, 'i18n', 'catalogs', 'hi.json');
  const onDisk = fs.readFileSync(path.join(srcDir, 'i18n', 'hi-review.md'), 'utf8');
  if (onDisk !== buildReviewSheet({ srcDir, catalogPath })) {
    throw new Error('src/i18n/hi-review.md is out of date. Run `npm run i18n:review` in frontend/ and commit the result.');
  }
});
