import { downloadJson } from './download';
import { isNative } from './platform';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: jest.fn(), deleteFile: jest.fn() },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));
jest.mock('@capacitor/share', () => ({ Share: { share: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  URL.createObjectURL = jest.fn(() => 'blob:luna');
  URL.revokeObjectURL = jest.fn();
  Filesystem.deleteFile.mockResolvedValue({});
});

describe('web', () => {
  beforeEach(() => isNative.mockReturnValue(false));

  test('creates a named JSON file download and cleans up', async () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toBe('luna.json');
      expect(this.href).toContain('blob:luna');
    });
    await expect(downloadJson('luna.json', { a: 1 })).resolves.toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:luna');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe('native', () => {
  beforeEach(() => {
    isNative.mockReturnValue(true);
    jest.useFakeTimers();
    Filesystem.writeFile.mockResolvedValue({ uri: 'file:///cache/x.json' });
    Share.share.mockResolvedValue({});
  });
  afterEach(() => jest.useRealTimers());

  test('writes to the cache dir as UTF-8 JSON then shares the file', async () => {
    await expect(downloadJson('x.json', { a: 1 })).resolves.toBe(true);
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'x.json', data: JSON.stringify({ a: 1 }, null, 2), directory: 'CACHE', encoding: 'utf8',
    });
    expect(Share.share).toHaveBeenCalledWith({ title: 'x.json', url: 'file:///cache/x.json' });
    expect(document.querySelector('a[download]')).toBeNull();
  });

  test('deletes the cached file after the delay', async () => {
    await downloadJson('x.json', { a: 1 });
    Filesystem.deleteFile.mockClear();
    jest.advanceTimersByTime(59000);
    expect(Filesystem.deleteFile).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({ path: 'x.json', directory: 'CACHE' });
  });

  test('a user-cancelled share resolves false without an error', async () => {
    Share.share.mockRejectedValue(new Error('Share canceled'));
    await expect(downloadJson('x.json', {})).resolves.toBe(false);
  });

  test('a write failure rejects with an honest error and does not share', async () => {
    Filesystem.writeFile.mockRejectedValue(new Error('disk full: secret'));
    await expect(downloadJson('x.json', {})).rejects.toThrow('Could not save your data');
    expect(Share.share).not.toHaveBeenCalled();
  });

  test('a share failure rejects', async () => {
    Share.share.mockRejectedValue(new Error('no activity'));
    await expect(downloadJson('x.json', {})).rejects.toThrow('share sheet');
  });
});
