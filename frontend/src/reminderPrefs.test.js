import { DEFAULT_PREFS, PREFS_KEY, loadPrefs, savePrefs, clearPrefs, anyEnabled } from './reminderPrefs';

beforeEach(() => localStorage.clear());

test('defaults are all off with neutral wording', () => {
  const p = loadPrefs();
  expect(p).toEqual(DEFAULT_PREFS);
  expect(anyEnabled(p)).toBe(false);
  expect(p.explicit).toBe(false);
  expect(p.periodExpected).toMatchObject({ daysBefore: 2, time: '09:00' });
  expect(p.dailyLog.time).toBe('21:00');
});

test('round-trips saved prefs', () => {
  const saved = savePrefs({ ...DEFAULT_PREFS, dailyLog: { enabled: true, time: '20:30' } });
  expect(saved.dailyLog).toEqual({ enabled: true, time: '20:30' });
  expect(loadPrefs().dailyLog.enabled).toBe(true);
  expect(anyEnabled(loadPrefs())).toBe(true);
});

test('corrupt or unrelated stored data falls back to defaults', () => {
  localStorage.setItem(PREFS_KEY, '{not json');
  expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  localStorage.setItem(PREFS_KEY, '"a string"');
  expect(loadPrefs()).toEqual(DEFAULT_PREFS);
});

test('invalid values are normalised, never stored raw', () => {
  const saved = savePrefs({
    ...DEFAULT_PREFS,
    periodExpected: { enabled: 'yes', daysBefore: 99, time: '25:99' },
    dailyLog: { enabled: true, time: 'soon' },
    explicit: 'true',
  });
  expect(saved.periodExpected).toEqual({ enabled: false, daysBefore: 7, time: '09:00' });
  expect(saved.dailyLog).toEqual({ enabled: true, time: '21:00' });
  expect(saved.explicit).toBe(false);
  expect(savePrefs({ ...DEFAULT_PREFS, periodExpected: { ...DEFAULT_PREFS.periodExpected, daysBefore: 0 } }).periodExpected.daysBefore).toBe(1);
});

test('clearPrefs removes the stored value and storage errors never throw', () => {
  savePrefs({ ...DEFAULT_PREFS, explicit: true });
  clearPrefs();
  expect(localStorage.getItem(PREFS_KEY)).toBeNull();
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
  spy.mockRestore();
});
