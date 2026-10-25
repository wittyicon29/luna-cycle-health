// Pure helpers for day-log patches. A patch is { set: {field: value}, clear: [field] }.
export const FIELDS = ['mood', 'symptoms', 'flow', 'sleep_hours', 'water_glasses', 'medications_taken', 'note'];

const clone = v => (Array.isArray(v) ? v.slice() : v);

function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false; // 0 and false are real values
}

function normalise(obj) {
  const out = {};
  FIELDS.forEach(f => { if (obj && !isBlank(obj[f])) out[f] = clone(obj[f]); });
  return out;
}

export function entryToPayload(entry) { return normalise(entry); }

export function applyPatch(entry, { set = {}, clear = [] } = {}) {
  const payload = entryToPayload(entry);
  (clear || []).forEach(f => { delete payload[f]; });
  Object.keys(set || {}).forEach(f => { if (FIELDS.includes(f)) payload[f] = clone(set[f]); });
  return normalise(payload);
}

export function mergePatches(older = {}, newer = {}) {
  const oSet = older.set || {}; const nSet = newer.set || {};
  const oClear = older.clear || []; const nClear = newer.clear || [];
  const set = {};
  Object.keys(oSet).forEach(f => { if (!nClear.includes(f)) set[f] = clone(oSet[f]); });
  Object.keys(nSet).forEach(f => { set[f] = clone(nSet[f]); });
  const clear = [];
  [...oClear, ...nClear].forEach(f => { if (!(f in nSet) && !clear.includes(f)) clear.push(f); });
  return { set, clear };
}
