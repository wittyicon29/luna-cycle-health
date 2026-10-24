// The user's LOCAL calendar date as YYYY-MM-DD (toISOString would give the UTC date).
export function localDateString(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
