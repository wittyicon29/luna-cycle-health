const mockLN = {
  checkPermissions: jest.fn(), requestPermissions: jest.fn(), createChannel: jest.fn(),
  getPending: jest.fn(), cancel: jest.fn(), removeAllDeliveredNotifications: jest.fn(), schedule: jest.fn(),
};
jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mockLN }));

const { isNative } = require('./platform');
const sched = require('./reminderScheduler');
const { DEFAULT_PREFS } = require('./reminderPrefs');

const prefs = (over = {}) => ({ ...DEFAULT_PREFS, dailyLog: { enabled: true, time: '21:00' }, ...over });
const NOW = new Date(2026, 9, 1, 8, 0);

beforeEach(() => {
  localStorage.clear();
  isNative.mockReturnValue(true);
  mockLN.checkPermissions.mockResolvedValue({ display: 'granted' });
  mockLN.requestPermissions.mockResolvedValue({ display: 'granted' });
  mockLN.createChannel.mockResolvedValue(undefined);
  mockLN.getPending.mockResolvedValue({ notifications: [{ id: 5 }, { id: 6 }] });
  mockLN.cancel.mockResolvedValue(undefined);
  mockLN.removeAllDeliveredNotifications.mockResolvedValue(undefined);
  mockLN.schedule.mockResolvedValue(undefined);
});

test('web: every function is a no-op', async () => {
  isNative.mockReturnValue(false);
  expect(await sched.rebuildReminders({ prefs: prefs(), now: NOW })).toEqual({ skipped: 'web' });
  expect(await sched.getReminderPermission()).toBe('unavailable');
  await sched.cancelAllReminders();
  expect(mockLN.schedule).not.toHaveBeenCalled();
  expect(mockLN.getPending).not.toHaveBeenCalled();
});

test('nothing enabled: cancels what was scheduled and schedules nothing', async () => {
  const result = await sched.rebuildReminders({ prefs: DEFAULT_PREFS, now: NOW });
  expect(result).toEqual({ skipped: 'disabled' });
  expect(mockLN.cancel).toHaveBeenCalledWith({ notifications: [{ id: 5 }, { id: 6 }] });
  expect(mockLN.schedule).not.toHaveBeenCalled();
});

test('permission not granted: never prompts, never schedules', async () => {
  mockLN.checkPermissions.mockResolvedValue({ display: 'denied' });
  expect(await sched.rebuildReminders({ prefs: prefs(), now: NOW })).toEqual({ skipped: 'no-permission' });
  expect(mockLN.requestPermissions).not.toHaveBeenCalled();
  expect(mockLN.schedule).not.toHaveBeenCalled();
});

test('schedules the plan on a private channel with inexact alarms, after cancelling the old plan', async () => {
  const result = await sched.rebuildReminders({ prefs: prefs(), prediction: null, now: NOW });
  expect(result.scheduled).toBeGreaterThan(0);
  expect(mockLN.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'reminders', importance: 3, visibility: 0 }));
  const order = [mockLN.cancel, mockLN.schedule].map(f => f.mock.invocationCallOrder[0]);
  expect(order[0]).toBeLessThan(order[1]);
  const { notifications } = mockLN.schedule.mock.calls[0][0];
  expect(notifications).toHaveLength(result.scheduled);
  for (const n of notifications) {
    expect(n.channelId).toBe('reminders');
    expect(n.schedule.allowWhileIdle).toBe(true);
    expect(n.schedule.at).toBeInstanceOf(Date);
    expect(n.schedule.exact).toBeUndefined();
  }
});

test('neutral wording by default for every kind, explicit only when opted in', () => {
  for (const kind of ['periodExpected', 'dailyLog', 'lateCheckIn']) {
    expect(sched.reminderText(kind, DEFAULT_PREFS)).toEqual({ title: 'Luna', body: 'Time for your check-in.' });
  }
  const explicit = { ...DEFAULT_PREFS, explicit: true };
  expect(sched.reminderText('periodExpected', explicit).body).toBe('Your period is expected in 2 days.');
  expect(sched.reminderText('periodExpected', { ...explicit, periodExpected: { ...explicit.periodExpected, daysBefore: 1 } }).body).toBe('Your period is expected in 1 day.');
  expect(sched.reminderText('dailyLog', explicit).body).toBe('Have you logged today?');
  const late = sched.reminderText('lateCheckIn', explicit).body;
  expect(late).toBe('Your period may be a little late. Tap to log or check in.');
  expect(JSON.stringify([explicit, late])).not.toMatch(/ovulat|fertil|pregnan/i);
});

test('a throwing plugin never rejects', async () => {
  mockLN.schedule.mockRejectedValue(new Error('boom'));
  await expect(sched.rebuildReminders({ prefs: prefs(), now: NOW })).resolves.toEqual({ skipped: 'error' });
  mockLN.getPending.mockRejectedValue(new Error('boom'));
  await expect(sched.cancelAllReminders()).resolves.toBeUndefined();
  mockLN.checkPermissions.mockRejectedValue(new Error('boom'));
  await expect(sched.getReminderPermission()).resolves.toBe('unavailable');
});

