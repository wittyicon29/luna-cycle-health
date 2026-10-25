import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RemindersPanel from './RemindersPanel';
import { isNative } from './platform';
import { getReminderPermission, requestReminderPermission } from './reminderScheduler';
import { DEFAULT_PREFS } from './reminderPrefs';
import { App } from '@capacitor/app';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));
jest.mock('./reminderScheduler', () => ({ getReminderPermission: jest.fn(), requestReminderPermission: jest.fn() }));

const ON = { ...DEFAULT_PREFS, periodExpected: { ...DEFAULT_PREFS.periodExpected, enabled: true }, dailyLog: { ...DEFAULT_PREFS.dailyLog, enabled: true } };

let resume; let removeFn;
beforeEach(() => {
  removeFn = jest.fn();
  App.addListener.mockImplementation(async (_n, cb) => { resume = cb; return { remove: removeFn }; });
  isNative.mockReturnValue(true);
  getReminderPermission.mockResolvedValue('granted');
  requestReminderPermission.mockResolvedValue('granted');
});

async function setup(prefs = DEFAULT_PREFS) {
  const onChange = jest.fn();
  const utils = render(<RemindersPanel prefs={prefs} onChange={onChange} />);
  await waitFor(() => expect(getReminderPermission).toHaveBeenCalled());
  await Promise.resolve();
  return { onChange, ...utils };
}

test('renders nothing on web', async () => {
  isNative.mockReturnValue(false);
  const { container } = await (async () => render(<RemindersPanel prefs={DEFAULT_PREFS} onChange={() => {}} />))();
  expect(container).toBeEmptyDOMElement();
});

test('shows toggles, wording switch and caption without fertility words', async () => {
  const { container } = await setup();
  expect(screen.getByLabelText('Period expected soon')).toBeInTheDocument();
  expect(screen.getByLabelText('Daily check-in nudge')).toBeInTheDocument();
  expect(screen.getByLabelText('Late period check-in')).toBeInTheDocument();
  expect(screen.getByLabelText('Show details in notifications')).toBeInTheDocument();
  expect(screen.getByText('Reminders arrive within a few minutes of the set time.')).toBeInTheDocument();
  expect(screen.getByText(/details stay hidden while your phone is locked/i)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/ovulat|fertil|pregnan/i);
});

test('granted permission enables directly', async () => {
  const { onChange } = await setup();
  fireEvent.click(screen.getByLabelText('Daily check-in nudge'));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls[0][0].dailyLog.enabled).toBe(true);
  expect(requestReminderPermission).not.toHaveBeenCalled();
});

test('prompt permission requests first; denied does not enable', async () => {
  getReminderPermission.mockResolvedValue('prompt');
  requestReminderPermission.mockResolvedValue('denied');
  const { onChange } = await setup();
  fireEvent.click(screen.getByLabelText('Late period check-in'));
  expect(await screen.findByText(/notifications are turned off/i)).toHaveTextContent(/Android Settings/);
  expect(requestReminderPermission).toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test('prompt permission granted enables', async () => {
  getReminderPermission.mockResolvedValue('prompt');
  const { onChange } = await setup();
  fireEvent.click(screen.getByLabelText('Late period check-in'));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls[0][0].lateCheckIn.enabled).toBe(true);
});

test('time and days-before controls call onChange', async () => {
  const { onChange } = await setup(ON);
  fireEvent.change(screen.getByLabelText('Daily check-in reminder time'), { target: { value: '20:30' } });
  expect(onChange.mock.calls[0][0].dailyLog.time).toBe('20:30');
  const select = screen.getByLabelText('Days before');
  expect(Array.from(select.options).map(o => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  fireEvent.change(select, { target: { value: '5' } });
  expect(onChange.mock.calls[1][0].periodExpected.daysBefore).toBe(5);
});

test('all interactive controls have a 44px hit area', async () => {
  const { container } = await setup(ON);
  const controls = container.querySelectorAll('input[type="checkbox"], input[type="time"], select');
  expect(controls.length).toBeGreaterThan(4);
  controls.forEach(el => {
    const target = el.type === 'checkbox' ? el.closest('label') : el;
    expect(target.style.minHeight).toBe('44px');
  });
});

test('permission revoked after mount is caught on toggle', async () => {
  const { onChange } = await setup();
  getReminderPermission.mockResolvedValue('denied');
  requestReminderPermission.mockResolvedValue('denied');
  fireEvent.click(screen.getByLabelText('Daily check-in nudge'));
  expect(await screen.findByText(/notifications are turned off/i)).toBeInTheDocument();
  expect(requestReminderPermission).toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test('resume refreshes permission and shows a warning when a toggle is on', async () => {
  await setup(ON);
  await waitFor(() => expect(resume).toBeDefined());
  expect(screen.queryByText(/so these reminders won't appear/i)).not.toBeInTheDocument();
  getReminderPermission.mockResolvedValue('denied');
  await act(async () => { resume({ isActive: true }); });
  expect(await screen.findByText(/so these reminders won't appear/i)).toBeInTheDocument();
});

test('resume listener is removed on unmount', async () => {
  const { unmount } = await setup();
  await waitFor(() => expect(App.addListener).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  unmount();
  expect(removeFn).toHaveBeenCalled();
});

test('edits during an in-flight permission request are kept and double taps ignored', async () => {
  getReminderPermission.mockResolvedValue('prompt');
  let resolve;
  requestReminderPermission.mockImplementation(() => new Promise(r => { resolve = r; }));
  const onChange = jest.fn();
  const { rerender } = render(<RemindersPanel prefs={ON} onChange={onChange} />);
  await waitFor(() => expect(getReminderPermission).toHaveBeenCalled());
  fireEvent.click(screen.getByLabelText('Late period check-in'));
  fireEvent.click(screen.getByLabelText('Late period check-in'));
  await waitFor(() => expect(requestReminderPermission).toHaveBeenCalledTimes(1));
  const edited = { ...ON, dailyLog: { ...ON.dailyLog, time: '20:00' } };
  rerender(<RemindersPanel prefs={edited} onChange={onChange} />);
  await act(async () => { resolve('granted'); });
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.lateCheckIn.enabled).toBe(true);
  expect(next.dailyLog.time).toBe('20:00');
  expect(requestReminderPermission).toHaveBeenCalledTimes(1);
});

test('explicit helper text is linked to its checkbox', async () => {
  await setup();
  const box = screen.getByLabelText('Show details in notifications');
  expect(document.getElementById(box.getAttribute('aria-describedby'))).toHaveTextContent(/stay hidden/i);
});
