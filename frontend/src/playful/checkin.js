export function buildCheckInPayload(entry, value) {
  const out = {};
  const src = entry || {};
  ['symptoms', 'medications_taken'].forEach(k => { if (Array.isArray(src[k]) && src[k].length) out[k] = [...src[k]]; });
  ['flow', 'sleep_hours', 'water_glasses'].forEach(k => { if (src[k] !== null && src[k] !== undefined) out[k] = src[k]; });
  if (typeof src.note === 'string' && src.note.trim()) out.note = src.note;
  const keep = value !== null && value !== undefined && value !== src.mood;
  if (keep) out.mood = value;
  return out;
}
