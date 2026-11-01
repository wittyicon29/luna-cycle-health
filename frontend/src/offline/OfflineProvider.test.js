import React, { StrictMode } from 'react';
import { render, act, screen, waitFor, fireEvent } from '@testing-library/react';

const mockData = new Map();
const mockSecure = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };
const mockApi = {};
const mockAppHandles = [];

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: mockSecure }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), API: mockApi }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));
jest.mock('../LandingPage', () => () => <div>LANDING</div>);
jest.mock('../reminderScheduler', () => ({
  teardownReminders: jest.fn(),
  cancelAllReminders: jest.fn(),
  rebuildReminders: jest.fn(),
  getReminderPermission: jest.fn(),
  requestReminderPermission: jest.fn(),
}));

const { makeServer, apiErr } = require('./testing/fakeServer');
const store = require('./store');
const outbox = require('./outbox');
const snapshot = require('./snapshot');
const { resetSyncState } = require('./sync');
const offlineIndex = require('./index');
const { default: OfflineProvider } = require('./OfflineProvider');
const { useOffline, useOfflineData, passThroughData } = require('./useOffline');
const tokenStore = require('../tokenStore');
const { setLanguage } = require('../i18n');
const App = require('../App').default;
const PrivacyPanel = require('../PrivacyPanel').default;

const E = 'a@x.com';
const B = 'b@x.com';
const D1 = '2026-03-01';
const D2 = '2026-03-02';
const offlineKeys = () => Object.keys(localStorage).filter(k => k.startsWith('luna_offline_'));
const keysFor = async email => {
  const hash = await store.emailHash(email);
  return offlineKeys().filter(k => k.startsWith(`luna_offline_${hash}_`));
};
const realSetTimeout = setTimeout;
const ticks = async (n = 20) => { for (let i = 0; i < n; i += 1) await act(() => new Promise(r => realSetTimeout(r, 0))); }; // eslint-disable-line no-await-in-loop
const liveHandles = () => mockAppHandles.filter(h => h.event === 'appStateChange' && !h.removed);
const putsSince = from => server.calls.slice(from).filter(c => c.name === 'logs.put');

let server;
let onlineAdds;
let realCreate;
let createSpy;
let tweakFacade; // lets a test make the facade's pendingSummary()/wipe() fail

// Captures the hook values so tests can call the facade from outside React.
const seen = {};
function Probe({ id = 'p' }) {
  const off = useOffline();
  seen[id] = off;
  seen.data = useOfflineData();
  return (
    <div>
      <span data-testid="pending">{off.status.pendingCount}</span>
      <span data-testid="online">{String(off.status.online)}</span>
      <span data-testid="dropped">{off.status.dropped.length}</span>
      <span data-testid="lost">{String(off.status.queueLost)}</span>
    </div>
  );
}
const withProvider = (email = E, extra = null) => (
  <StrictMode>
    <OfflineProvider email={email} token="tok"><Probe />{extra}</OfflineProvider>
  </StrictMode>
);
const facadesFor = email => createSpy.mock.calls.filter(([o]) => o && o.email === email);

function installApi() {
  Object.keys(mockApi).forEach(k => { delete mockApi[k]; });
  Object.assign(mockApi, server.api, {
    periods: { ...server.api.periods, prediction: jest.fn(async () => null) },
    consents: { ...server.api.consents, set: jest.fn(async () => ({})) },
    analysis: { list: jest.fn(async () => []), latest: jest.fn(async () => null) },
    chat: { history: jest.fn(async () => []) },
    account: { delete: jest.fn(async () => ({})), export: jest.fn(async () => ({})) },
    auth: { ...server.api.auth, login: jest.fn(async () => ({ access_token: 'tok2', refresh_token: 'ref2' })) },
  });
}

