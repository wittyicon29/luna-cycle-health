const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));

const store = require('./store');

const snapshot = require('./snapshot');

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  localStorage.clear();
  mockData.clear();
  await store.__resetForTests();
});

const E = 'a@x.com';

test('empty snapshot has null parts and {} logs', async () => {
  expect(await snapshot.loadSnapshot(E)).toEqual({ periods: null, logs: {}, medications: null, consents: null, authStatus: null, fetchedAt: null });
});

test('round trips slices; partial slices do not erase others', async () => {
  await snapshot.saveSlice(E, 'periods', [{ id: 1 }]);
  await snapshot.saveSlice(E, 'medications', [{ id: 2 }]);
  await snapshot.saveSlice(E, 'consents', { ai: true });
  await snapshot.saveSlice(E, 'authStatus', { verified: true });
  await snapshot.saveSlice(E, 'periods', [{ id: 3 }]);
  const s = await snapshot.loadSnapshot(E);
  expect(s).toMatchObject({ periods: [{ id: 3 }], medications: [{ id: 2 }], consents: { ai: true }, authStatus: { verified: true } });
  expect(typeof s.fetchedAt).toBe('number');
});

test('logs merge ranges, replace changed days, keep zeros', async () => {
  await snapshot.saveSlice(E, 'logs', { '2026-03-01': { date: '2026-03-01', mood: 2, sleep_hours: 0 }, '2026-03-02': { date: '2026-03-02', mood: 3 } });
  await snapshot.saveSlice(E, 'logs', { '2026-03-02': { date: '2026-03-02', mood: 5 }, '2026-03-03': { date: '2026-03-03', water_glasses: 0 } });
  const { logs } = await snapshot.loadSnapshot(E);
  expect(Object.keys(logs)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  expect(logs['2026-03-01'].sleep_hours).toBe(0);
  expect(logs['2026-03-02'].mood).toBe(5);
  expect(logs['2026-03-03'].water_glasses).toBe(0);
});

test('with a range, cached days inside it that the server no longer has are dropped', async () => {
  await snapshot.saveSlice(E, 'logs', { '2026-03-01': { mood: 1 }, '2026-03-10': { mood: 2 } });
  await snapshot.saveSlice(E, 'logs', { '2026-03-02': { mood: 3 } }, { from: '2026-03-01', to: '2026-03-05' });
  expect(Object.keys((await snapshot.loadSnapshot(E)).logs)).toEqual(['2026-03-02', '2026-03-10']);
});

test('prunes entries older than 400 days from the latest date', async () => {
  // latest 2026-03-01 -> cutoff 2025-01-25 (400 days earlier)
  await snapshot.saveSlice(E, 'logs', {
    '2025-01-24': { mood: 1 }, '2025-01-25': { mood: 2 }, '2026-03-01': { mood: 3 },
  });
  expect(Object.keys((await snapshot.loadSnapshot(E)).logs)).toEqual(['2025-01-25', '2026-03-01']);
});

test('input is not mutated', async () => {
  const input = { '2020-01-01': { mood: 1 }, '2026-03-01': { mood: 3 } };
  const copy = JSON.parse(JSON.stringify(input));
  await snapshot.saveSlice(E, 'logs', input);
  expect(input).toEqual(copy);
});

test('another email sees nothing; clearSnapshot wipes', async () => {
  await snapshot.saveSlice(E, 'periods', [{ id: 1 }]);
  expect((await snapshot.loadSnapshot('b@x.com')).periods).toBeNull();
  await snapshot.clearSnapshot(E);
  expect((await snapshot.loadSnapshot(E)).periods).toBeNull();
});

test('nothing plaintext in localStorage', async () => {
  await snapshot.saveSlice(E, 'logs', { '2026-03-01': { note: 'SENTINEL-NOTE' } });
  await snapshot.saveSlice(E, 'periods', [{ start_date: '2026-02-01', notes: 'SENTINEL-P' }]);
  Object.values(localStorage).forEach(v => expect(v).not.toContain('SENTINEL'));
});

test('a corrupt slice reads as empty', async () => {
  await snapshot.saveSlice(E, 'periods', [{ id: 1 }]);
  const key = Object.keys(localStorage).find(k => k.endsWith('_snap_periods'));
  localStorage.setItem(key, 'garbage');
  expect((await snapshot.loadSnapshot(E)).periods).toBeNull();
});

test('a far-future date does not wipe real history from the prune anchor', async () => {
  const { localDateString } = require('../localDate');
  const { addDays } = require('../calendarGrid');
  const recent = addDays(localDateString(), -10);
  await snapshot.saveSlice(E, 'logs', { [recent]: { mood: 1 }, '2999-01-01': { mood: 2 } });
  const { logs } = await snapshot.loadSnapshot(E);
  expect(Object.keys(logs)).toEqual([recent, '2999-01-01']);
});

test('hasSlice tells an empty cached logs map from nothing cached', async () => {
  expect(await snapshot.hasSlice(E, 'logs')).toBe(false);
  await snapshot.saveSlice(E, 'logs', {});
  expect(await snapshot.hasSlice(E, 'logs')).toBe(true);
  expect(await snapshot.hasSlice(E, 'periods')).toBe(false);
  expect(await snapshot.hasSlice(E, 'nope')).toBe(false);
});
