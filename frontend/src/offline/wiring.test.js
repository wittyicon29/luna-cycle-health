/* eslint-disable testing-library/no-node-access */ // map markers and fog have no roles: read them from the DOM
import React from 'react';
import { render, act, screen, waitFor, within, fireEvent } from '@testing-library/react';

// Screens wired to the offline facade: JourneyApp (map, Today card, calendar, day sheet, log modal, reminders)
// rendered inside its provider on "native", against the in-memory fake server.

const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };
const mockApi = {};

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), API: mockApi }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn(async () => ({ remove: async () => {} })) } }));
jest.mock('../reminderScheduler', () => ({
  teardownReminders: jest.fn(),
  cancelAllReminders: jest.fn(async () => {}),
  rebuildReminders: jest.fn(async () => ({})),
  getReminderPermission: jest.fn(),
  requestReminderPermission: jest.fn(),
}));

const { makeServer, apiErr, EMPTY_ENTRY } = require('./testing/fakeServer');
const store = require('./store');
const outbox = require('./outbox');
const snapshot = require('./snapshot');
const { resetSyncState } = require('./sync');
const offlineIndex = require('./index');
const tokenStore = require('../tokenStore');
const { rebuildReminders } = require('../reminderScheduler');
const { checkInPatch } = require('../playful/checkin');
const { localDateString } = require('../localDate');
const { addDays } = require('../calendarGrid');
const { JourneyApp } = require('../App');

const E = 'w@x.com';
const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: true, ai_processing: true };
const TODAY = localDateString();
const ago = n => addDays(TODAY, -n);
const realSetTimeout = setTimeout;
const ticks = async (n = 30) => { for (let i = 0; i < n; i += 1) await act(() => new Promise(r => realSetTimeout(r, 0))); }; // eslint-disable-line no-await-in-loop

let server;
let createSpy;
let realCreate;

function installApi() {
  Object.keys(mockApi).forEach(k => { delete mockApi[k]; });
  const offlineAware = fn => jest.fn(async (...args) => {
    if (server.offline) throw apiErr(0);
    return fn(...args);
  });
  Object.assign(mockApi, server.api, {
    periods: { ...server.api.periods, prediction: offlineAware(async () => server.prediction || null), remove: jest.fn() },
    consents: {
      ...server.api.consents,
      set: offlineAware(async (purpose, granted) => { server.consents = { ...server.consents, [purpose]: granted }; return { ...server.consents }; }),
    },
    analysis: { list: offlineAware(async () => []), latest: offlineAware(async () => null) },
    chat: { history: offlineAware(async () => []) },
  });
}

function seedServer() {
  server.periods = [{ id: 'p1', start_date: ago(10), end_date: ago(6), flow_intensity: 'medium', pain_level: 2, symptoms: [], notes: '', cycle_length: null }];
  server.logs = {
    [TODAY]: { ...EMPTY_ENTRY, date: TODAY, mood: 3, note: 'server note' },
    [ago(20)]: { ...EMPTY_ENTRY, date: ago(20), mood: 2 },
  };
  server.medications = [{ id: 'm1', name: 'Iron', archived: false }];
  server.consents = { ...ALL };
  server.authStatus = { has_completed_questionnaire: true };
}

const facade = () => createSpy.mock.results[createSpy.mock.results.length - 1].value;
const renderApp = () => render(<JourneyApp token="tok" email={E} onLogout={jest.fn()} />);
const periodDots = () => [...document.querySelectorAll('.p-dot')].filter(d => /^Period:/.test(d.getAttribute('title') || ''));
const todayCard = () => document.querySelector('.today-card') || document.body;

async function waitForMap(dots = 1) {
  await waitFor(() => expect(periodDots()).toHaveLength(dots), { timeout: 3000 });
  await ticks();
}

async function openCalendar() {
  fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  return screen.findByRole('dialog', { name: 'Calendar' });
}

async function openToday() {
  const cal = await openCalendar();
  fireEvent.click(within(cal).getByRole('button', { name: 'Log today' }));
  const sheet = await screen.findByRole('dialog', { name: /^Log for/ });
  await waitFor(() => expect(within(sheet).queryByText('Loading…')).toBeNull());
  return sheet;
}

