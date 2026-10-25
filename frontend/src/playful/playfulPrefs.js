import { useSyncExternalStore } from 'react';

export const PLAYFUL_KEY = 'luna_playful';
const MODES = ['normal', 'quiet'];
const listeners = new Set();

export function defaultMode() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'quiet' : 'normal';
  } catch (e) { return 'normal'; }
}

export function loadPlayful() {
  try {
    const stored = localStorage.getItem(PLAYFUL_KEY);
    if (MODES.includes(stored)) return stored;
  } catch (e) { /* storage unavailable */ }
  return defaultMode();
}

let mode = loadPlayful();

export function savePlayful(next) {
  const value = MODES.includes(next) ? next : defaultMode();
  try { localStorage.setItem(PLAYFUL_KEY, value); } catch (e) { /* storage unavailable */ }
  mode = value;
  listeners.forEach(fn => fn());
  return value;
}

// Forget the in-memory choice after local data was wiped (storage is already cleared by the caller).
export function resetPlayful() {
  mode = loadPlayful();
  listeners.forEach(fn => fn());
}

export function subscribePlayful(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getMode = () => mode;
export const getPlayful = getMode;

export function usePlayful() {
  const current = useSyncExternalStore(subscribePlayful, getMode, getMode);
  return { mode: current, setMode: savePlayful, animated: current === 'normal' };
}
