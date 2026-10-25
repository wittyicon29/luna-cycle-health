import { useSyncExternalStore } from 'react';
import hi from './catalogs/hi.json';
import { pseudo } from './pseudo';

export const SUPPORTED = ['en', 'hi'];
export const LANGUAGE_KEY = 'luna_language';
export const PSEUDO = 'en-XA';

const CATALOGS = { hi };
const IS_ONE = { en: n => n === 1, hi: n => n >= 0 && n <= 1 };
const listeners = new Set();

const allowed = lang => SUPPORTED.includes(lang) || (lang === PSEUDO && process.env.NODE_ENV !== 'production');

export function detectLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (SUPPORTED.includes(stored)) return stored;
  } catch (e) { /* storage unavailable */ }
  const nav = typeof navigator !== 'undefined' ? (navigator.language || (navigator.languages || [])[0]) : '';
  return /^hi([-_]|$)/i.test(String(nav || '')) ? 'hi' : 'en';
}

let current = detectLanguage();
try { document.documentElement.lang = current; } catch (e) { /* no document */ }

export const getLanguage = () => current;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(lang) {
  if (!allowed(lang)) return false;
  current = lang;
  try { localStorage.setItem(LANGUAGE_KEY, lang); } catch (e) { /* storage unavailable */ }
  try { document.documentElement.lang = lang === PSEUDO ? 'en' : lang; } catch (e) { /* no document */ }
  listeners.forEach(fn => fn());
  return true;
}

export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage, getLanguage);

function format(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (has(vars, name) && vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : m));
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const entryFor = text => (CATALOGS[current] && has(CATALOGS[current], text) ? CATALOGS[current][text] : undefined);

export function t(text, vars) {
  const entry = entryFor(text);
  const base = typeof entry === 'string' && entry ? entry : text;
  return format(current === PSEUDO ? pseudo(base) : base, vars);
}

export function tn(count, one, other, vars) {
  const num = Number(count);
  const n = Number.isFinite(num) ? num : 0;
  const entry = entryFor(one);
  let chosen;
  if (entry && typeof entry === 'object' && typeof entry.one === 'string' && typeof entry.other === 'string' && entry.one && entry.other) {
    chosen = (IS_ONE[current] || IS_ONE.en)(n) ? entry.one : entry.other;
  } else {
    chosen = IS_ONE.en(n) ? one : other;
  }
  return format(current === PSEUDO ? pseudo(chosen) : chosen, { ...vars, count: n });
}

export const intlLocale = (lang = current) => (lang === 'hi' ? 'hi-IN-u-nu-latn' : undefined);
// Locale for date formatting: English keeps the explicit 'en' the journey always used, Hindi uses the Hindi tag.
export const dateLocale = (lang = current) => (lang === 'hi' ? intlLocale('hi') : 'en');
export const languageLabel = lang => (lang === 'hi' ? 'हिन्दी' : 'English');
