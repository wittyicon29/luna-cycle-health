import { act, renderHook } from '@testing-library/react';
import { PLAYFUL_KEY, defaultMode, getPlayful, loadPlayful, savePlayful, subscribePlayful, usePlayful } from './playfulPrefs';

const setReduced = reduced => {
  window.matchMedia = jest.fn().mockImplementation(() => ({ matches: reduced }));
};

beforeEach(() => {
  localStorage.clear();
  setReduced(false);
});

test('default follows reduced-motion', () => {
  expect(defaultMode()).toBe('normal');
  setReduced(true);
  expect(defaultMode()).toBe('quiet');
  expect(loadPlayful()).toBe('quiet');
});

test('default is normal without matchMedia', () => {
  delete window.matchMedia;
  expect(defaultMode()).toBe('normal');
});

test('stored valid, invalid and unreadable values', () => {
  localStorage.setItem(PLAYFUL_KEY, 'quiet');
  expect(loadPlayful()).toBe('quiet');
  localStorage.setItem(PLAYFUL_KEY, 'wild');
  expect(loadPlayful()).toBe('normal');
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  expect(loadPlayful()).toBe('normal');
  spy.mockRestore();
});

test('savePlayful normalises, persists and notifies', () => {
  const fn = jest.fn();
  const off = subscribePlayful(fn);
  expect(savePlayful('quiet')).toBe('quiet');
  expect(localStorage.getItem(PLAYFUL_KEY)).toBe('quiet');
  expect(savePlayful('bogus')).toBe('normal');
  expect(fn).toHaveBeenCalledTimes(2);
  off();
  savePlayful('quiet');
  expect(fn).toHaveBeenCalledTimes(2);
  savePlayful('normal');
});

test('storage errors never throw', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(() => savePlayful('quiet')).not.toThrow();
  spy.mockRestore();
  savePlayful('normal');
});

test('usePlayful re-renders on outside save', () => {
  savePlayful('normal');
  const { result } = renderHook(() => usePlayful());
  expect(result.current).toMatchObject({ mode: 'normal', animated: true });
  act(() => { savePlayful('quiet'); });
  expect(result.current).toMatchObject({ mode: 'quiet', animated: false });
  act(() => { result.current.setMode('normal'); });
  expect(result.current.mode).toBe('normal');
});

test('getPlayful reflects module state even when storage fails', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  savePlayful('quiet');
  spy.mockRestore();
  expect(getPlayful()).toBe('quiet');
  savePlayful('normal');
});

test('clearLocalUserData resets the in-memory choice', () => {
  const { savePlayful, getPlayful, defaultMode } = require('./playfulPrefs');
  const { clearLocalUserData } = require('../session');
  savePlayful(defaultMode() === 'normal' ? 'quiet' : 'normal');
  expect(getPlayful()).not.toBe(defaultMode());
  clearLocalUserData();
  expect(getPlayful()).toBe(defaultMode());
});
