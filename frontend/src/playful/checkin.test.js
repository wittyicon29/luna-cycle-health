import { buildCheckInPayload } from './checkin';

const FULL = {
  date: '2026-10-25', mood: 2, symptoms: ['cramps'], flow: 'light', sleep_hours: 0, water_glasses: 0,
  medications_taken: [1, 2], note: 'hello', updated_at: '2026-10-25T10:00:00Z',
};

test('null entry', () => { expect(buildCheckInPayload(null, 4)).toEqual({ mood: 4 }); });

test('keeps every field, including zeros, and drops date/updated_at', () => {
  expect(buildCheckInPayload(FULL, 4)).toEqual({
    symptoms: ['cramps'], flow: 'light', sleep_hours: 0, water_glasses: 0, medications_taken: [1, 2], note: 'hello', mood: 4,
  });
});

test('same value toggles mood off and keeps the rest', () => {
  const out = buildCheckInPayload(FULL, 2);
  expect(out.mood).toBeUndefined();
  expect(out.symptoms).toEqual(['cramps']);
  expect(out.sleep_hours).toBe(0);
});

test('entry with only the same mood yields an empty body', () => {
  expect(buildCheckInPayload({ date: 'x', mood: 3 }, 3)).toEqual({});
});

test('null/undefined value removes mood', () => {
  expect(buildCheckInPayload(FULL, null).mood).toBeUndefined();
  expect(buildCheckInPayload(FULL, undefined).mood).toBeUndefined();
});

test('empty arrays, blank note and null fields are omitted', () => {
  const out = buildCheckInPayload({ symptoms: [], medications_taken: [], note: '   ', flow: null, sleep_hours: null, water_glasses: null }, 5);
  expect(out).toEqual({ mood: 5 });
});

test('does not mutate the entry', () => {
  const copy = JSON.parse(JSON.stringify(FULL));
  buildCheckInPayload(FULL, 4);
  expect(FULL).toEqual(copy);
});

test('invalid mood values never reach the payload and clear the mood', () => {
  ['3', 0, 7, NaN, 2.5, undefined, null].forEach(v => {
    expect(buildCheckInPayload({ mood: 4, note: 'n' }, v)).toEqual({ note: 'n' });
    expect(buildCheckInPayload(null, v)).toEqual({});
  });
});