beforeEach(async () => {
  require('../platform').isNative.mockReturnValue(true);
  mockSecure.get.mockImplementation(async k => (mockData.has(k) ? mockData.get(k) : null));
  mockSecure.set.mockImplementation(async (k, v) => { mockData.set(k, v); });
  mockSecure.remove.mockImplementation(async k => { mockData.delete(k); });
  mockAppHandles.length = 0;
  require('@capacitor/app').App.addListener.mockImplementation(async (event, fn) => {
    const h = { event, fn, removed: false };
    h.remove = async () => { h.removed = true; };
    mockAppHandles.push(h);
    return h;
  });
  localStorage.clear();
  sessionStorage.clear();
  mockData.clear();
  window.history.pushState({}, '', '/');
  await store.__resetForTests();
  outbox.__resetForTests();
  resetSyncState();
  server = makeServer();
  installApi();
  realCreate = realCreate || offlineIndex.createOffline;
  tweakFacade = null;
  createSpy = jest.spyOn(offlineIndex, 'createOffline').mockImplementation(opts => {
    const f = realCreate(opts);
    jest.spyOn(f, 'startSync');
    jest.spyOn(f, 'stopSync');
    jest.spyOn(f, 'wipe');
    jest.spyOn(f, 'pendingSummary');
    if (tweakFacade) tweakFacade(f);
    return f;
  });
  onlineAdds = 0;
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  jest.spyOn(window, 'addEventListener').mockImplementation((type, ...rest) => { if (type === 'online') onlineAdds += 1; return add(type, ...rest); });
  jest.spyOn(window, 'removeEventListener').mockImplementation((type, ...rest) => { if (type === 'online') onlineAdds -= 1; return remove(type, ...rest); });
});

afterEach(async () => {
  jest.restoreAllMocks();
  setLanguage('en');
  await tokenStore.clearSession();
});

describe('OfflineProvider lifecycle', () => {
  test('one facade per email across StrictMode and re-renders; unmount stops sync and removes every listener', async () => {
    const baseline = onlineAdds;
    const { rerender, unmount } = render(withProvider());
    await waitFor(() => expect(liveHandles()).toHaveLength(1));
    rerender(withProvider(E, <span>again</span>));
    rerender(withProvider(E, <span>and again</span>));
    await ticks();
    expect(facadesFor(E)).toHaveLength(1);
    const facade = createSpy.mock.results[createSpy.mock.calls.findIndex(([o]) => o && o.email === E)].value;
    expect(facade.startSync).toHaveBeenCalled();
    expect(onlineAdds).toBeGreaterThan(baseline);
    expect(seen.data).toBe(facade.data);

    unmount();
    await ticks();
    expect(facade.stopSync).toHaveBeenCalled();
    expect(onlineAdds).toBe(baseline);
    expect(liveHandles()).toHaveLength(0);
    expect(mockAppHandles.every(h => h.removed)).toBe(true);
  });

  test('a different email gets its own facade', async () => {
    const { rerender, unmount } = render(withProvider(E));
    await ticks();
    rerender(withProvider(B));
    await ticks();
    expect(facadesFor(E)).toHaveLength(1);
    expect(facadesFor(B)).toHaveLength(1);
    unmount();
    await ticks();
    expect(liveHandles()).toHaveLength(0);
  });

  test('unmounting before addListener resolves still removes the handle', async () => {
    let resolveAdd;
    const late = { event: 'appStateChange', removed: false };
    late.remove = async () => { late.removed = true; };
    require('@capacitor/app').App.addListener.mockImplementation((event, fn) => {
      late.fn = fn;
      mockAppHandles.push(late);
      return new Promise(r => { resolveAdd = () => r(late); });
    });
    const { unmount } = render(withProvider());
    await waitFor(() => expect(resolveAdd).toBeDefined());
    unmount();
    await ticks();
    expect(late.removed).toBe(false);
    await act(async () => { resolveAdd(); });
    await ticks();
    expect(late.removed).toBe(true);
  });

  test('appStateChange isActive:true forces a sync of a queued change; isActive:false does nothing', async () => {
    server.setOffline(true);
    render(withProvider());
    await waitFor(() => expect(liveHandles()).toHaveLength(1));
    await act(async () => { await seen.p.data.saveLog(D1, { mood: 3 }, 'tok'); });
    await ticks();
    expect(await outbox.loadOutbox(E)).toHaveLength(1);
    server.setOffline(false);
    const before = server.calls.length;

    await act(async () => { liveHandles()[0].fn({ isActive: false }); });
    await ticks();
    expect(server.calls.length).toBe(before);
    expect(server.logs[D1]).toBeUndefined();

    await act(async () => { liveHandles()[0].fn({ isActive: true }); });
    await waitFor(() => expect(putsSince(before)).toHaveLength(1));
    expect(server.logs[D1]).toMatchObject({ mood: 3 });
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('0'));
  });

  test('clearOthers(email) runs at mount: another user\'s cache is removed, this user\'s is kept', async () => {
    await store.write(B, 'logs', { [D1]: { date: D1, mood: 1 } });
    await store.write(E, 'logs', { [D2]: { date: D2, mood: 2 } });
    expect(await keysFor(B)).toHaveLength(1);
    render(withProvider());
    await ticks();
    await store.__flush();
    expect(await keysFor(B)).toHaveLength(0);
    expect(await keysFor(E)).toHaveLength(1);
  });

  test('wipe() leaves no luna_offline_* keys and no vault key; the next user sees nothing of the first', async () => {
    server.periods = [{ id: 'p1', start_date: '2026-02-01', end_date: null }];
    server.logs = { [D2]: { date: D2, mood: 4 } };
    const view = render(withProvider());
    await ticks();
    await act(async () => {
      await seen.p.data.listPeriods('tok');
      await seen.p.data.listLogs(D1, D2, 'tok');
    });
    server.setOffline(true);
    await act(async () => { await seen.p.data.saveLog(D1, { mood: 3 }, 'tok'); });
    await ticks();
    expect(offlineKeys().length).toBeGreaterThan(0);
    expect(mockData.has('luna_vault_key')).toBe(true);

    await act(async () => { await seen.p.wipe(); });
    expect(offlineKeys()).toHaveLength(0);
    expect(mockData.size).toBe(0);
    view.unmount();
    await ticks();

    render(withProvider(B));
    await ticks();
    expect(screen.getByTestId('pending')).toHaveTextContent('0');
    expect(await seen.p.pendingSummary()).toEqual({ count: 0 });
    await expect(seen.p.data.listPeriods('tok')).rejects.toMatchObject({ status: 0 });
    await expect(seen.p.data.listLogs(D1, D2, 'tok')).rejects.toMatchObject({ status: 0 });
    expect(await snapshot.loadSnapshot(E)).toMatchObject({ periods: null });
  });
});

