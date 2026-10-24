import { isNative } from './platform';

const CLEANUP_DELAY_MS = 60000;
let lastNativeFile = null;

function downloadViaBrowser(filename, json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The Capacitor WebView ignores the `download` attribute, so inside the Android shell the
// JSON is written to the app-private cache and handed to the system share sheet, from which
// the user chooses where to save it. The cached copy is removed a minute later (the receiving
// app may read it lazily, so it is not deleted immediately) and any stale copy is removed
// before the next export. The data is never logged.
//
// Resolves true when the file was saved/shared, false when the user dismissed the share
// sheet. Rejects (honest error) if the file cannot be written or shared.
export async function downloadJson(filename, data) {
  const json = JSON.stringify(data, null, 2);
  if (!isNative()) {
    downloadViaBrowser(filename, json);
    return true;
  }

  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const remove = (path) => Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
  if (lastNativeFile) { await remove(lastNativeFile); lastNativeFile = null; }

  let uri;
  try {
    const res = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    uri = res.uri;
    lastNativeFile = filename;
  } catch (e) {
    throw new Error('Could not save your data on this device.');
  }

  try {
    await Share.share({ title: filename, url: uri });
    return true;
  } catch (e) {
    if (/cancel/i.test((e && e.message) || '')) return false;
    throw new Error('Could not open the share sheet to save your data.');
  } finally {
    setTimeout(() => {
      remove(filename);
      if (lastNativeFile === filename) lastNativeFile = null;
    }, CLEANUP_DELAY_MS);
  }
}
