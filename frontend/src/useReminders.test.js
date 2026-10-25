import React from 'react';
import { render, act } from '@testing-library/react';
import { useReminders } from './useReminders';
import { isNative } from './platform';
import { API } from './api';
import { cancelAllReminders, rebuildReminders } from './reminderScheduler';
import { App } from '@capacitor/app';
import { localDateString } from './localDate';
import { getAccessToken } from './tokenStore';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('./reminderScheduler', () => ({ cancelAllReminders: jest.fn(), rebuildReminders: jest.fn() }));
jest.mock('./api', () => ({ API: { periods: { prediction: jest.fn() } } }));
jest.mock('./tokenStore', () => ({ getAccessToken: jest.fn() }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));

const ON = { version: 1, periodExpected: { enabled: true, daysBefore: 2, time: '09:00' }, dailyLog: { enabled: false, time: '21:00' }, lateCheckIn: { enabled: false }, explicit: false };
const OFF = { ...ON, periodExpected: { ...ON.periodExpected, enabled: false } };
const P1 = [{ start_date: '2026-10-01', created_at: '2026-10-02T12:00:00.123456' }, { start_date: '2026-09-03', created_at: '2026-09-04T12:00:00.5' }];

function Probe(props) { useReminders(props); return null; }
const flush = async (ms = 0) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
let listener; let remove;

beforeEach(() => {
  jest.useFakeTimers();
  isNative.mockReturnValue(true);
  getAccessToken.mockReturnValue('t');
  API.periods.prediction.mockResolvedValue({ next: 'x' });
  cancelAllReminders.mockResolvedValue();
  rebuildReminders.mockResolvedValue({});
  remove = jest.fn();
  App.addListener.mockImplementation(async (_n, cb) => { listener = cb; return { remove }; });
});
afterEach(() => jest.useRealTimers());

test('web does nothing', async () => {
  isNative.mockReturnValue(false);
  render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(1000);
  expect(API.periods.prediction).not.toHaveBeenCalled();
  expect(rebuildReminders).not.toHaveBeenCalled();
});

test('native rebuilds after debounce with prediction and period summary', async () => {
  render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(499);
  expect(rebuildReminders).not.toHaveBeenCalled();
  await flush(1);
  expect(API.periods.prediction).toHaveBeenCalledWith('t');
  expect(rebuildReminders).toHaveBeenCalledTimes(1);
  expect(rebuildReminders).toHaveBeenCalledWith({ prefs: ON, prediction: { next: 'x' }, lastPeriodStart: '2026-10-01', lastLoggedOn: '2026-10-02' });
});

test('quick changes debounce to one rebuild', async () => {
  const { rerender } = render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(200);
  rerender(<Probe token="t" periods={[...P1]} prefs={ON} />);
  await flush(200);
  rerender(<Probe token="t" periods={[...P1]} prefs={ON} />);
  await flush(600);
  expect(rebuildReminders).toHaveBeenCalledTimes(1);
});

test('prediction failure still rebuilds with null', async () => {
  API.periods.prediction.mockRejectedValue(new Error('x'));
  render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(500);
  expect(rebuildReminders).toHaveBeenCalledWith(expect.objectContaining({ prediction: null }));
});

test('nothing enabled cancels only', async () => {
  render(<Probe token="t" periods={P1} prefs={OFF} />);
  await flush(500);
  expect(cancelAllReminders).toHaveBeenCalledTimes(1);
  expect(API.periods.prediction).not.toHaveBeenCalled();
  expect(rebuildReminders).not.toHaveBeenCalled();
});

test('resume triggers a rebuild; inactive does not; listener removed on unmount', async () => {
  const { unmount } = render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(500);
  expect(rebuildReminders).toHaveBeenCalledTimes(1);
  await act(async () => { listener({ isActive: false }); });
  await flush(600);
  expect(rebuildReminders).toHaveBeenCalledTimes(1);
  await act(async () => { listener({ isActive: true }); });
  await flush(500);
  expect(rebuildReminders).toHaveBeenCalledTimes(2);
  unmount();
  expect(remove).toHaveBeenCalled();
});

test('unmount before debounce runs nothing', async () => {
  const { unmount } = render(<Probe token="t" periods={P1} prefs={ON} />);
  unmount();
  await flush(1000);
  expect(API.periods.prediction).not.toHaveBeenCalled();
  expect(rebuildReminders).not.toHaveBeenCalled();
});

test('unmount during the prediction await skips the rebuild', async () => {
  let resolve;
  API.periods.prediction.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { unmount } = render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(500);
  unmount();
  await act(async () => { resolve({ next: 'y' }); });
  expect(rebuildReminders).not.toHaveBeenCalled();
});

test('prediction failing after a success reuses the cached prediction', async () => {
  const { rerender } = render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(500);
  API.periods.prediction.mockRejectedValue(new Error('x'));
  rerender(<Probe token="t" periods={[...P1]} prefs={ON} />);
  await flush(500);
  expect(rebuildReminders).toHaveBeenCalledTimes(2);
  expect(rebuildReminders.mock.calls[1][0].prediction).toEqual({ next: 'x' });
});

test('session expiring during the prediction await skips the rebuild', async () => {
  API.periods.prediction.mockImplementation(async () => { getAccessToken.mockReturnValue(null); return { next: 'x' }; });
  render(<Probe token="t" periods={P1} prefs={ON} />);
  await flush(500);
  expect(rebuildReminders).not.toHaveBeenCalled();
});

test('session already gone when the debounce fires does nothing', async () => {
  render(<Probe token="t" periods={P1} prefs={ON} />);
  getAccessToken.mockReturnValue(null);
  await flush(600);
  expect(API.periods.prediction).not.toHaveBeenCalled();
  expect(rebuildReminders).not.toHaveBeenCalled();
  expect(cancelAllReminders).not.toHaveBeenCalled();
});

describe('naive UTC created_at (run under TZ=Asia/Kolkata and TZ=America/Los_Angeles)', () => {
  const lastLoggedOn = async created_at => {
    render(<Probe token="t" periods={[{ start_date: '2026-10-24', created_at }]} prefs={ON} />);
    await flush(500);
    return rebuildReminders.mock.calls[0][0].lastLoggedOn;
  };
  const only = (tz, name, fn) => (process.env.TZ === tz ? test : test.skip)(`${tz}: ${name}`, fn);
  only('Asia/Kolkata', '02:00 local on Oct 25 (20:30Z Oct 24) counts as Oct 25', async () => {
    expect(await lastLoggedOn('2026-10-24T20:30:00.000000')).toBe('2026-10-25');
  });
  only('America/Los_Angeles', '19:00 local on Oct 24 (02:00Z Oct 25) counts as Oct 24', async () => {
    expect(await lastLoggedOn('2026-10-25T02:00:00.000000')).toBe('2026-10-24');
  });
  test('explicit offsets are not re-interpreted', async () => {
    expect(await lastLoggedOn('2026-10-25T02:00:00Z')).toBe(localDateString(new Date('2026-10-25T02:00:00Z')));
  });
});