describe('without a provider', () => {
  test('useOfflineData() is the pass-through facade: API calls only, no storage', async () => {
    server.periods = [{ id: 'p1', start_date: '2026-02-01', end_date: null }];
    render(<Probe />);
    expect(seen.data).toBe(passThroughData);
    expect(seen.p.data).toBe(passThroughData);
    expect(seen.p.status).toMatchObject({ online: true, pendingCount: 0, queueLost: false, dropped: [] });
    let list;
    await act(async () => { list = await seen.data.listPeriods('tok'); });
    expect(list).toEqual(server.periods);
    server.setOffline(true);
    await expect(seen.data.saveLog(D1, { mood: 2 }, 'tok')).rejects.toMatchObject({ status: 0 });
    expect(await seen.p.pendingSummary()).toEqual({ count: 0 });
    await seen.p.wipe();
    await ticks();
    expect(server.names()).toEqual(['periods.list', 'logs.put']);
    expect(offlineKeys()).toHaveLength(0);
    expect(mockSecure.get).not.toHaveBeenCalled();
    expect(mockSecure.set).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('account deletion', () => {
  test('inside a provider it waits for wipe(), then clears local data and signs out', async () => {
    server.setOffline(true);
    const onAccountDeleted = jest.fn(() => {
      // Signing out happens only after the wipe finished.
      expect(offlineKeys()).toHaveLength(0);
      expect(mockData.has('luna_vault_key')).toBe(false);
    });
    render(withProvider(E, <PrivacyPanel token="tok" consents={{}} onSetConsent={jest.fn()} onAccountDeleted={onAccountDeleted} />));
    await ticks();
    await act(async () => { await seen.p.data.saveLog(D1, { mood: 3 }, 'tok'); });
    await ticks();
    expect(offlineKeys().length).toBeGreaterThan(0);
    server.setOffline(false);

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: /delete forever/i }));
    await waitFor(() => expect(onAccountDeleted).toHaveBeenCalledTimes(1));
    expect(mockApi.account.delete).toHaveBeenCalledWith('tok');
    expect(await seen.p.pendingSummary()).toEqual({ count: 0 });
    expect(Object.keys(localStorage).filter(k => k.startsWith('luna_'))).toHaveLength(0);
  });
});

describe('status', () => {
  test('status changes re-render consumers; dropped appears once and acknowledge() clears it', async () => {
    server.setOffline(true);
    render(withProvider());
    await ticks();
    expect(screen.getByTestId('pending')).toHaveTextContent('0');
    await act(async () => { await seen.p.data.saveLog(D1, { mood: 3 }, 'tok'); });
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('1'));
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('false'));

    server.setOffline(false);
    server.failNext('logs.put', apiErr(422));
    await act(async () => { await seen.p.syncNow({ force: true }); });
    await waitFor(() => expect(screen.getByTestId('dropped')).toHaveTextContent('1'));
    expect(screen.getByTestId('pending')).toHaveTextContent('0');
    expect(screen.getByTestId('online')).toHaveTextContent('true');

    act(() => { seen.p.acknowledge(); });
    expect(screen.getByTestId('dropped')).toHaveTextContent('0');
    await act(async () => { await seen.p.syncNow({ force: true }); });
    await ticks();
    expect(screen.getByTestId('dropped')).toHaveTextContent('0');
  });

  test('a lost queue appears once and acknowledge() clears it', async () => {
    await outbox.enqueue(E, { kind: 'log.patch', date: D1, set: { mood: 1 }, clear: [] });
    localStorage.setItem(offlineKeys().find(k => k.endsWith('_outbox')), 'garbage');
    outbox.__resetForTests();
    render(withProvider());
    await waitFor(() => expect(screen.getByTestId('lost')).toHaveTextContent('true'));
    act(() => { seen.p.acknowledge(); });
    expect(screen.getByTestId('lost')).toHaveTextContent('false');
    await act(async () => { await seen.p.syncNow({ force: true }); });
    await ticks();
    expect(screen.getByTestId('lost')).toHaveTextContent('false');
  });
});

