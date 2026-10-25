const mockPlugin = { getAppearance: jest.fn(), setAppearance: jest.fn() };
jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@capacitor/core', () => ({ registerPlugin: () => mockPlugin }));

const { isNative } = require('./platform');
const la = require('./launcherAppearance');
const fs = require('fs');
const path = require('path');

beforeEach(() => {
  isNative.mockReturnValue(true);
  mockPlugin.getAppearance.mockResolvedValue({ appearance: 'notes' });
  mockPlugin.setAppearance.mockImplementation(async ({ appearance }) => ({ appearance }));
});

test('the six appearances, in order, with the agreed labels', () => {
  expect(la.APPEARANCES.map(a => a.key)).toEqual(['default', 'notes', 'planner', 'journal', 'checklist', 'organizer']);
  expect(la.APPEARANCES.map(a => a.label)).toEqual(['Luna Health', 'Notes', 'Daily Planner', 'Journal', 'Checklist', 'Organizer']);
  expect(la.APPEARANCES.every(a => typeof a.hint === 'string' && a.hint.length > 0)).toBe(true);
});

test('labels and keys match the Android string resources and manifest', () => {
  const main = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
  const strings = fs.readFileSync(path.join(main, 'res', 'values', 'strings.xml'), 'utf8');
  const manifest = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
  for (const { key, label } of la.APPEARANCES) {
    expect(strings).toContain(`<string name="launcher_label_${key}">${label}</string>`);
    expect(manifest).toContain(`android:name=".Launcher${key[0].toUpperCase()}${key.slice(1)}"`);
  }
});

test('web: get resolves default, set rejects, plugin untouched', async () => {
  isNative.mockReturnValue(false);
  expect(await la.getAppearance()).toBe('default');
  await expect(la.setAppearance('notes')).rejects.toThrow('Could not change the app appearance');
  expect(mockPlugin.getAppearance).not.toHaveBeenCalled();
});

test('native get returns the plugin value; unknown or failing values fall back to default', async () => {
  expect(await la.getAppearance()).toBe('notes');
  mockPlugin.getAppearance.mockResolvedValue({ appearance: 'bogus' });
  expect(await la.getAppearance()).toBe('default');
  mockPlugin.getAppearance.mockRejectedValue(new Error('x'));
  expect(await la.getAppearance()).toBe('default');
  mockPlugin.getAppearance.mockResolvedValue(undefined);
  expect(await la.getAppearance()).toBe('default');
});

test('set passes the key through and returns it', async () => {
  expect(await la.setAppearance('journal')).toBe('journal');
  expect(mockPlugin.setAppearance).toHaveBeenCalledWith({ appearance: 'journal' });
});

test('set rejects invalid keys without calling the plugin', async () => {
  for (const bad of ['', null, undefined, 'Notes', 'notes ', 'calendar', 5, {}]) {
    await expect(la.setAppearance(bad)).rejects.toThrow('Could not change the app appearance');
  }
  expect(mockPlugin.setAppearance).not.toHaveBeenCalled();
});

test('set rejects when the plugin fails or reports a different key, with a generic message', async () => {
  mockPlugin.setAppearance.mockRejectedValue(new Error('internal detail'));
  await expect(la.setAppearance('notes')).rejects.toThrow('Could not change the app appearance');
  mockPlugin.setAppearance.mockResolvedValue({ appearance: 'planner' });
  await expect(la.setAppearance('notes')).rejects.toThrow('Could not change the app appearance');
});

test('isDiscreet', () => {
  expect(la.isDiscreet('default')).toBe(false);
  expect(la.isDiscreet('notes')).toBe(true);
  expect(la.isDiscreet(undefined)).toBe(false);
  expect(la.isDiscreet('bogus')).toBe(false);
});

test('a thenable plugin proxy is never resolved from async code', async () => {
  const proxy = { ...mockPlugin };
  Object.defineProperty(proxy, 'then', { get() { throw new Error('"LauncherAppearance.then()" is not implemented on android'); } });
  jest.resetModules();
  jest.doMock('./platform', () => ({ isNative: () => true }));
  jest.doMock('@capacitor/core', () => ({ registerPlugin: () => proxy }));
  const fresh = require('./launcherAppearance');
  expect(await fresh.getAppearance()).toBe('notes');
});