// One online session: fetch the map, the calendar month and the day sheet (medications) so all of it is cached.
async function seedCache() {
  seedServer();
  const view = renderApp();
  await waitForMap();
  const sheet = await openToday();
  await within(sheet).findByText('Iron');
  fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  await ticks();
  view.unmount();
  await ticks();
  await store.__flush();
}

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  localStorage.clear();
  sessionStorage.clear();
  mockData.clear();
  localStorage.setItem(`luna_onboarding_done_${E}`, '1');
  window.HTMLElement.prototype.scrollTo = jest.fn();
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  await store.__resetForTests();
  outbox.__resetForTests();
  resetSyncState();
  server = makeServer();
  installApi();
  realCreate = realCreate || offlineIndex.createOffline;
  createSpy = jest.spyOn(offlineIndex, 'createOffline').mockImplementation(opts => realCreate(opts));
  rebuildReminders.mockClear();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await ticks(5);
});

describe('offline cold start after one online session', () => {
  test('no intro, no consent/error screen; map, fog, Today card, calendar, day sheet and medications come from the cache', async () => {
    await seedCache();
    server.setOffline(true);
    server.calls = [];
    renderApp();
    await waitForMap();

    expect(screen.queryByText('Meet your Luna journey')).toBeNull();
    expect(screen.queryByText('Loading your privacy settings…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(document.querySelectorAll('.fog-run').length).toBeGreaterThan(0);
    expect(within(todayCard()).getAllByText(/Today's sky: Okay/).length).toBeGreaterThan(0);

    const sheet = await openToday();
    const cal = screen.getByRole('dialog', { name: 'Calendar' });
    expect(within(cal).queryByText("Couldn't load your logs. Tap Retry.")).toBeNull();
    expect(within(cal).getAllByTestId('logged-dot').length).toBeGreaterThan(0);
    expect(within(sheet).queryByText("Couldn't load this day.")).toBeNull();
    expect(within(sheet).getByLabelText('Note')).toHaveValue('server note');
    expect(await within(sheet).findByText('Iron')).toBeInTheDocument();
    expect(within(sheet).queryByText("Couldn't load your medications.")).toBeNull();
    // every request really went to the (offline) network first
    expect(server.calls.length).toBeGreaterThan(0);
  });

  test('a failed auth-status read while offline never opens the intro', async () => {
    await seedCache();
    await store.remove(E, 'snap_authStatus'); // nothing cached for it: getAuthStatus rejects with status 0
    server.setOffline(true);
    renderApp();
    await waitForMap();
    await ticks();
    expect(screen.queryByText('Meet your Luna journey')).toBeNull();
  });

  test('online, a non-network auth-status failure for a new user still opens the intro (behaviour as before)', async () => {
    localStorage.removeItem(`luna_onboarding_done_${E}`);
    seedServer();
    server.failNext('auth.status', apiErr(500, 'boom'));
    renderApp();
    await waitForMap();
    expect(await screen.findByText('Meet your Luna journey')).toBeInTheDocument();
  });

  test('a 5xx auth-status failure for a returning user (intro already seen) does not reopen it', async () => {
    seedServer();
    server.failNext('auth.status', apiErr(503, 'down'));
    renderApp();
    await waitForMap();
    await ticks();
    expect(server.names()).toContain('auth.status');
    expect(screen.queryByText('Meet your Luna journey')).toBeNull();
  });
});

describe('first ever launch offline (empty cache)', () => {
  test('shows the existing error screen with Retry; no consent is made up', async () => {
    seedServer();
    server.setOffline(true);
    renderApp();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(periodDots()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Calendar' })).toBeNull();
    expect((await snapshot.loadSnapshot(E)).consents).toBeNull();
  });
});

describe('offline writes', () => {
  test('LogModal save offline: the period shows on the map at once; after sync exactly one exists on the server', async () => {
    await seedCache();
    server.setOffline(true);
    renderApp();
    await waitForMap();
    fireEvent.click(screen.getByRole('button', { name: /Log period/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save to Journey' }));
    await waitForMap(2);
    expect(screen.queryByRole('button', { name: 'Save to Journey' })).toBeNull();
    let list;
    await act(async () => { list = await facade().data.listPeriods('tok'); });
    expect(list.filter(p => p.pending)).toHaveLength(1);
    expect(list.find(p => p.pending).start_date).toBe(TODAY);

    // The pending marker (client id the server may not know yet) offers no delete; the synced one still does.
    const byX = () => periodDots().sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left));
    fireEvent.click(byX()[1]); // today's (pending) period
    expect(await screen.findByText('Pain: 3/10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this entry' })).toBeNull();
    fireEvent.click(byX()[0]); // the synced one, 10 days ago
    expect(await screen.findByText('Pain: 2/10')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Delete this entry' })).toBeInTheDocument();

    server.setOffline(false);
    await act(async () => { await facade().sync.syncNow({ force: true }); });
    expect(server.periods.filter(p => p.start_date === TODAY)).toHaveLength(1);
    await act(async () => { list = await facade().data.listPeriods('tok'); });
    expect(list.filter(p => p.pending)).toHaveLength(0);
    expect(list).toHaveLength(2);
  });

  test('day sheet save and check-in offline are visible at once; after sync the server has the merged day', async () => {
    await seedCache();
    server.setOffline(true);
    renderApp();
    await waitForMap();

    let sheet = await openToday();
    fireEvent.change(within(sheet).getByLabelText('Note'), { target: { value: 'offline note' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Log for/ })).toBeNull());
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Calendar' })).getByRole('button', { name: 'Close' }));

    const sky = within(todayCard()).getByRole('radiogroup', { name: /sky/i });
    fireEvent.click(within(sky).getByRole('radio', { name: 'Good' }));
    await waitFor(() => expect(within(sky).getByRole('radio', { name: 'Good' })).toHaveAttribute('aria-checked', 'true'));
    await ticks();
    expect(within(todayCard()).getAllByText(/Today's sky: Good/).length).toBeGreaterThan(0);
    expect(within(todayCard()).queryByRole('alert')?.textContent || '').toBe('');

    sheet = await openToday();
    expect(within(sheet).getByLabelText('Note')).toHaveValue('offline note');
    expect(within(sheet).getByRole('radio', { name: 'Good' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));

    server.setOffline(false);
    await act(async () => { await facade().sync.syncNow({ force: true }); });
    expect(server.logs[TODAY]).toMatchObject({ note: 'offline note', mood: 4 });
  });

  test('an offline check-in does not clobber a note changed on the server meanwhile', async () => {
    await seedCache();
    server.setOffline(true);
    renderApp();
    await waitForMap();
    const sky = within(todayCard()).getByRole('radiogroup', { name: /sky/i });
    fireEvent.click(within(sky).getByRole('radio', { name: 'Great' }));
    await waitFor(() => expect(within(sky).getByRole('radio', { name: 'Great' })).toHaveAttribute('aria-checked', 'true'));
    await ticks();
    server.logs[TODAY] = { ...server.logs[TODAY], note: 'edited on the web' };

    server.setOffline(false);
    await act(async () => { await facade().sync.syncNow({ force: true }); });
    expect(server.logs[TODAY]).toMatchObject({ note: 'edited on the web', mood: 5 });
  });

  test('an offline check-in on the shown mood clears it, and the clear is what syncs', async () => {
    await seedCache();
    server.setOffline(true);
    renderApp();
    await waitForMap();
    const sky = within(todayCard()).getByRole('radiogroup', { name: /sky/i });
    expect(within(sky).getByRole('radio', { name: 'Okay' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(sky).getByRole('radio', { name: 'Okay' }));
    await waitFor(() => expect(within(sky).getByRole('radio', { name: 'Okay' })).toHaveAttribute('aria-checked', 'false'));
    await ticks();
    server.setOffline(false);
    await act(async () => { await facade().sync.syncNow({ force: true }); });
    expect(server.logs[TODAY]).toMatchObject({ note: 'server note', mood: null });
  });
});

describe('consents', () => {
  test('a successful consent change refreshes the cached copy (served offline afterwards)', async () => {
    seedServer();
    server.consents = { ...ALL, terms_privacy: false };
    const view = renderApp();
    const boxes = await screen.findAllByRole('checkbox');
    boxes.forEach(b => { if (!b.checked) fireEvent.click(b); });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitForMap();
    view.unmount();
    await ticks();
    await store.__flush();
    expect((await snapshot.loadSnapshot(E)).consents).toMatchObject({ terms_privacy: true, age_18_plus: true });
    const consentCalls = server.names().filter(n => n === 'consents.get');
    expect(consentCalls).toHaveLength(1); // no extra read after the set

    server.setOffline(true);
    renderApp();
    await waitForMap();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});

describe('consents: failed set', () => {
  test('a failed consents.set drops the cached copy (nothing stale is served offline)', async () => {
    seedServer();
    server.consents = { ...ALL, terms_privacy: false };
    mockApi.consents.set.mockImplementation(async () => { throw apiErr(500, 'boom'); });
    renderApp();
    const boxes = await screen.findAllByRole('checkbox');
    await waitFor(async () => expect((await snapshot.loadSnapshot(E)).consents).toMatchObject({ terms_privacy: false }));
    boxes.forEach(b => { if (!b.checked) fireEvent.click(b); });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(mockApi.consents.set).toHaveBeenCalled());
    await ticks();
    await store.__flush();
    expect((await snapshot.loadSnapshot(E)).consents).toBeNull();
  });
});

describe('online behaviour unchanged', () => {
  // Request counts recorded against the screens before they used the facade (HEAD 3e94239).
  test('requests per screen equal the previous counts', async () => {
    seedServer();
    renderApp();
    await waitForMap();
    await ticks();
    const count = () => {
      const out = {};
      server.names().forEach(n => { out[n] = (out[n] || 0) + 1; });
      server.calls = [];
      return out;
    };
    expect(count()).toEqual({ 'consents.get': 1, 'auth.status': 1, 'periods.list': 1, 'logs.list': 1 });

    await openCalendar();
    await ticks();
    expect(count()).toEqual({ 'logs.list': 1 });
    expect(mockApi.periods.prediction).toHaveBeenCalledTimes(1);

    const sheet = await openToday();
    await within(sheet).findByText('Iron');
    await ticks();
    expect(count()).toEqual({ 'logs.list': 1, 'medications.list': 1 });
    fireEvent.change(within(sheet).getByLabelText('Note'), { target: { value: 'online note' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Log for/ })).toBeNull());
    await ticks();
    // the save, then the refetches its logsVersion bump triggers (map window + calendar month)
    expect(count()).toEqual({ 'logs.put': 1, 'logs.list': 2 });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Calendar' })).getByRole('button', { name: 'Close' }));

    const sky = within(todayCard()).getByRole('radiogroup', { name: /sky/i });
    fireEvent.click(within(sky).getByRole('radio', { name: 'Great' }));
    await waitFor(() => expect(server.logs[TODAY].mood).toBe(5));
    await ticks();
    // fresh read + PUT, then the map refetch
    expect(count()).toEqual({ 'logs.list': 2, 'logs.put': 1 });
    expect(server.logs[TODAY].note).toBe('online note');

    fireEvent.click(screen.getByRole('button', { name: /Log period/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save to Journey' }));
    await waitForMap(2);
    await ticks();
    // recent-pattern read, create, then the map reload (periods + logs)
    expect(count()).toEqual({ 'periods.list': 2, 'periods.create': 1, 'logs.list': 1 });
  });
});

describe('check-in mood validation', () => {
  test('only an integer 1..5 makes a patch; a repeat of the shown mood clears it', () => {
    [0, 6, -1, 2.5, '3', NaN, null, undefined, Infinity].forEach(v => expect(checkInPatch(3, v)).toBeNull());
    expect(checkInPatch(null, 4)).toEqual({ set: { mood: 4 }, clear: [] });
    expect(checkInPatch(2, 4)).toEqual({ set: { mood: 4 }, clear: [] });
    expect(checkInPatch(4, 4)).toEqual({ set: {}, clear: ['mood'] });
  });

  test('patchLog only ever receives a valid mood', async () => {
    seedServer();
    renderApp();
    await waitForMap();
    const spy = jest.spyOn(facade().data, 'patchLog');
    const sky = within(todayCard()).getByRole('radiogroup', { name: /sky/i });
    fireEvent.click(within(sky).getByRole('radio', { name: 'Low' }));
    await waitFor(() => expect(server.logs[TODAY].mood).toBe(2));
    expect(spy).toHaveBeenCalledTimes(1);
    const valid = ({ set, clear }) => (set.mood === undefined
      ? clear.length === 1 && clear[0] === 'mood'
      : Number.isInteger(set.mood) && set.mood >= 1 && set.mood <= 5 && clear.length === 0);
    expect(spy.mock.calls.every(([, patch]) => valid(patch))).toBe(true);
    expect(spy.mock.calls[0][1]).toEqual({ set: { mood: 2 }, clear: [] });
  });
});

describe('reminders', () => {
  const ON = { version: 1, periodExpected: { enabled: true, daysBefore: 2, time: '09:00' }, dailyLog: { enabled: true, time: '21:00' }, lateCheckIn: { enabled: false }, explicit: true };

  test('offline they still plan from cached logs; a failed prediction keeps the last one', async () => {
    jest.spyOn(tokenStore, 'getAccessToken').mockReturnValue('tok');
    localStorage.setItem('luna_reminders', JSON.stringify(ON));
    server.prediction = { predicted_next_period: addDays(TODAY, 18) };
    seedServer();
    renderApp();
    await waitForMap();
    await waitFor(() => expect(rebuildReminders).toHaveBeenCalled(), { timeout: 3000 });
    expect(rebuildReminders.mock.calls[rebuildReminders.mock.calls.length - 1][0])
      .toMatchObject({ prediction: server.prediction, lastLoggedOn: TODAY });

    // offline in the same session: a check-in bumps the logs version and re-plans
    server.logs = {}; // the server would now say "nothing logged"; offline the cache (and the check-in) count
    server.setOffline(true);
    rebuildReminders.mockClear();
    const sky = within(todayCard()).getByRole('radiogroup', { name: /sky/i });
    fireEvent.click(within(sky).getByRole('radio', { name: 'Good' }));
    await waitFor(() => expect(rebuildReminders).toHaveBeenCalled(), { timeout: 3000 });
    expect(rebuildReminders.mock.calls[rebuildReminders.mock.calls.length - 1][0])
      .toMatchObject({ prediction: { predicted_next_period: addDays(TODAY, 18) }, lastLoggedOn: TODAY });
  });
});

describe('pass-through (web) facade', () => {
  test('patchLog: clearing the last field sends an empty PUT (as SkyCheckIn did) and a non-array list throws', async () => {
    const { createPassthrough } = require('./data');
    const s = makeServer();
    s.logs = { [TODAY]: { ...EMPTY_ENTRY, date: TODAY, mood: 3 } };
    const web = createPassthrough(s.api);
    expect(await web.patchLog(TODAY, { set: {}, clear: ['mood'] }, 'tok')).toEqual({ date: TODAY, deleted: true });
    expect(s.names()).toEqual(['logs.list', 'logs.put']);
    expect(s.calls[1].args).toEqual([TODAY, {}]);
    s.api.logs.list = async () => ({ rows: [] });
    await expect(web.patchLog(TODAY, { set: { mood: 2 } }, 'tok')).rejects.toThrow('unexpected logs response');
    expect(s.names()).toEqual(['logs.list', 'logs.put']);
  });

  test('refreshConsents is a no-op without storage', async () => {
    const { createPassthrough } = require('./data');
    const web = createPassthrough(makeServer().api);
    await expect(web.refreshConsents({ terms_privacy: true })).resolves.toBeUndefined();
  });
});
