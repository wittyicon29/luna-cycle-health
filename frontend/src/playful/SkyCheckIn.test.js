import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

jest.mock('../api', () => ({ API: { logs: { list: jest.fn(), put: jest.fn() } } }));
jest.mock('./haptics', () => ({ tick: jest.fn() }));

const { API } = require('../api');
const { tick } = require('./haptics');
const { savePlayful } = require('./playfulPrefs');
const SkyCheckIn = require('./SkyCheckIn').default;

const TODAY = '2026-10-25';
const UUID = '11111111-1111-4111-8111-111111111111';
const FULL = { date: TODAY, updated_at: 'x', sleep_hours: 7, water_glasses: 0, symptoms: ['cramps'], medications_taken: [UUID], note: 'n', flow: 'light', mood: 2 };
const LABELS = ['Very low', 'Low', 'Okay', 'Good', 'Great'];

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 25, 12, 0, 0));
  savePlayful('normal');
  API.logs.list.mockResolvedValue([]);
  API.logs.put.mockResolvedValue({});
});
afterEach(() => { jest.useRealTimers(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const draw = (props = {}) => {
  const onSaved = jest.fn(); const onAddDetails = jest.fn();
  const utils = render(<SkyCheckIn token="tok" logs={{}} logsReady onSaved={onSaved} onAddDetails={onAddDetails} {...props} />);
  return { ...utils, onSaved, onAddDetails };
};
const radio = name => screen.getByRole('radio', { name });
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

test('renders the title and five unchecked options with labels', () => {
  draw();
  expect(screen.getByText("How's your sky today?")).toBeInTheDocument();
  expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  LABELS.forEach(l => {
    const r = radio(l);
    expect(r).toHaveAttribute('aria-checked', 'false');
    expect(r).toHaveTextContent(l);
    expect(r.querySelector('svg')).toBeTruthy();
  });
});

test('merges into the existing entry without losing other fields', async () => {
  const { onSaved } = draw({ logs: { [TODAY]: FULL } });
  fireEvent.click(radio('Good'));
  await flush();
  expect(API.logs.put).toHaveBeenCalledTimes(1);
  expect(API.logs.put).toHaveBeenCalledWith(TODAY, { symptoms: ['cramps'], medications_taken: [UUID], note: 'n', flow: 'light', sleep_hours: 7, water_glasses: 0, mood: 4 }, 'tok');
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(tick).toHaveBeenCalledTimes(1);
  expect(radio('Good')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText("Today's sky: Good")).toBeInTheDocument();
});

test('no entry for today sends only the mood', async () => {
  draw();
  fireEvent.click(radio('Great'));
  await flush();
  expect(API.logs.put).toHaveBeenCalledWith(TODAY, { mood: 5 }, 'tok');
});

test('quiet mode: no haptic and no pulse class', async () => {
  savePlayful('quiet');
  const { onSaved } = draw();
  fireEvent.click(radio('Okay'));
  expect(radio('Okay').className).not.toMatch(/sky-pulse/);
  await flush();
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(tick).not.toHaveBeenCalled();
});

test('normal mode: tapped button pulses', () => {
  draw();
  fireEvent.click(radio('Okay'));
  expect(radio('Okay').className).toMatch(/sky-pulse/);
});

test('tapping the selected option removes the mood (empty body is sent)', async () => {
  const { onSaved } = draw({ logs: { [TODAY]: { date: TODAY, mood: 3 } } });
  expect(radio('Okay')).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(radio('Okay'));
  await flush();
  expect(API.logs.put).toHaveBeenCalledWith(TODAY, {}, 'tok');
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(radio('Okay')).toHaveAttribute('aria-checked', 'false');
});

test('logs not ready: fetches today first and merges from that result, not the stale prop', async () => {
  API.logs.list.mockResolvedValue([{ ...FULL, mood: 1 }]);
  draw({ logsReady: false, logs: {} });
  fireEvent.click(radio('Great'));
  await flush();
  expect(API.logs.list).toHaveBeenCalledWith(TODAY, TODAY, 'tok');
  expect(API.logs.put).toHaveBeenCalledWith(TODAY, { symptoms: ['cramps'], medications_taken: [UUID], note: 'n', flow: 'light', sleep_hours: 7, water_glasses: 0, mood: 5 }, 'tok');
});

test('logs not ready and the fetch fails: error, no PUT', async () => {
  API.logs.list.mockRejectedValue(new Error('net'));
  const { onSaved } = draw({ logsReady: false });
  fireEvent.click(radio('Great'));
  await flush();
  expect(API.logs.put).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save your check-in. Try again.");
  expect(onSaved).not.toHaveBeenCalled();
  expect(radio('Great')).toHaveAttribute('aria-checked', 'false');
});

test('a failed PUT reverts the selection and shows the alert', async () => {
  API.logs.put.mockRejectedValue(new Error('boom'));
  const { onSaved } = draw({ logs: { [TODAY]: { date: TODAY, mood: 2 } } });
  fireEvent.click(radio('Great'));
  await flush();
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save your check-in. Try again.");
  expect(radio('Low')).toHaveAttribute('aria-checked', 'true');
  expect(radio('Great')).toHaveAttribute('aria-checked', 'false');
  expect(onSaved).not.toHaveBeenCalled();
  expect(tick).not.toHaveBeenCalled();
});

test('double tap while in flight sends one request, then applies the last choice once', async () => {
  const d = deferred();
  API.logs.put.mockReturnValueOnce(d.p);
  draw();
  fireEvent.click(radio('Good'));
  fireEvent.click(radio('Good'));
  await flush();
  expect(API.logs.put).toHaveBeenCalledTimes(1);
  await act(async () => { d.resolve({}); await Promise.resolve(); });
  await flush();
  // the second tap on the same value toggles it off against the saved entry
  expect(API.logs.put).toHaveBeenCalledTimes(2);
  expect(API.logs.put).toHaveBeenLastCalledWith(TODAY, {}, 'tok');
});

test('rapid A, B, C sends A then C', async () => {
  const d = deferred();
  API.logs.put.mockReturnValueOnce(d.p);
  draw({ logs: { [TODAY]: { date: TODAY, note: 'keep' } } });
  fireEvent.click(radio('Very low'));
  fireEvent.click(radio('Okay'));
  fireEvent.click(radio('Great'));
  await flush();
  await act(async () => { d.resolve({}); await Promise.resolve(); });
  await flush();
  expect(API.logs.put.mock.calls.map(c => c[1])).toEqual([{ note: 'keep', mood: 1 }, { note: 'keep', mood: 5 }]);
});

test('uses the local date near midnight', async () => {
  jest.setSystemTime(new Date(2026, 9, 25, 23, 59, 30));
  draw();
  fireEvent.click(radio('Good'));
  await flush();
  expect(API.logs.put.mock.calls[0][0]).toBe('2026-10-25');
});

test('arrow keys, Home and End move and select like the day sheet', async () => {
  draw();
  const radios = screen.getAllByRole('radio');
  expect(radios[0]).toHaveAttribute('tabindex', '0');
  expect(radios[1]).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
  await flush();
  expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
  await flush();
  expect(radios[1]).toHaveAttribute('aria-checked', 'true');
  expect(radios[1]).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(radios[1], { key: 'End' });
  await flush();
  expect(radios[4]).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(radios[4], { key: 'Home' });
  await flush();
  expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(radios[0], { key: 'ArrowLeft' });
  await flush();
  expect(radios[4]).toHaveAttribute('aria-checked', 'true');
});

test('Add details opens the day', () => {
  const { onAddDetails } = draw({ logs: { [TODAY]: { date: TODAY, mood: 3 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Add details' }));
  expect(onAddDetails).toHaveBeenCalledTimes(1);
});

test('no sensitive wording in the component text', () => {
  const { container } = draw({ logs: { [TODAY]: { date: TODAY, mood: 3 } } });
  expect(container.textContent).not.toMatch(/ovulat|fertil|pregnan|period|cycle/i);
});

test('layout wraps and can shrink', () => {
  draw();
  const group = screen.getByRole('radiogroup');
  expect(group.style.flexWrap).toBe('wrap');
  expect(radio('Okay').style.minWidth).toBe('0');
});
