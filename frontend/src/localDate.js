import { intlLocale } from './i18n';

// The user's LOCAL calendar date as YYYY-MM-DD (toISOString would give the UTC date).
export function localDateString(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// Long, human date ("September 30, 2026") for a date-only string, parsed as a LOCAL date
// so the day never shifts with the viewer's timezone.
export function formatLongDate(value, locale = intlLocale()) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
