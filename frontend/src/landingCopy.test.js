import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'LandingPage.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');

test.each([
  ['an end-to-end encryption claim', /end-to-end/i],
  ['an unsubstantiated user-count claim', /join thousands/i],
  ['a GDPR link (wrong law for India)', /GDPR/],
  ['a stale copyright year', /©\s*2024/],
  ['a fertility-window feature chip', /FERTILITY WINDOW/i],
  ['fertility-seeking copy', /most fertile/i],
  ['an always-available claim', /always available/i],
  ['a MedGemma-powered claim', /MedGemma-powered/],
  ['a claim that the questionnaire informs every prediction', /informing every prediction/i],
  ['a comprehensive-questionnaire claim', /comprehensive questionnaire/i],
  ['a health-fingerprint claim', /health fingerprint/i],
  ['dead footer items', /Data Security|Help Centre|'FAQ'|Community/],
])('the landing page has no %s', (_name, pattern) => {
  expect(source).not.toMatch(pattern);
});

test('the footer links to the real policy pages', () => {
  expect(source).toMatch(/href[:=]\s*['"{]*\/privacy/);
  expect(source).toMatch(/href[:=]\s*['"{]*\/terms/);
});

test('the privacy claim says what is actually true', () => {
  expect(source).toMatch(/encrypted at rest/i);
});

test('the copyright year is computed, not hard-coded', () => {
  expect(source).toMatch(/getFullYear\(\)/);
});

test.each([
  ['any fertility wording', /fertil/i],
  ['fertility-seeking copy', /most fertile/i],
])('the app has no %s', (_name, pattern) => {
  expect(appSource).not.toMatch(pattern);
});
