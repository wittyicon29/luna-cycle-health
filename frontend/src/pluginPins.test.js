// Guards two plugin pins held below their latest release on purpose. Raise them only after the reason in
// each failure message has been dealt with.
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

// Numeric major.minor.patch of a version spec; ^ / ~ / = prefixes and pre-release tags are ignored.
function parts(spec) {
  const match = /^[\^~=v]*(\d+)\.(\d+)\.(\d+)/.exec(String(spec || '').trim());
  if (!match) throw new Error(`not a semver version: ${spec}`);
  return match.slice(1, 4).map(Number);
}

function compare(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

test('version compare handles prefixes and each component', () => {
  expect(compare('^8.2.1', '8.3.0')).toBe(-1);
  expect(compare('~8.3.0', '8.3.0')).toBe(0);
  expect(compare('8.10.0', '8.3.0')).toBe(1);
  expect(compare('9.0.0', '8.99.99')).toBe(1);
  expect(() => parts('latest')).toThrow();
});

test('@capacitor/local-notifications stays below 8.3.0', () => {
  const version = deps['@capacitor/local-notifications'];
  if (!(compare(version, '8.3.0') < 0)) {
    throw new Error(
      `@capacitor/local-notifications is ${version}: 8.3.x adds the SCHEDULE_EXACT_ALARM permission and makes ` +
        'schedule() open the system "Alarms & reminders" settings screen when exact alarms are not granted. ' +
        'Reminders are inexact on purpose; keep it below 8.3.0 or rework reminderScheduler.js first.',
    );
  }
});

test('@capgo/native-purchases is pinned to 8.6.0', () => {
  const version = deps['@capgo/native-purchases'];
  if (version !== '8.6.0') {
    throw new Error(
      `@capgo/native-purchases is ${version}, expected 8.6.0: from 8.6.1 the plugin prices each offer from its ` +
        'recurring phase, so a free-trial offer no longer reports price 0 and toPlans() in ' +
        'src/billing/billingClient.js would drop the plan as a paid intro offer.',
    );
  }
});
