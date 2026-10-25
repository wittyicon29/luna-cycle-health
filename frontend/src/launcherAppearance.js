import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';

export const APPEARANCES = [
  { key: 'default', label: 'Luna Health', hint: 'The standard Luna moon icon' },
  { key: 'notes', label: 'Notes', hint: 'Plain notepad icon' },
  { key: 'planner', label: 'Daily Planner', hint: 'Plain calendar-page icon' },
  { key: 'journal', label: 'Journal', hint: 'Plain closed-book icon' },
  { key: 'checklist', label: 'Checklist', hint: 'Plain ticked-list icon' },
  { key: 'organizer', label: 'Organizer', hint: 'Plain folder icon' },
];

const KEYS = APPEARANCES.map(a => a.key);
const FAILED = 'Could not change the app appearance';

// registerPlugin returns a Capacitor Proxy whose `then` throws on native: use it only inside plain
// functions and never return it from async code (same pitfall as tokenStore.js).
const plugin = registerPlugin('LauncherAppearance');

export const isDiscreet = key => KEYS.includes(key) && key !== 'default';

export async function getAppearance() {
  if (!isNative()) return 'default';
  try {
    const res = await plugin.getAppearance();
    return res && KEYS.includes(res.appearance) ? res.appearance : 'default';
  } catch (e) {
    return 'default';
  }
}

export async function setAppearance(key) {
  if (!isNative() || typeof key !== 'string' || !KEYS.includes(key)) throw new Error(FAILED);
  let res;
  try {
    res = await plugin.setAppearance({ appearance: key });
  } catch (e) {
    throw new Error(FAILED);
  }
  if (!res || res.appearance !== key) throw new Error(FAILED);
  return key;
}
