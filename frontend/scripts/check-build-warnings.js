#!/usr/bin/env node
/*
 * Build-warning gate for CI.
 *
 *   node scripts/check-build-warnings.js [--max N] [--input FILE]
 *
 * Without --input it runs `npm run build` with CI=false (react-scripts turns every
 * warning into an error when CI=true), prints the build output, and counts the ESLint
 * warning entries in it ("  Line 12:5:  message  rule-name"). With --input it only parses
 * a saved build log. Fails when:
 *   - the build itself fails (its exit code is passed through, or 1),
 *   - the output says "Failed to compile",
 *   - there are more than N ESLint warnings (default 15, the project baseline),
 *   - the output says "Compiled with warnings" but no warning entry could be parsed (the
 *     output format changed: the gate would otherwise pass silently).
 * Exit codes: 0 ok, 1 gate failed, 2 usage error.
 */
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const DEFAULT_MAX = 15;
// react-scripts/eslint format: indent, "Line L:C:", message, two or more spaces, rule name.
// Every "Line L:C:" entry counts, even when the rule column is missing.
const ENTRY = /^\s*Line (\d+):(\d+):\s+(.*?)\s*$/;
const RULE = /^(.*?)\s{2,}(@?[\w-]+(?:\/[\w-]+)*)$/;
const FILE_HEADER = /^(src\/\S+|\S+\.(?:js|jsx|ts|tsx|mjs|cjs))\s*$/;

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/** Parse react-scripts build output -> { warnings: [{file, line, column, rule, message}], compiledWithWarnings, failed } */
function parseBuildOutput(text) {
  const lines = stripAnsi(String(text)).split(/\r?\n/);
  const warnings = [];
  let file = null;
  for (const raw of lines) {
    const header = raw.match(FILE_HEADER);
    if (header) {
      file = header[1];
      continue;
    }
    const entry = raw.match(ENTRY);
    if (entry) {
      const rule = entry[3].match(RULE);
      warnings.push({
        file,
        line: Number(entry[1]),
        column: Number(entry[2]),
        message: rule ? rule[1] : entry[3],
        rule: rule ? rule[2] : '(unknown rule)',
      });
    }
  }
  const all = lines.join('\n');
  return {
    warnings,
    compiledWithWarnings: /Compiled with warnings\./.test(all),
    failed: /Failed to compile\./.test(all),
  };
}

/** Decide the gate result for parsed output: { ok, message } */
function evaluate(parsed, max) {
  const count = parsed.warnings.length;
  if (parsed.failed) {
    return { ok: false, message: 'the build failed to compile' };
  }
  if (parsed.compiledWithWarnings && count === 0) {
    return {
      ok: false,
      message: 'the build reported warnings but none could be parsed (output format changed?); update scripts/check-build-warnings.js',
    };
  }
  if (count > max) {
    return { ok: false, message: `${count} ESLint warnings, more than the allowed ${max}: fix the new ones` };
  }
  return { ok: true, message: `${count} ESLint warnings (allowed: ${max})` };
}

function summarize(warnings) {
  const byRule = new Map();
  for (const w of warnings) {
    byRule.set(w.rule, (byRule.get(w.rule) || 0) + 1);
  }
  return [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([rule, n]) => `  ${n}  ${rule}`);
}

function parseArgs(argv) {
  const options = { max: DEFAULT_MAX, input: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--max' && i + 1 < argv.length) {
      const value = argv[(i += 1)];
      if (!/^\d+$/.test(value)) {
        throw new Error('--max needs a whole number');
      }
      options.max = Number(value);
    } else if (arg === '--input' && i + 1 < argv.length) {
      options.input = argv[(i += 1)];
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`check-build-warnings: ${error.message}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write('usage: node scripts/check-build-warnings.js [--max N] [--input BUILD_LOG]\n');
    return 0;
  }
  let output;
  let buildStatus = 0;
  if (options.input) {
    output = fs.readFileSync(options.input, 'utf8');
  } else {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'build'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, CI: 'false' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    output = `${result.stdout || ''}\n${result.stderr || ''}`;
    process.stdout.write(output);
    if (result.error) {
      process.stderr.write(`check-build-warnings: could not run the build: ${result.error.message}\n`);
      return 1;
    }
    buildStatus = result.status === null ? 1 : result.status;
  }
  const parsed = parseBuildOutput(output);
  if (buildStatus !== 0) {
    process.stderr.write(`check-build-warnings: FAIL: npm run build exited with ${buildStatus}\n`);
    return buildStatus;
  }
  const verdict = evaluate(parsed, options.max);
  const lines = summarize(parsed.warnings);
  if (lines.length) {
    process.stdout.write(`check-build-warnings: warnings by rule:\n${lines.join('\n')}\n`);
  }
  const stream = verdict.ok ? process.stdout : process.stderr;
  stream.write(`check-build-warnings: ${verdict.ok ? 'OK' : 'FAIL'}: ${verdict.message}\n`);
  return verdict.ok ? 0 : 1;
}

module.exports = { parseBuildOutput, evaluate, parseArgs, DEFAULT_MAX };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
