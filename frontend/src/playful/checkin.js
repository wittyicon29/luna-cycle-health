// The check-in patch for a tap on `value` while `current` is the mood on screen: a repeat of it clears the mood,
// another integer 1..5 sets it. Anything else is not a mood and gives null (nothing is sent).
export function checkInPatch(current, value) {
  if (!(Number.isInteger(value) && value >= 1 && value <= 5)) return null;
  return value === current ? { set: {}, clear: ['mood'] } : { set: { mood: value }, clear: [] };
}

export function buildCheckInPayload(entry, value) {
  const out = {};
  const src = entry || {};
  ['symptoms', 'medications_taken'].forEach(k => { if (Array.isArray(src[k]) && src[k].length) out[k] = [...src[k]]; });
  ['flow', 'sleep_hours', 'water_glasses'].forEach(k => { if (src[k] !== null && src[k] !== undefined) out[k] = src[k]; });
  if (typeof src.note === 'string' && src.note.trim()) out.note = src.note;
  // Only an integer 1..5 sets a mood. Anything else (null/undefined, strings, 0, 7, NaN) clears it:
  // null/undefined clear on purpose, invalid values clear too so a bad mood is never sent.
  const valid = Number.isInteger(value) && value >= 1 && value <= 5;
  const keep = valid && value !== src.mood;
  if (keep) out.mood = value;
  return out;
}
