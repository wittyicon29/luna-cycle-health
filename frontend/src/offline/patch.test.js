import { FIELDS, entryToPayload, applyPatch, mergePatches } from './patch';

test('FIELDS lists the editable day fields', () => {
  expect(FIELDS).toEqual(['mood', 'symptoms', 'flow', 'sleep_hours', 'water_glasses', 'medications_taken', 'note']);
});

test('entryToPayload keeps fields and zeros, drops date, updated_at, empties', () => {
  const entry = { date: '2026-01-01', updated_at: 'x', mood: 3, sleep_hours: 0, water_glasses: 0, symptoms: [], medications_taken: [], note: '  ', flow: null };
  expect(entryToPayload(entry)).toEqual({ mood: 3, sleep_hours: 0, water_glasses: 0 });
  expect(entryToPayload(null)).toEqual({});
});

test('applyPatch sets, keeps zeros and drops date', () => {
  const e = { date: '2026-01-01', sleep_hours: 0, note: 'n', mood: 2 };
  expect(applyPatch(e, { set: { mood: 4 } })).toEqual({ sleep_hours: 0, note: 'n', mood: 4 });
});

test('applyPatch clear removes a field; clearing the last one gives {}', () => {
  expect(applyPatch({ mood: 2, note: 'n' }, { clear: ['mood'] })).toEqual({ note: 'n' });
  expect(applyPatch({ mood: 2 }, { clear: ['mood'] })).toEqual({});
});

test('applyPatch: clear before set, set of zero kept, blank values normalised away', () => {
  expect(applyPatch({ mood: 2 }, { set: { mood: 5 }, clear: ['mood'] })).toEqual({ mood: 5 });
  expect(applyPatch({}, { set: { water_glasses: 0, note: '', symptoms: [] } })).toEqual({ water_glasses: 0 });
});

test('applyPatch never mutates its input', () => {
  const e = { mood: 2, symptoms: ['a'] };
  const patch = { set: { symptoms: ['b'] }, clear: ['mood'] };
  const copyE = JSON.parse(JSON.stringify(e));
  const copyP = JSON.parse(JSON.stringify(patch));
  const out = applyPatch(e, patch);
  out.symptoms.push('z');
  expect(e).toEqual(copyE);
  expect(patch).toEqual(copyP);
});

describe('mergePatches truth table', () => {
  test('set then set: newer wins', () => {
    expect(mergePatches({ set: { mood: 1 }, clear: [] }, { set: { mood: 2 }, clear: [] })).toEqual({ set: { mood: 2 }, clear: [] });
  });
  test('set then clear: ends cleared', () => {
    expect(mergePatches({ set: { mood: 1, note: 'a' }, clear: [] }, { set: {}, clear: ['mood'] })).toEqual({ set: { note: 'a' }, clear: ['mood'] });
  });
  test('clear then set: ends set', () => {
    expect(mergePatches({ set: {}, clear: ['mood'] }, { set: { mood: 3 }, clear: [] })).toEqual({ set: { mood: 3 }, clear: [] });
  });
  test('clear then clear: single clear', () => {
    expect(mergePatches({ clear: ['mood'] }, { clear: ['mood'] })).toEqual({ set: {}, clear: ['mood'] });
  });
  test('disjoint fields combine', () => {
    expect(mergePatches({ set: { mood: 1 }, clear: ['note'] }, { set: { flow: 2 }, clear: ['symptoms'] }))
      .toEqual({ set: { mood: 1, flow: 2 }, clear: ['note', 'symptoms'] });
  });
  test('merged equals sequential application, zeros kept', () => {
    const base = { mood: 1, note: 'x', sleep_hours: 7 };
    const a = { set: { sleep_hours: 0 }, clear: ['note'] };
    const b = { set: { note: 'y' }, clear: ['mood'] };
    expect(applyPatch(base, mergePatches(a, b))).toEqual(applyPatch(applyPatch(base, a), b));
  });
  test('does not mutate inputs', () => {
    const a = { set: { mood: 1 }, clear: ['note'] };
    const b = { set: { note: 'z' }, clear: ['mood'] };
    const ca = JSON.parse(JSON.stringify(a)); const cb = JSON.parse(JSON.stringify(b));
    mergePatches(a, b);
    expect(a).toEqual(ca); expect(b).toEqual(cb);
  });
});