test('a thenable plugin proxy is never resolved from async code', async () => {
  // The real Capacitor proxy throws when `.then` is read; the scheduler must not return it from an async function.
  const thenThrows = { ...mockLN };
  Object.defineProperty(thenThrows, 'then', { get() { throw new Error('"LocalNotifications.then()" is not implemented on android'); } });
  jest.resetModules();
  jest.doMock('@capacitor/local-notifications', () => ({ LocalNotifications: thenThrows }));
  jest.doMock('./platform', () => ({ isNative: () => true }));
  const fresh = require('./reminderScheduler');
  mockLN.getPending.mockResolvedValue({ notifications: [] });
  expect(await fresh.rebuildReminders({ prefs: prefs(), prediction: null, now: NOW })).toMatchObject({ scheduled: expect.any(Number) });
});

test('permission request returns granted or denied only', async () => {
  expect(await sched.requestReminderPermission()).toBe('granted');
  mockLN.requestPermissions.mockResolvedValue({ display: 'prompt' });
  expect(await sched.requestReminderPermission()).toBe('denied');
});

test('concurrent rebuilds never interleave cancel/schedule pairs', async () => {
  await Promise.all([
    sched.rebuildReminders({ prefs: prefs(), now: NOW }),
    sched.rebuildReminders({ prefs: prefs(), now: NOW }),
  ]);
  const cancels = mockLN.cancel.mock.invocationCallOrder;
  const schedules = mockLN.schedule.mock.invocationCallOrder;
  const sequence = [...cancels.map(n => [n, 'c']), ...schedules.map(n => [n, 's'])]
    .sort((a, b) => a[0] - b[0]).map(x => x[1]).join('');
  expect(sequence).toBe('cscs');
});

test('teardown cancels everything and deletes the stored prefs', async () => {
  localStorage.setItem('luna_reminders', '{}');
  await sched.teardownReminders();
  expect(mockLN.cancel).toHaveBeenCalled();
  expect(mockLN.removeAllDeliveredNotifications).toHaveBeenCalled();
  expect(localStorage.getItem('luna_reminders')).toBeNull();
});

function fakePlugin() {
  const scheduled = new Set();
  const calls = [];
  mockLN.getPending.mockImplementation(async () => ({ notifications: [...scheduled].map(id => ({ id })) }));
  mockLN.cancel.mockImplementation(async ({ notifications }) => {
    calls.push('cancel');
    notifications.forEach(n => scheduled.delete(n.id));
  });
  return { scheduled, calls };
}

test('teardown during an in-flight rebuild cancels last, leaving nothing scheduled', async () => {
  const { scheduled, calls } = fakePlugin();
  let release;
  mockLN.schedule.mockImplementation(({ notifications }) => new Promise(resolve => {
    release = () => { calls.push('schedule'); notifications.forEach(n => scheduled.add(n.id)); resolve(); };
  }));
  const rebuild = sched.rebuildReminders({ prefs: prefs(), now: NOW });
  await new Promise(r => setTimeout(r, 0));
  expect(release).toBeDefined();
  localStorage.setItem('luna_reminders', '{}');
  const teardown = sched.teardownReminders();
  expect(localStorage.getItem('luna_reminders')).toBeNull();
  release();
  await Promise.all([rebuild, teardown]);
  expect(calls[calls.length - 1]).toBe('cancel');
  expect(calls).toContain('schedule');
  expect(scheduled.size).toBe(0);
});

test('cancelAllReminders queued behind a rebuild runs after it', async () => {
  const order = [];
  mockLN.schedule.mockImplementation(async () => { order.push('schedule'); });
  mockLN.removeAllDeliveredNotifications.mockImplementation(async () => { order.push('cancelAll'); });
  await Promise.all([sched.rebuildReminders({ prefs: prefs(), now: NOW }), sched.cancelAllReminders()]);
  expect(order).toEqual(['schedule', 'cancelAll']);
});

test('a rejecting plugin call inside the queue does not block later tasks', async () => {
  mockLN.getPending.mockRejectedValueOnce(new Error('boom'));
  const first = sched.cancelAllReminders();
  const second = sched.rebuildReminders({ prefs: prefs(), now: NOW });
  await expect(first).resolves.toBeUndefined();
  await expect(second).resolves.toMatchObject({ scheduled: expect.any(Number) });
});

test('rebuildReminders with no argument resolves instead of rejecting', async () => {
  // prefs is undefined, anyEnabled(undefined) is false, so the result is "disabled"
  // (or "error" if anyEnabled throws on undefined); either way it never rejects.
  const result = await sched.rebuildReminders();
  expect(['disabled', 'error']).toContain(Object.values(result)[0]);
  expect(result).toHaveProperty('skipped');
});
