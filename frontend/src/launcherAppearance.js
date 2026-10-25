import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';
import { t } from './i18n';

export const APPEARANCES = [
  { key: 'default', label: 'Luna Health', hint: 'The standard Luna moon icon' },
  { key: 'notes', label: 'Notes', hint: 'Plain notepad icon' },
  { key: 'planner', label: 'Daily Planner', hint: 'Plain calendar-page icon' },
  { key: 'journal', label: 'Journal', hint: 'Plain closed-book icon' },
  { key: 'checklist', label: 'Checklist', hint: 'Plain ticked-list icon' },
  { key: 'organizer', label: 'Organizer', hint: 'Plain folder icon' },
];

// Display name and hint for the gallery tiles, translated at render time. The keys and the English
// APPEARANCES data above are what is stored / compared; the Android launcher label itself stays English.
export function appearanceLabel(key) {
  switch (key) {
    // i18n-note: the product name stays in Latin script, so the translation equals the English text
    case 'default': return t('Luna Health');
    // i18n-note: shares the catalog entry "Notes" = नोट used elsewhere; unsure "नोट्स" would read better as an app name
    case 'notes': return t('Notes');
    case 'planner': return t('Daily Planner');
    case 'journal': return t('Journal');
    case 'checklist': return t('Checklist');
    case 'organizer': return t('Organizer');
    default: return key;
  }
}

export function appearanceHint(key) {
  switch (key) {
    case 'default': return t('The standard Luna moon icon');
    case 'notes': return t('Plain notepad icon');
    case 'planner': return t('Plain calendar-page icon');
    case 'journal': return t('Plain closed-book icon');
    case 'checklist': return t('Plain ticked-list icon');
    case 'organizer': return t('Plain folder icon');
    default: return '';
  }
}

// Icon previews for the gallery. Colours and paths mirror the Android launcher vectors
// (res/drawable/ic_launcher_fg_<key>.xml and values/launcher_colors.xml) exactly; a test keeps them in sync.
// The default icon is a raster on Android, so its entry is only a simple moon approximation.
export const APPEARANCE_ICONS = {
  default: { background: '#1A0F2E', shapes: [{ fill: '#F5EEF8', d: 'M62,26a28,28 0 1 0 0,56a22,22 0 1 1 0,-56z' }] },
  notes: { background: '#E9C46A', shapes: [
    { fill: '#FFFFFF', d: 'M34,24h40a4,4 0 0 1 4,4v52a4,4 0 0 1 -4,4H34a4,4 0 0 1 -4,-4V28a4,4 0 0 1 4,-4z' },
    { fill: '#7A869A', d: 'M38,40h32v3H38z M38,50h32v3H38z M38,60h22v3H38z' },
  ] },
  planner: { background: '#2F4B7C', shapes: [
    { fill: '#FFFFFF', d: 'M32,30h44a4,4 0 0 1 4,4v42a4,4 0 0 1 -4,4H32a4,4 0 0 1 -4,-4V34a4,4 0 0 1 4,-4z' },
    { fill: '#4A78C8', d: 'M28,34a4,4 0 0 1 4,-4h44a4,4 0 0 1 4,4v10H28z' },
    { fill: '#9AA8BF', d: 'M36,52h8v7h-8z M50,52h8v7h-8z M64,52h8v7h-8z M36,64h8v7h-8z M50,64h8v7h-8z' },
  ] },
  journal: { background: '#F0E6D8', shapes: [
    { fill: '#8A5A3C', d: 'M36,24h38a4,4 0 0 1 4,4v52a4,4 0 0 1 -4,4H36a6,6 0 0 1 -6,-6V30a6,6 0 0 1 6,-6z' },
    { fill: '#6B4430', d: 'M36,24h6v60h-6z' },
    { fill: '#F3E3C8', d: 'M48,36h22v14H48z' },
    { fill: '#F3E3C8', d: 'M48,58h22v3H48z' },
  ] },
  checklist: { background: '#2E5E4E', shapes: [
    { fill: '#FFFFFF', d: 'M34,26h40a4,4 0 0 1 4,4v48a4,4 0 0 1 -4,4H34a4,4 0 0 1 -4,-4V30a4,4 0 0 1 4,-4z' },
    { fill: '#3A9D6A', d: 'M37,40l3,3l6,-6l2,2l-8,8l-5,-5z M37,56l3,3l6,-6l2,2l-8,8l-5,-5z' },
    { fill: '#7A869A', d: 'M54,41h16v3H54z M54,57h16v3H54z' },
  ] },
  organizer: { background: '#3B3F5C', shapes: [
    { fill: '#E8A33D', d: 'M28,34a4,4 0 0 1 4,-4h14l6,6h22a4,4 0 0 1 4,4v36a4,4 0 0 1 -4,4H32a4,4 0 0 1 -4,-4z' },
    { fill: '#F5C26B', d: 'M28,46h52v30a4,4 0 0 1 -4,4H32a4,4 0 0 1 -4,-4z' },
  ] },
};

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
