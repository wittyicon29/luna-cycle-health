// Unit tests of the CI build-warning gate (scripts/check-build-warnings.js). They live in
// src/ so that `CI=true npm test` (react-scripts' jest, roots: src/) runs them.
const { parseBuildOutput, evaluate, parseArgs, DEFAULT_MAX } = require('../scripts/check-build-warnings');

// Shape of real `CI=false npm run build` output from react-scripts 5 (shortened).
const HEADER = `> frontend@0.1.0 build
> react-scripts build

(node:70189) [DEP0176] DeprecationWarning: fs.F_OK is deprecated, use fs.constants.F_OK instead
Creating an optimized production build...
Browserslist: browsers data (caniuse-lite) is 9 months old. Please run:
  npx update-browserslist-db@latest
Compiled with warnings.

[eslint]
`;
const FOOTER = `
Search for the keywords to learn more about each warning.
To ignore, add // eslint-disable-next-line to the line before.

File sizes after gzip:

  186.11 kB  build/static/js/main.18562933.js

The build folder is ready to be deployed.
`;
const APP = `src/App.js
  Line 656:6:     React Hook useEffect has a missing dependency: 'lines.length'. Either include it or remove the dependency array                                                                                             react-hooks/exhaustive-deps
  Line 1310:9:    The 'currentMessages' conditional could make the dependencies of useEffect Hook (at line 1311) change on every render. To fix this, wrap the initialization of 'currentMessages' in its own useMemo() Hook  react-hooks/exhaustive-deps
  Line 1856:91:   'setProd' is assigned a value but never used                                                                                                                                                                no-unused-vars
`;
const LANDING = `src/LandingPage.js
  Line 1:46:    'useCallback' is defined but never used                                                                       no-unused-vars
`;

function buildLog(count) {
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    entries.push(`  Line ${i + 1}:5:  'unused${i}' is defined but never used  no-unused-vars`);
  }
  return `${HEADER}src/Generated.js\n${entries.join('\n')}\n${FOOTER}`;
}

test('parses each ESLint entry with its file, position and rule', () => {
  const parsed = parseBuildOutput(`${HEADER}${APP}\n${LANDING}${FOOTER}`);
  expect(parsed.compiledWithWarnings).toBe(true);
  expect(parsed.failed).toBe(false);
  expect(parsed.warnings).toHaveLength(4);
  expect(parsed.warnings[0]).toMatchObject({ file: 'src/App.js', line: 656, column: 6, rule: 'react-hooks/exhaustive-deps' });
  expect(parsed.warnings[1].message).toMatch(/^The 'currentMessages' conditional/);
  expect(parsed.warnings[1].rule).toBe('react-hooks/exhaustive-deps');
  expect(parsed.warnings[3]).toMatchObject({ file: 'src/LandingPage.js', line: 1, column: 46, rule: 'no-unused-vars' });
});

test('lines that merely mention "warning" are not counted', () => {
  // The header/footer contain "DeprecationWarning", "warnings" and "warning" but no entries.
  const parsed = parseBuildOutput(`${HEADER}${APP}${FOOTER}`);
  expect(parsed.warnings).toHaveLength(3);
});

test('ANSI colours and CRLF line endings do not hide entries', () => {
  const coloured = `${HEADER}\u001b[1msrc/App.js\u001b[22m\r\n  \u001b[1mLine 3:7:\u001b[22m  'x' is defined but never used  \u001b[33mno-unused-vars\u001b[39m\r\n`;
  const parsed = parseBuildOutput(coloured);
  expect(parsed.warnings).toHaveLength(1);
  expect(parsed.warnings[0]).toMatchObject({ file: 'src/App.js', line: 3, rule: 'no-unused-vars' });
});

test('an entry without a rule column still counts', () => {
  const parsed = parseBuildOutput(`${HEADER}src/App.js\n  Line 9:1:  Parsing hint without a rule\n`);
  expect(parsed.warnings).toHaveLength(1);
  expect(parsed.warnings[0].rule).toBe('(unknown rule)');
});

test('the gate allows the baseline of 15 and fails at 16', () => {
  expect(DEFAULT_MAX).toBe(15);
  expect(evaluate(parseBuildOutput(buildLog(15)), DEFAULT_MAX).ok).toBe(true);
  const over = evaluate(parseBuildOutput(buildLog(16)), DEFAULT_MAX);
  expect(over.ok).toBe(false);
  expect(over.message).toMatch(/16 ESLint warnings/);
});

test('a clean build passes', () => {
  const clean = parseBuildOutput('Creating an optimized production build...\nCompiled successfully.\n');
  expect(clean.warnings).toHaveLength(0);
  expect(evaluate(clean, DEFAULT_MAX).ok).toBe(true);
});

test('a failed compile fails the gate even with few warnings', () => {
  const failed = parseBuildOutput('Creating an optimized production build...\nFailed to compile.\n\nModule not found\n');
  expect(evaluate(failed, DEFAULT_MAX).ok).toBe(false);
});

test('"Compiled with warnings" without parseable entries fails (format changed)', () => {
  const verdict = evaluate(parseBuildOutput(`${HEADER}src/App.js\n  something unexpected\n`), DEFAULT_MAX);
  expect(verdict.ok).toBe(false);
  expect(verdict.message).toMatch(/none could be parsed/);
});

test('arguments', () => {
  expect(parseArgs([])).toEqual({ max: 15, input: null });
  expect(parseArgs(['--max', '3', '--input', 'build.log'])).toEqual({ max: 3, input: 'build.log' });
  expect(() => parseArgs(['--max', 'many'])).toThrow(/whole number/);
  expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
});
