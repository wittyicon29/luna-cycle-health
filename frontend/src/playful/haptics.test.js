const mockImpact = jest.fn();
const mockNative = { value: true };
const mockPlugin = {
  impact: mockImpact,
  get then() { throw new Error('"Haptics.then()" is not implemented on android'); },
};

jest.mock('../platform', () => ({ isNative: () => mockNative.value }));
jest.mock('@capacitor/haptics', () => ({ Haptics: mockPlugin }));

const { tick } = require('./haptics');
const { savePlayful } = require('./playfulPrefs');

beforeEach(() => {
  // CRA sets resetMocks, so implementations must be (re)installed per test.
  mockImpact.mockImplementation(async () => {});
  mockNative.value = true;
  savePlayful('normal');
});

test('web is a no-op', async () => {
  mockNative.value = false;
  await tick();
  expect(mockImpact).not.toHaveBeenCalled();
});

test('native + normal taps once, even if then() throws on the plugin', async () => {
  await expect(tick()).resolves.toBeUndefined();
  expect(mockImpact).toHaveBeenCalledTimes(1);
  expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
});

test('native + quiet does nothing', async () => {
  savePlayful('quiet');
  await tick();
  expect(mockImpact).not.toHaveBeenCalled();
});

test('plugin rejection is swallowed', async () => {
  mockImpact.mockImplementation(async () => { throw new Error('no vibrator'); });
  await expect(tick()).resolves.toBeUndefined();
});
