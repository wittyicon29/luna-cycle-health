import { renderHook, act } from '@testing-library/react';
import hi from './catalogs/hi.json';
import * as i18n from './index';

const { t, tn, setLanguage, getLanguage, detectLanguage, intlLocale, useLanguage } = i18n;

beforeEach(() => {
  localStorage.clear();
  setLanguage('en');
  Object.keys(hi).forEach(k => delete hi[k]);
});

test('English is the identity, with {placeholder} interpolation', () => {
  expect(t('Log a period')).toBe('Log a period');
  expect(t('Day {day} of {total}', { day: 3, total: 28 })).toBe('Day 3 of 28');
  expect(t('Hello {name}', {})).toBe('Hello {name}'); // missing var stays visible, never "undefined"
});

test('Hindi uses the catalog and falls back to English per string', () => {
  hi['Log a period'] = 'माहवारी दर्ज करें';
  hi['Day {day} of {total}'] = 'दिन {day} / {total}';
  setLanguage('hi');
  expect(t('Log a period')).toBe('माहवारी दर्ज करें');
  expect(t('Day {day} of {total}', { day: 3, total: 28 })).toBe('दिन 3 / 28');
  expect(t('Not translated yet')).toBe('Not translated yet');
});

test('empty or non-string catalog entries fall back to English', () => {
  hi['A'] = '';
  hi['B'] = 5;
  setLanguage('hi');
  expect(t('A')).toBe('A');
  expect(t('B')).toBe('B');
});

test('tn: English one/other, Hindi treats 0 and 1 as "one"', () => {
  expect(tn(1, '{count} day', '{count} days')).toBe('1 day');
  expect(tn(0, '{count} day', '{count} days')).toBe('0 days');
  expect(tn(5, '{count} day', '{count} days')).toBe('5 days');
  hi['{count} day'] = { one: '{count} दिन', other: '{count} दिन' };
  setLanguage('hi');
  expect(tn(0, '{count} day', '{count} days')).toBe('0 दिन');
  expect(tn(2, '{count} day', '{count} days')).toBe('2 दिन');
  hi['{count} item'] = { one: '{count} वस्तु', other: '{count} वस्तुएँ' };
  expect(tn(0, '{count} item', '{count} items')).toBe('0 वस्तु');
  expect(tn(2, '{count} item', '{count} items')).toBe('2 वस्तुएँ');
});

test('setLanguage validates, persists, sets <html lang> and notifies subscribers', () => {
  const seen = [];
  const off = i18n.subscribe(() => seen.push(getLanguage()));
  expect(setLanguage('fr')).toBe(false);
  expect(getLanguage()).toBe('en');
  expect(setLanguage('hi')).toBe(true);
  expect(localStorage.getItem('luna_language')).toBe('hi');
  expect(document.documentElement.lang).toBe('hi');
  expect(seen).toEqual(['hi']);
  off();
  setLanguage('en');
  expect(seen).toEqual(['hi']);
  expect(document.documentElement.lang).toBe('en');
});

test('detectLanguage: stored value wins, then the phone language', () => {
  localStorage.setItem('luna_language', 'hi');
  expect(detectLanguage()).toBe('hi');
  localStorage.setItem('luna_language', 'zz');
  const spy = jest.spyOn(window.navigator, 'language', 'get');
  spy.mockReturnValue('hi-IN');
  expect(detectLanguage()).toBe('hi');
  spy.mockReturnValue('en-US');
  expect(detectLanguage()).toBe('en');
  spy.mockReturnValue('mr-IN');
  expect(detectLanguage()).toBe('en');
  spy.mockRestore();
});

test('the pseudo-locale is accepted outside production and expands text', () => {
  expect(setLanguage('en-XA')).toBe(true);
  const out = t('Save {name}', { name: 'Iron' });
  expect(out.length).toBeGreaterThan('Save Iron'.length * 1.25);
  expect(out).toContain('Iron');
  expect(out).not.toBe('Save Iron');
});

test('intlLocale', () => {
  expect(intlLocale('en')).toBeUndefined();
  expect(intlLocale('hi')).toBe('hi-IN-u-nu-latn');
});

test('useLanguage re-renders on change', () => {
  const { result } = renderHook(() => useLanguage());
  expect(result.current).toBe('en');
  act(() => { setLanguage('hi'); });
  expect(result.current).toBe('hi');
});

test('storage failures never break language switching', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(setLanguage('hi')).toBe(true);
  expect(getLanguage()).toBe('hi');
  spy.mockRestore();
});

describe('findUntranslated', () => {
  const { findUntranslated } = require('./testUtils');
  const render = html => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  test('flags English text', () => {
    expect(findUntranslated(render('<p>Save changes</p>'))).toEqual(['Save changes']);
  });
  test('ignores allow-listed words, emails, URLs and Devanagari', () => {
    const d = render('<p>Luna</p><p>nik@gmail.com</p><p>{DELETE}</p><p>https://example.com/x</p><p>माहवारी दर्ज करें</p><p>OK</p>');
    expect(findUntranslated(d)).toEqual([]);
  });
  test('skips [data-i18n-ignore] subtrees and input/textarea values', () => {
    const d = render('<div data-i18n-ignore><p>Some note text</p></div><input value="typed words"><textarea>typed words</textarea>');
    expect(findUntranslated(d)).toEqual([]);
  });
  test('honours a custom allow-list', () => {
    expect(findUntranslated(render('<p>Iron</p>'), ['Iron'])).toEqual([]);
  });
});