describe('sign-out from the app root', () => {
  async function queue(n) {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-03'];
    for (let i = 0; i < n; i += 1) {
      await outbox.enqueue(E, { kind: 'log.replace', date: dates[i], payload: { mood: 2 } }); // eslint-disable-line no-await-in-loop
    }
    await store.write(E, 'logs', { [D2]: { date: D2, mood: 5 } });
  }
  async function signedIn() {
    tokenStore.setSession({ accessToken: 'tok', refreshToken: 'ref', email: E });
    server.setOffline(true); // keeps the queue queued; the consent error screen offers "Sign out"
    render(<StrictMode><App /></StrictMode>);
    await ticks();
    return screen.findByRole('button', { name: 'Sign out' });
  }

  test('pending changes ask first (plural); "Stay signed in" keeps the token, cache and queue', async () => {
    await queue(2);
    const signOut = await signedIn();
    fireEvent.click(signOut);
    expect(await screen.findByText('Sign out?')).toBeInTheDocument();
    expect(screen.getByText("2 changes haven't synced yet and will be lost if you sign out.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await ticks();
    expect(screen.queryByText('Sign out?')).not.toBeInTheDocument();
    expect(tokenStore.getAccessToken()).toBe('tok');
    expect(await outbox.loadOutbox(E)).toHaveLength(2);
    expect(await keysFor(E)).toHaveLength(2);
    expect(mockData.has('luna_vault_key')).toBe(true);
    expect(screen.queryByText('LANDING')).not.toBeInTheDocument();
  });

  test('one pending change uses the singular; "Sign out anyway" wipes, then signs out', async () => {
    await queue(1);
    const signOut = await signedIn();
    fireEvent.click(signOut);
    expect(await screen.findByText("1 change hasn't synced yet and will be lost if you sign out.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    await ticks();
    expect(offlineKeys()).toHaveLength(0);
    expect(mockData.has('luna_vault_key')).toBe(false);
    expect(tokenStore.getAccessToken()).toBeNull();
    expect(await outbox.loadOutbox(E)).toHaveLength(0);
  });

  test('no pending changes: signs out without asking and wipes the cache', async () => {
    await store.write(E, 'logs', { [D2]: { date: D2, mood: 5 } });
    const signOut = await signedIn();
    fireEvent.click(signOut);
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    expect(screen.queryByText('Sign out?')).not.toBeInTheDocument();
    await ticks();
    expect(offlineKeys()).toHaveLength(0);
    expect(mockData.has('luna_vault_key')).toBe(false);
  });

  test('the confirm text is translated in Hindi with the right plural form', async () => {
    setLanguage('hi');
    await queue(2);
    tokenStore.setSession({ accessToken: 'tok', refreshToken: 'ref', email: E });
    server.setOffline(true);
    render(<App />);
    await ticks();
    const hi = require('../i18n/catalogs/hi.json');
    fireEvent.click(await screen.findByRole('button', { name: hi['Sign out'] }));
    expect(await screen.findByText(hi['Sign out?'])).toBeInTheDocument();
    const body = hi["{count} change hasn't synced yet and will be lost if you sign out."];
    expect(screen.getByText(body.other.replace('{count}', '2'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: hi['Sign out anyway'] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: hi['Stay signed in'] })).toBeInTheDocument();
  });

  test('pendingSummary() failing still asks first with a generic message; "Stay signed in" keeps everything', async () => {
    await queue(1);
    tweakFacade = f => { f.pendingSummary.mockRejectedValue(new Error('storage broke')); };
    fireEvent.click(await signedIn());
    expect(await screen.findByText('Sign out?')).toBeInTheDocument();
    expect(screen.getByText('Some changes may not have synced. Sign out anyway?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await ticks();
    expect(screen.queryByText('Sign out?')).not.toBeInTheDocument();
    expect(tokenStore.getAccessToken()).toBe('tok');
    expect(await outbox.loadOutbox(E)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out anyway' }));
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    await ticks();
    expect(offlineKeys()).toHaveLength(0);
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  test('wipe() failing still signs out and clears the offline data as a fallback', async () => {
    await queue(1);
    const fallback = jest.spyOn(store, 'clearOfflineData');
    tweakFacade = f => { f.wipe.mockRejectedValue(new Error('wipe broke')); };
    fireEvent.click(await signedIn());
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out anyway' }));
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    await ticks();
    expect(fallback).toHaveBeenCalled();
    expect(offlineKeys()).toHaveLength(0);
    expect(mockData.has('luna_vault_key')).toBe(false);
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  test('a double tap on "Sign out anyway" wipes once', async () => {
    await queue(1);
    fireEvent.click(await signedIn());
    const confirm = await screen.findByRole('button', { name: 'Sign out anyway' });
    act(() => { confirm.click(); confirm.click(); }); // both taps land before React re-renders
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    await ticks();
    const wipes = createSpy.mock.results.filter(r => r.value && r.value.wipe).reduce((n, r) => n + r.value.wipe.mock.calls.length, 0);
    expect(wipes).toBe(1);
  });

  test('a confirm left open when the session expires does not come back after signing in again', async () => {
    await queue(1);
    fireEvent.click(await signedIn());
    expect(await screen.findByText('Sign out?')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('luna:session-expired')); });
    await ticks();
    expect(screen.queryByText('Sign out?')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('your@gmail.com'), { target: { value: E } });
    fireEvent.change(screen.getByPlaceholderText('•••••••'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByPlaceholderText('•••••••').closest('form')); // eslint-disable-line testing-library/no-node-access
    await waitFor(() => expect(mockApi.auth.login).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await ticks();
    expect(screen.queryByText('Sign out?')).not.toBeInTheDocument();
    // Signing out again still works and asks again (the queue survived the expiry).
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign out?')).toBeInTheDocument();
  });

  test('session expiry keeps the cache and queue; the same email re-mounting replays the queue', async () => {
    await queue(1);
    const app = await signedIn();
    expect(app).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('luna:session-expired')); });
    await ticks();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(await outbox.loadOutbox(E)).toHaveLength(1);
    expect(await keysFor(E)).toHaveLength(2);
    expect(mockData.has('luna_vault_key')).toBe(true);
    expect(server.logs[D1]).toBeUndefined();

    server.setOffline(false);
    const before = server.calls.length;
    render(withProvider(E));
    await waitFor(() => expect(putsSince(before)).toHaveLength(1));
    await waitFor(async () => expect(await outbox.loadOutbox(E)).toHaveLength(0));
    expect(server.logs[D1]).toMatchObject({ mood: 2 });
  });
});
