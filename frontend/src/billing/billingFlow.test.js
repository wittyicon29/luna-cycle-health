import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockClient;

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  API: {
    consents: { get: jest.fn(), set: jest.fn() },
    auth: { status: jest.fn() },
    periods: { list: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn() },
    billing: { status: jest.fn(), verify: jest.fn(), refresh: jest.fn() },
  },
}));
jest.mock('../platform', () => ({ isNative: jest.fn(() => false) }));
jest.mock('./billingClient', () => ({ ...jest.requireActual('./billingClient'), getBillingClient: () => mockClient }));

const { API, ApiError } = require('../api');
const { isNative } = require('../platform');
const { JourneyApp } = require('../App');
const { fakeClient } = require('./fakeClient');
const { webClient } = require('./billingClient');
const BillingProvider = require('./BillingProvider').default;
const Paywall = require('./Paywall').default;
const PlanRow = require('./PlanRow').default;
const useBilling = require('./useBilling').default;
const { OfflineContext } = require('../offline/useOffline');
const { setLanguage, t } = require('../i18n');
const { findUntranslated } = require('../i18n/testUtils');

const ALL = { terms_privacy: true, age_18_plus: true, ai_processing: true };
const IDS = ['luna_ai_monthly', 'luna_ai_yearly'];
const OFF = { enabled: false, active: false, plan: 'free', account_token: 'acct-123', product_ids: [] };
const FREE = {
  enabled: true, active: false, plan: 'free', state: null, product_id: null, expires_at: null, auto_renewing: null,
  account_token: 'acct-123', product_ids: IDS,
};
const ACTIVE = {
  ...FREE, active: true, plan: 'ai', state: 'SUBSCRIPTION_STATE_ACTIVE', product_id: 'luna_ai_monthly',
  expires_at: '2026-12-01T10:00:00Z', auto_renewing: true,
};
const ON_HOLD = { ...FREE, state: 'SUBSCRIPTION_STATE_ON_HOLD', product_id: 'luna_ai_monthly' };

const plans = () => [
  { id: 'luna_ai_monthly', planId: 'monthly', title: 'Luna AI', priceString: '₹199.00', price: 199, currencyCode: 'INR', period: { unit: 'month', count: 1 }, periodLabel: t('month'), trial: { text: t('Free trial available') } },
  { id: 'luna_ai_yearly', planId: 'yearly', title: 'Luna AI', priceString: '₹1,499.00', price: 1499, currencyCode: 'INR', period: { unit: 'year', count: 1 }, periodLabel: t('year'), trial: null },
];

const DIFFERENT = 'This purchase belongs to a different account';
const LINKED = 'This purchase is already linked to another account';
const apiError = (status, raw) => new ApiError(raw ? t(raw) : `Error ${status}`, { status, detail: raw, rawMessage: raw });
const networkError = () => new ApiError('Connection problem. Please try again.', { status: 0, rawMessage: 'Connection problem. Please try again.' });

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.scrollTo = jest.fn();
  window.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  localStorage.setItem('luna_onboarding_done_b@gmail.com', '1');
  isNative.mockReturnValue(false);
  API.consents.get.mockResolvedValue(ALL);
  API.consents.set.mockImplementation(async (purpose, granted) => ({ ...ALL, [purpose]: granted }));
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  API.billing.status.mockResolvedValue(OFF);
  API.billing.refresh.mockResolvedValue(OFF);
  API.billing.verify.mockResolvedValue(ACTIVE);
  mockClient = fakeClient({ products: plans() });
});

afterEach(() => { act(() => { setLanguage('en'); }); });

const renderJourney = (email = 'u@gmail.com') => render(<JourneyApp token="tok" email={email} onLogout={jest.fn()} />);
const insights = () => screen.findByRole('button', { name: 'Insights' });
const chat = () => screen.findByRole('button', { name: 'Chat' });
const findPaywall = () => screen.findByRole('dialog', { name: t('Luna AI plan') });
const queryPaywall = () => screen.queryByRole('dialog', { name: 'Luna AI plan' });

// --- a fake offline status for the provider-level tests ---------------------------------------------------------
function offlineStore(online = true) {
  let state = { online, pendingCount: 0, lastError: null, queueLost: false, dropped: [], stuck: false, revision: 0 };
  const subs = new Set();
  return {
    getState: () => state,
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn); },
    acknowledge: () => {},
    setOnline(next) { state = { ...state, online: next }; subs.forEach(fn => fn(state)); },
  };
}
const offlineValue = store => ({ data: {}, status: store, acknowledge: () => {}, syncNow: () => Promise.resolve(), wipe: () => Promise.resolve(), pendingSummary: () => Promise.resolve({}) });

function Harness({ onUnlocked, startOpen = true }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" data-i18n-ignore onClick={() => setOpen(true)}>Open paywall</button>
      {open && <Paywall onClose={() => setOpen(false)} onUnlocked={() => { setOpen(false); if (onUnlocked) onUnlocked(); }} />}
      <PlanRow onUpgrade={() => setOpen(true)} />
    </>
  );
}

function renderPaywall({ client = mockClient, store = offlineStore(true), slowMs, email = 'u@gmail.com', onUnlocked = jest.fn(), startOpen } = {}) {
  const ui = mail => (
    <OfflineContext.Provider value={offlineValue(store)}>
      <BillingProvider token="tok" email={mail} client={client} slowMs={slowMs}>
        <Harness onUnlocked={onUnlocked} startOpen={startOpen} />
      </BillingProvider>
    </OfflineContext.Provider>
  );
  const utils = render(ui(email));
  return { ...utils, store, onUnlocked, rerenderEmail: mail => utils.rerender(ui(mail)) };
}

const subscribe = () => screen.findByRole('button', { name: 'Subscribe' });

// ------------------------------------------------------------------------------------------------------------------

describe('billing off: the app behaves as today', () => {
  test('Insights opens directly, the Profile has no plan row, and only GET /billing/status runs', async () => {
    renderJourney();
    await insights();
    userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await screen.findByText('Privacy & data');
    expect(screen.queryByText('Luna AI plan')).toBeNull();
    userEvent.click(screen.getByRole('button', { name: 'Close' }));

    userEvent.click(await insights());
    await waitFor(() => expect(API.analysis.list).toHaveBeenCalled());
    expect(queryPaywall()).toBeNull();
    expect(API.billing.status).toHaveBeenCalledTimes(1);
    expect(API.billing.status).toHaveBeenCalledWith('tok');
    expect(API.billing.refresh).not.toHaveBeenCalled();
    expect(API.billing.verify).not.toHaveBeenCalled();
    expect(mockClient.calls.isAvailable).toBe(0);
    expect(mockClient.calls.getProducts).toEqual([]);
  });

  test('the dock buttons carry no extra attributes', async () => {
    renderJourney();
    const button = await chat();
    await flush();
    expect(button.getAttribute('aria-busy')).toBeNull();
  });
});

describe('enabled, free plan: purchase flow', () => {
  beforeEach(() => { API.billing.status.mockResolvedValue(FREE); });

  test('a free user sees the paywall before the AI consent; Subscribe buys with the account token, the server verifies, then consent, then Insights', async () => {
    API.consents.get.mockResolvedValue({ ...ALL, ai_processing: false });
    renderJourney();
    userEvent.click(await insights());

    const dialog = await findPaywall();
    expect(screen.queryByText('Allow AI features?')).toBeNull();
    expect(API.analysis.list).not.toHaveBeenCalled();
    const yearly = await within(dialog).findByRole('radio', { name: '₹1,499.00 per year' });
    expect(within(dialog).getByRole('radio', { name: /₹199.00 per month/ })).toHaveAttribute('aria-checked', 'true');
    userEvent.click(yearly);
    expect(yearly).toHaveAttribute('aria-checked', 'true');
    userEvent.click(within(dialog).getByRole('button', { name: 'Subscribe' }));

    // Unlocked by the server: the paywall closes and the existing consent step comes next.
    expect(await screen.findByText('Allow AI features?')).toBeInTheDocument();
    expect(queryPaywall()).toBeNull();
    expect(API.analysis.list).not.toHaveBeenCalled();
    userEvent.click(screen.getByRole('button', { name: /allow ai features/i }));
    await waitFor(() => expect(API.consents.set).toHaveBeenCalledWith('ai_processing', true, 'tok'));
    await waitFor(() => expect(API.analysis.list).toHaveBeenCalled());
    expect(mockClient.calls.purchase).toHaveLength(1);
    expect(mockClient.calls.purchase[0].plan.id).toBe('luna_ai_yearly');
    expect(mockClient.calls.purchase[0].accountToken).toBe('acct-123');
    expect(API.billing.verify).toHaveBeenCalledWith({ purchase_token: 'fake-token-1', product_id: 'luna_ai_yearly' }, 'tok');
    expect(queryPaywall()).toBeNull();
    expect(mockClient.calls.getProducts).toEqual([IDS]);
  });

  test('the paywall discloses price, period, trial, renewal, how to cancel and the legal links', async () => {
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    const monthly = await within(dialog).findByRole('radio', { name: /₹199.00 per month/ });
    expect(monthly).toHaveTextContent('Free trial available');
    expect(within(dialog).getByText(/Renews automatically until cancelled\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Manage subscription/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(dialog).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(within(dialog).getByRole('button', { name: 'Restore purchases' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: 'Manage subscription' })).toBeNull(); // no plan on record
    expect(API.chat.history).not.toHaveBeenCalled();
  });

  test('a plan without a billing period is never offered', async () => {
    API.billing.status.mockResolvedValue({ ...FREE, product_ids: [...IDS, 'luna_ai_odd'] });
    mockClient = fakeClient({ products: [...plans(), { ...plans()[0], id: 'luna_ai_odd', planId: 'base', period: null, periodLabel: null }] });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    await within(dialog).findAllByRole('radio');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2);
  });

  test('no plan with a period at all: no Subscribe button', async () => {
    mockClient = fakeClient({ products: plans().map(p => ({ ...p, periodLabel: null })) });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    expect(await within(dialog).findByText('No plans are available right now. Please try again later.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).toBeNull();
  });

  test('a cancelled purchase shows a neutral line, not an error, and can be retried', async () => {
    mockClient = fakeClient({ products: plans(), purchase: { cancelled: true } });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));
    const line = await within(dialog).findByText("The purchase wasn't completed.");
    expect(line).toHaveAttribute('role', 'status');
    expect(line).not.toHaveClass('err');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(API.billing.verify).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Subscribe' })).toBeEnabled();
    expect(API.chat.history).not.toHaveBeenCalled();
  });

  test('a pending payment shows the pending line and is re-checked when the app comes back', async () => {
    const owned = [];
    mockClient = fakeClient({ products: plans(), purchase: { pending: true }, purchases: owned });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));
    expect(await within(dialog).findByText("Your payment is pending. We'll unlock the plan when it completes.")).toBeInTheDocument();
    expect(API.billing.verify).not.toHaveBeenCalled();
    expect(API.chat.history).not.toHaveBeenCalled();

    owned.push({ purchaseToken: 'tok-paid', productId: 'luna_ai_monthly' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledWith({ purchase_token: 'tok-paid', product_id: 'luna_ai_monthly' }, 'tok'));
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
  });

  test.each([
    [409, DIFFERENT],
    [409, LINKED],
    [400, 'This purchase could not be verified'],
    [502, 'Could not confirm the purchase with Google Play. Try again.'],
    [503, 'Google Play is unavailable right now. Try again.'],
  ])('verify %i "%s": the message shows, nothing unlocks, and Restore finishes it later', async (code, raw) => {
    API.billing.verify.mockRejectedValueOnce(apiError(code, raw));
    const owned = [];
    mockClient = fakeClient({ products: plans(), purchases: owned });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(raw);
    const hint = within(dialog).queryByText('Your purchase is kept. Tap Restore purchases to try again.');
    if (code === 409) expect(hint).toBeNull(); // linked elsewhere / not active: Restore will not change that
    else expect(hint).toBeInTheDocument();
    expect(API.chat.history).not.toHaveBeenCalled();

    owned.push({ purchaseToken: 'fake-token-1', productId: 'luna_ai_monthly' });
    userEvent.click(within(dialog).getByRole('button', { name: 'Restore purchases' }));
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(API.billing.verify).toHaveBeenLastCalledWith({ purchase_token: 'fake-token-1', product_id: 'luna_ai_monthly' }, 'tok');
  });

  test('the server unreachable after paying: "finish when back online", then finished on the next check', async () => {
    API.billing.verify.mockRejectedValueOnce(networkError());
    mockClient = fakeClient({ products: plans(), purchases: [] });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));
    const line = await within(dialog).findByText("Your purchase went through, but Luna couldn't confirm it yet. We'll finish this when you're back online.");
    expect(line).toHaveAttribute('role', 'status');
    expect(API.chat.history).not.toHaveBeenCalled();

    // Play no longer lists it (the fake restore is empty): the in-memory purchase is still retried.
    userEvent.click(within(dialog).getByRole('button', { name: 'Restore purchases' }));
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledTimes(2));
    expect(API.billing.verify).toHaveBeenLastCalledWith({ purchase_token: 'fake-token-1', product_id: 'luna_ai_monthly' }, 'tok');
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
  });

  test('a double tap on Subscribe starts one purchase', async () => {
    const pending = deferred();
    mockClient = fakeClient({ products: plans(), purchase: () => pending.promise });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    const button = await within(dialog).findByRole('button', { name: 'Subscribe' });
    fireEvent.click(button);
    fireEvent.click(button);
    userEvent.click(within(dialog).getByRole('button', { name: 'Opening Google Play…' }));
    expect(mockClient.calls.purchase).toHaveLength(1);
    await act(async () => { pending.resolve({ purchaseToken: 'tok-1', productId: 'luna_ai_monthly' }); });
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(API.billing.verify).toHaveBeenCalledTimes(1);
  });

  test('Restore verifies owned purchases one at a time and reports another account once', async () => {
    let running = 0; let maxRunning = 0;
    API.billing.verify.mockImplementation(async () => {
      running += 1; maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 5));
      running -= 1;
      throw apiError(409, DIFFERENT);
    });
    const owned = [];
    mockClient = fakeClient({ products: plans(), purchases: owned });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    const restoreButton = await within(dialog).findByRole('button', { name: 'Restore purchases' });
    await waitFor(() => expect(mockClient.calls.restore).toBe(1)); // the quiet check on open found nothing
    owned.push({ purchaseToken: 'a', productId: 'luna_ai_monthly' }, { purchaseToken: 'b', productId: 'luna_ai_yearly' });
    userEvent.click(restoreButton);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(DIFFERENT);
    expect(API.billing.verify).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    expect(within(dialog).getAllByText(new RegExp(DIFFERENT))).toHaveLength(1);
    expect(API.chat.history).not.toHaveBeenCalled();
  });

  test('Restore with nothing owned says so, neutrally', async () => {
    mockClient = fakeClient({ products: plans(), purchases: [] });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Restore purchases' }));
    expect(await within(dialog).findByText('No purchases to restore on this Google Play account.')).toHaveAttribute('role', 'status');
    expect(API.billing.verify).not.toHaveBeenCalled();
  });

  test('Play unavailable on the device: no Subscribe, a clear line', async () => {
    isNative.mockReturnValue(true);
    mockClient = fakeClient({ available: false });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    expect(await within(dialog).findByText("Google Play billing isn't available on this device right now.")).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).toBeNull();
  });

  test('a purchase that fails to start shows an error and grants nothing', async () => {
    const { BillingError } = jest.requireActual('./billingClient');
    mockClient = fakeClient({ products: plans(), purchase: new BillingError('unavailable') });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Google Play isn't available right now. Please try again later.");
    expect(API.billing.verify).not.toHaveBeenCalled();
    expect(API.chat.history).not.toHaveBeenCalled();
  });

  test('Not now closes the paywall without opening the AI screen', async () => {
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(queryPaywall()).toBeNull();
    expect(API.chat.history).not.toHaveBeenCalled();
  });

  test('Profile shows the plan row (Free plan, Upgrade opens the paywall)', async () => {
    renderJourney();
    userEvent.click(await screen.findByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Luna AI plan')).toBeInTheDocument();
    expect(screen.getByText('Free plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
    userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(await findPaywall()).toBeInTheDocument();
    expect(screen.queryByText('Privacy & data')).toBeNull();
  });
});

describe('plan status loading and failures', () => {
  test('an active plan: an AI tap while the status loads waits, then opens directly (never a paywall)', async () => {
    const status = deferred();
    API.billing.status.mockReturnValueOnce(status.promise);
    API.billing.refresh.mockResolvedValue(ACTIVE);
    renderJourney();
    const button = await chat();
    userEvent.click(button);
    await flush();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(queryPaywall()).toBeNull();
    expect(API.chat.history).not.toHaveBeenCalled();

    await act(async () => { status.resolve(ACTIVE); });
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(queryPaywall()).toBeNull();
    expect(button.getAttribute('aria-busy')).toBeNull();
    // A plan on record: one authoritative refresh at start.
    await waitFor(() => expect(API.billing.refresh).toHaveBeenCalledTimes(1));
  });

  test('a free plan: the tap waits for the status, then opens the paywall', async () => {
    const status = deferred();
    API.billing.status.mockReturnValueOnce(status.promise);
    renderJourney();
    userEvent.click(await insights());
    await flush();
    expect(queryPaywall()).toBeNull();
    await act(async () => { status.resolve(FREE); });
    expect(await findPaywall()).toBeInTheDocument();
    expect(API.analysis.list).not.toHaveBeenCalled();
    expect(API.billing.refresh).not.toHaveBeenCalled();
  });

  test('status unreachable and nothing cached: AI opens (the server still enforces the plan)', async () => {
    API.billing.status.mockRejectedValue(networkError());
    renderJourney();
    userEvent.click(await chat());
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(queryPaywall()).toBeNull();
  });

  test('the server answered with an error: the tap asks again, then offers Retry, not the AI screen', async () => {
    API.billing.status.mockRejectedValueOnce(apiError(500)).mockRejectedValueOnce(apiError(500)).mockResolvedValue(FREE);
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    expect(within(dialog).getByText("We couldn't check your Luna AI plan. Please try again.")).toBeInTheDocument();
    expect(API.billing.status).toHaveBeenCalledTimes(2);
    expect(API.chat.history).not.toHaveBeenCalled();
    userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
  });

  test('a Retry that finds billing off continues to the AI screen', async () => {
    API.billing.status.mockRejectedValueOnce(apiError(500)).mockRejectedValueOnce(apiError(500)).mockResolvedValue(OFF);
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(queryPaywall()).toBeNull();
  });
});

describe('plan_required from the server', () => {
  test('opens the paywall once per burst, refreshes once, and does not reopen after Not now', async () => {
    API.billing.status.mockRejectedValue(networkError());
    const refreshed = deferred();
    API.billing.refresh.mockReturnValueOnce(refreshed.promise).mockResolvedValue(FREE);
    renderJourney();
    userEvent.click(await chat());
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());

    act(() => {
      window.dispatchEvent(new CustomEvent('luna:plan-required'));
      window.dispatchEvent(new CustomEvent('luna:plan-required'));
    });
    const dialog = await findPaywall();
    expect(API.billing.refresh).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText('Checking your plan…')).toBeInTheDocument();
    await act(async () => { refreshed.resolve(FREE); });
    expect(await within(dialog).findByRole('button', { name: 'Subscribe' })).toBeInTheDocument();

    userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    act(() => { window.dispatchEvent(new CustomEvent('luna:plan-required')); });
    await flush();
    expect(queryPaywall()).toBeNull();

    // A new tap is a new intent: the gate now knows the plan is free.
    userEvent.click(await chat());
    expect(await findPaywall()).toBeInTheDocument();
  });

  test('a stale "active" status is revoked locally: the paywall waits for the refresh instead of reopening Chat', async () => {
    API.billing.status.mockResolvedValue(ACTIVE);
    API.billing.refresh.mockResolvedValueOnce(ACTIVE);
    renderJourney();
    userEvent.click(await chat());
    await waitFor(() => expect(API.chat.history).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(API.billing.refresh).toHaveBeenCalledTimes(1));

    API.billing.refresh.mockResolvedValueOnce(FREE);
    act(() => { window.dispatchEvent(new CustomEvent('luna:plan-required')); });
    const dialog = await findPaywall();
    expect(await within(dialog).findByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
    expect(API.chat.history).toHaveBeenCalledTimes(1);
  });
});

describe('provider: per account, offline, busy escape, web', () => {
  function Probe() {
    const billing = useBilling();
    return <div data-testid="probe">{billing.status ? (billing.status.active ? 'active' : 'free') : 'none'}</div>;
  }

  test('a new email starts from nothing: account A\'s plan never shows for account B', async () => {
    API.billing.status.mockResolvedValueOnce(ACTIVE);
    API.billing.refresh.mockResolvedValue(ACTIVE);
    const store = offlineStore(true);
    const ui = email => (
      <OfflineContext.Provider value={offlineValue(store)}>
        <BillingProvider token="tok" email={email} client={mockClient}><Probe /></BillingProvider>
      </OfflineContext.Provider>
    );
    const { rerender } = render(ui('a@gmail.com'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('active'));
    const next = deferred();
    API.billing.status.mockReturnValueOnce(next.promise);
    rerender(ui('b@gmail.com'));
    expect(screen.getByTestId('probe')).toHaveTextContent('none');
    await act(async () => { next.resolve(FREE); });
    expect(screen.getByTestId('probe')).toHaveTextContent('free');
  });

  test('sign-out and a new account in the app: the Profile row follows the new account', async () => {
    API.billing.status.mockResolvedValueOnce(ACTIVE);
    API.billing.refresh.mockResolvedValueOnce(ACTIVE);
    const { unmount } = renderJourney('u@gmail.com');
    userEvent.click(await screen.findByRole('button', { name: 'Profile' }));
    expect(await screen.findByText(/Active until/)).toBeInTheDocument();
    unmount();

    API.billing.status.mockResolvedValueOnce(FREE);
    renderJourney('b@gmail.com');
    userEvent.click(await screen.findByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Free plan')).toBeInTheDocument();
    expect(screen.queryByText(/Active until/)).toBeNull();
  });

  test('offline: Subscribe and Restore are disabled with a clear line; back online they work', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const store = offlineStore(true);
    renderPaywall({ store });
    await subscribe();
    act(() => store.setOnline(false));
    expect(await screen.findByText("You're offline. Connect to the internet to subscribe.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore purchases' })).toBeDisabled();
    act(() => store.setOnline(true));
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeEnabled();
  });

  test('a purchase left unverified by a dropped connection is verified when the app is back online', async () => {
    API.billing.status.mockResolvedValue(FREE);
    API.billing.verify.mockRejectedValueOnce(networkError()).mockResolvedValue(ACTIVE);
    const store = offlineStore(true);
    const { onUnlocked } = renderPaywall({ store });
    userEvent.click(await subscribe());
    await screen.findByText(/We'll finish this when you're back online\./);
    act(() => store.setOnline(false));
    act(() => store.setOnline(true));
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledTimes(2));
    expect(API.billing.verify).toHaveBeenLastCalledWith({ purchase_token: 'fake-token-1', product_id: 'luna_ai_monthly' }, 'tok');
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
  });

  test('a purchase that never comes back: a "taking long" line, Not now clears busy, a late purchase is still verified', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const stuck = deferred();
    mockClient = fakeClient({ products: plans(), purchase: [() => stuck.promise, { cancelled: true }] });
    renderPaywall({ slowMs: 20 });
    userEvent.click(await subscribe());
    expect(await screen.findByText('This is taking longer than usual. You can close this; if you paid, tap Restore purchases later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
    userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(queryPaywall()).toBeNull();

    userEvent.click(screen.getByRole('button', { name: 'Open paywall' }));
    expect(await subscribe()).toBeEnabled();
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();

    await act(async () => { stuck.resolve({ purchaseToken: 'late-token', productId: 'luna_ai_monthly' }); });
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledWith({ purchase_token: 'late-token', product_id: 'luna_ai_monthly' }, 'tok'));
  });

  test('the provider guards a double buy() call', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const pending = deferred();
    mockClient = fakeClient({ products: plans(), purchase: () => pending.promise });
    let api;
    function Grab() { api = useBilling(); return null; }
    render(
      <OfflineContext.Provider value={offlineValue(offlineStore(true))}>
        <BillingProvider token="tok" email="u@gmail.com" client={mockClient}><Grab /></BillingProvider>
      </OfflineContext.Provider>,
    );
    await waitFor(() => expect(api.status).not.toBeNull());
    await act(async () => { await api.loadProducts(); });
    act(() => { api.buy(api.products[0]); api.buy(api.products[0]); });
    expect(mockClient.calls.purchase).toHaveLength(1);
    await act(async () => { pending.resolve({ cancelled: true }); });
  });

  test('nothing unlocks from the client\'s word: a purchase the server does not confirm leaves the plan free', async () => {
    API.billing.status.mockResolvedValue(FREE);
    API.billing.verify.mockRejectedValue(apiError(409, 'This subscription is not active'));
    const { onUnlocked } = renderPaywall();
    userEvent.click(await subscribe());
    expect(await screen.findByRole('alert')).toHaveTextContent('This subscription is not active');
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(screen.getByText('Free plan')).toBeInTheDocument();
  });

  test('purchase tokens are not logged or stored', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(k => jest.spyOn(console, k).mockImplementation(() => {}));
    renderPaywall();
    userEvent.click(await subscribe());
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalled());
    const logged = JSON.stringify(spies.map(s => s.mock.calls));
    spies.forEach(s => s.mockRestore());
    expect(logged).not.toContain('fake-token-1');
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain('fake-token-1');
  });

  test('web: the web text, no Subscribe, no Restore', async () => {
    API.billing.status.mockResolvedValue(FREE);
    renderPaywall({ client: webClient });
    expect(await screen.findByText('The Luna AI plan is purchased in the Android app. Sign in with the same account here to use it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore purchases' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
  });

  test('Manage subscription appears only when a plan is on record (native), and calls Play', async () => {
    isNative.mockReturnValue(true);
    API.billing.status.mockResolvedValue(ON_HOLD);
    API.billing.refresh.mockResolvedValue(ON_HOLD);
    renderPaywall();
    const dialog = await findPaywall();
    const buttons = await within(dialog).findAllByRole('button', { name: 'Manage subscription' });
    expect(buttons).toHaveLength(1);
    userEvent.click(buttons[0]);
    await waitFor(() => expect(mockClient.calls.manage).toBe(1));
  });

  test('PlanRow: active plan shows the date and Manage; a failing Manage explains', async () => {
    isNative.mockReturnValue(true);
    API.billing.status.mockResolvedValue(ACTIVE);
    API.billing.refresh.mockResolvedValue(ACTIVE);
    const { BillingError } = jest.requireActual('./billingClient');
    mockClient = fakeClient({ manage: new BillingError('unavailable') });
    renderPaywall({ startOpen: false });
    expect(await screen.findByText('Active until December 1, 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    userEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Google Play isn't available right now. Please try again later.");
  });
});

describe('paywall accessibility and layout', () => {
  beforeEach(() => { API.billing.status.mockResolvedValue(FREE); });

  test('a labelled dialog: focus moves in, Escape closes, focus returns to the button', async () => {
    renderJourney();
    const button = await chat();
    button.focus();
    userEvent.click(button);
    const dialog = await findPaywall();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryPaywall()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test('plans are a radio group with arrow-key selection', async () => {
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    const group = await within(dialog).findByRole('radiogroup', { name: 'Choose a plan' });
    const [monthly, yearly] = within(group).getAllByRole('radio');
    monthly.focus();
    fireEvent.keyDown(monthly, { key: 'ArrowDown' });
    expect(yearly).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(yearly);
  });

  test('class-based layout: no inline sizes, every button and plan card is a 44px target', async () => {
    renderPaywall();
    const dialog = await findPaywall();
    await within(dialog).findAllByRole('radio');
    const nodes = [...dialog.querySelectorAll('.pay, .pay *')];
    nodes.forEach(el => expect(el.getAttribute('style')).toBeNull());
    within(dialog).getAllByRole('radio').forEach(el => expect(el).toHaveClass('pay-plan'));
    [...dialog.querySelectorAll('.pay button')].forEach(el => {
      expect(el.classList.contains('pay-btn') || el.classList.contains('pay-plan')).toBe(true);
    });
    const row = document.querySelector('.plan-row');
    [row, ...row.querySelectorAll('*')].forEach(el => expect(el.getAttribute('style')).toBeNull());
  });

  test('the new CSS wraps, has no fixed widths, filters, blend modes, animations or transitions', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'App.js'), 'utf8');
    const rules = source.split('\n').filter(l => /^\.(pay|plan-row)/.test(l)).join('\n');
    expect(rules).toContain('.pay-plan{');
    expect(rules).not.toMatch(/filter|backdrop|mix-blend|animation|transition/);
    expect(rules).not.toMatch(/(^|[;{])\s*width:\s*\d/m);
    expect(rules).toMatch(/\.pay-plan\{[^}]*min-height:44px/);
    expect(rules).toMatch(/\.pay-btn\{[^}]*min-height:44px/);
    expect(rules).toMatch(/\.pay-legal a\{[^}]*min-height:44px/);
    expect(rules).toMatch(/\.pay\{[^}]*overflow-wrap:anywhere/);
    expect(rules).toMatch(/\.plan-row\{[^}]*flex-wrap:wrap/);
  });
});

describe('Hindi', () => {
  const hindi = () => act(() => { setLanguage('hi'); });
  const noEnglish = container => expect(findUntranslated(container, ['Luna', 'Android'])).toEqual([]);

  beforeEach(() => { API.billing.status.mockResolvedValue(FREE); });

  test('the paywall with plans, the plan row and the purchase lines', async () => {
    hindi();
    mockClient = fakeClient({ products: plans(), purchase: [{ cancelled: true }, { pending: true }, undefined, undefined], purchases: [] });
    API.billing.verify.mockRejectedValueOnce(networkError()).mockRejectedValueOnce(apiError(409, DIFFERENT));
    const { container } = renderPaywall();
    const dialog = await findPaywall();
    await within(dialog).findAllByRole('radio');
    noEnglish(container);
    userEvent.click(within(dialog).getByRole('button', { name: t('Subscribe') }));
    await within(dialog).findByText(t("The purchase wasn't completed."));
    noEnglish(container);
    userEvent.click(within(dialog).getByRole('button', { name: t('Subscribe') }));
    await within(dialog).findByText(t("Your payment is pending. We'll unlock the plan when it completes."));
    noEnglish(container);
    userEvent.click(within(dialog).getByRole('button', { name: t('Subscribe') }));
    await within(dialog).findByText(t("Your purchase went through, but Luna couldn't confirm it yet. We'll finish this when you're back online."));
    noEnglish(container);
    userEvent.click(within(dialog).getByRole('button', { name: t('Subscribe') }));
    await within(dialog).findByRole('alert');
    noEnglish(container);
  });

  test('restore lines, web text, the unavailable and retry views', async () => {
    hindi();
    mockClient = fakeClient({ products: plans(), purchases: [] });
    const first = renderPaywall();
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: t('Restore purchases') }));
    await within(dialog).findByText(t('No purchases to restore on this Google Play account.'));
    noEnglish(first.container);
    first.unmount();

    const web = renderPaywall({ client: webClient });
    await screen.findByText(t('The Luna AI plan is purchased in the Android app. Sign in with the same account here to use it.'));
    noEnglish(web.container);
    web.unmount();

    isNative.mockReturnValue(true);
    const none = renderPaywall({ client: fakeClient({ available: false }) });
    await screen.findByText(t("Google Play billing isn't available on this device right now."));
    noEnglish(none.container);
    none.unmount();

    API.billing.status.mockRejectedValue(apiError(500));
    const failed = renderPaywall();
    await screen.findByText(t("We couldn't check your Luna AI plan. Please try again."));
    noEnglish(failed.container);
  });

  test('plan row, active, with Manage', async () => {
    hindi();
    isNative.mockReturnValue(true);
    API.billing.status.mockResolvedValue(ACTIVE);
    API.billing.refresh.mockResolvedValue(ACTIVE);
    const { container } = renderPaywall({ startOpen: false });
    await screen.findByRole('button', { name: t('Manage subscription') });
    expect(container.querySelector('.plan-row-status').textContent).toMatch(/2026/);
    noEnglish(container);
  });
});

describe('final review fixes', () => {
  const HINT = 'Your purchase is kept. Tap Restore purchases to try again.';
  const OFFLINE_AFTER_PAY = "Your purchase went through, but Luna couldn't confirm it yet. We'll finish this when you're back online.";
  const setVisibility = value => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  afterEach(() => { setVisibility('visible'); });

  test('killed mid-purchase: Play owns it, the status is free; opening the paywall verifies it quietly and unlocks', async () => {
    API.billing.status.mockResolvedValue(FREE);
    mockClient = fakeClient({ products: plans(), purchases: [{ purchaseToken: 'paid-before-kill', productId: 'luna_ai_monthly' }] });
    renderJourney();
    userEvent.click(await chat());
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledWith({ purchase_token: 'paid-before-kill', product_id: 'luna_ai_monthly' }, 'tok'));
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(queryPaywall()).toBeNull();
    expect(mockClient.calls.purchase).toHaveLength(0);
  });

  test('the quiet check runs once per session, reports nothing when nothing is owned, and never reports another account', async () => {
    API.billing.status.mockResolvedValue(FREE);
    API.billing.verify.mockRejectedValue(apiError(409, DIFFERENT));
    mockClient = fakeClient({ products: plans(), purchases: [{ purchaseToken: 'foreign', productId: 'luna_ai_monthly' }] });
    renderPaywall();
    await subscribe();
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledTimes(1));
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    userEvent.click(screen.getByRole('button', { name: 'Open paywall' }));
    await subscribe();
    await flush();
    expect(mockClient.calls.restore).toBe(1);
  });

  test('a cancelled purchase (also how "already owned" looks) runs the quiet check and unlocks an owned plan', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const owned = [];
    mockClient = fakeClient({ products: plans(), purchase: () => { owned.push({ purchaseToken: 'owned', productId: 'luna_ai_monthly' }); return { cancelled: true }; }, purchases: owned });
    const { onUnlocked } = renderPaywall();
    userEvent.click(await subscribe());
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledWith({ purchase_token: 'owned', product_id: 'luna_ai_monthly' }, 'tok'));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
    expect(mockClient.calls.restore).toBe(2);
  });

  test.each([
    ['SUBSCRIPTION_STATE_ON_HOLD', 'Payment on hold'],
    ['SUBSCRIPTION_STATE_PAUSED', 'Paused'],
  ])('PlanRow for %s shows "%s" and Manage instead of Upgrade', async (state, line) => {
    isNative.mockReturnValue(true);
    const status = { ...FREE, state, product_id: 'luna_ai_monthly' };
    API.billing.status.mockResolvedValue(status);
    API.billing.refresh.mockResolvedValue(status);
    renderPaywall({ startOpen: false });
    expect(await screen.findByText(line)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
  });

  test('a renewing user: while the startup refresh runs, an AI tap waits for it instead of flashing the paywall', async () => {
    const lapsed = { ...FREE, state: 'SUBSCRIPTION_STATE_ACTIVE', product_id: 'luna_ai_monthly', expires_at: '2026-10-31T10:00:00Z' };
    API.billing.status.mockResolvedValue(lapsed);
    const refreshed = deferred();
    API.billing.refresh.mockReturnValueOnce(refreshed.promise);
    renderJourney();
    const button = await chat();
    await waitFor(() => expect(API.billing.refresh).toHaveBeenCalledTimes(1));
    userEvent.click(button);
    await flush();
    expect(queryPaywall()).toBeNull();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await act(async () => { refreshed.resolve(ACTIVE); });
    await waitFor(() => expect(API.chat.history).toHaveBeenCalled());
    expect(queryPaywall()).toBeNull();
  });

  test('a renewing user whose refresh says free gets the paywall after it', async () => {
    const lapsed = { ...FREE, state: 'SUBSCRIPTION_STATE_EXPIRED', product_id: 'luna_ai_monthly' };
    API.billing.status.mockResolvedValue(lapsed);
    const refreshed = deferred();
    API.billing.refresh.mockReturnValueOnce(refreshed.promise);
    renderJourney();
    const button = await chat();
    await waitFor(() => expect(API.billing.refresh).toHaveBeenCalledTimes(1));
    userEvent.click(button);
    await flush();
    expect(queryPaywall()).toBeNull();
    await act(async () => { refreshed.resolve(lapsed); });
    expect(await findPaywall()).toBeInTheDocument();
  });

  test('no resume check while a purchase is in flight, and none while the app is hidden', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const pending = deferred();
    mockClient = fakeClient({ products: plans(), purchase: [undefined, () => pending.promise], purchases: [] });
    API.billing.verify.mockRejectedValueOnce(networkError()); // leaves the first purchase unverified: a recheck has work
    const store = offlineStore(true);
    renderPaywall({ store });
    userEvent.click(await subscribe());
    await screen.findByText(OFFLINE_AFTER_PAY);
    await waitFor(() => expect(mockClient.calls.restore).toBe(1)); // the quiet check on open

    // A second purchase is in flight: neither resume nor reconnect may touch Play.
    userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    await screen.findByRole('button', { name: 'Opening Google Play…' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => store.setOnline(false));
    act(() => store.setOnline(true));
    await flush();
    expect(mockClient.calls.restore).toBe(1);

    await act(async () => { pending.resolve({ pending: true }); });
    await screen.findByText("Your payment is pending. We'll unlock the plan when it completes.");
    // Hidden (the app is in the background): no restore on reconnect.
    setVisibility('hidden');
    act(() => store.setOnline(false));
    act(() => store.setOnline(true));
    await flush();
    expect(mockClient.calls.restore).toBe(1);
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(mockClient.calls.restore).toBe(2));
  });

  test('a late Restore result does not appear in a later paywall', async () => {
    API.billing.status.mockResolvedValue(FREE);
    const base = fakeClient({ products: plans(), purchases: [] });
    const slow = deferred();
    let restores = 0;
    const client = { ...base, restore: () => { restores += 1; return restores === 1 ? Promise.resolve([]) : slow.promise; } };
    renderPaywall({ client });
    userEvent.click(await screen.findByRole('button', { name: 'Restore purchases' }));
    expect(await screen.findByRole('button', { name: 'Restoring…' })).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    userEvent.click(screen.getByRole('button', { name: 'Open paywall' }));
    await subscribe();
    await act(async () => { slow.resolve([]); });
    await flush();
    expect(screen.queryByText('No purchases to restore on this Google Play account.')).toBeNull();
  });

  test('a non-API verify failure (bad JSON) is treated as a dropped connection: kept and retried, no raw text', async () => {
    API.billing.status.mockResolvedValue(FREE);
    API.billing.verify.mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON at position 0'));
    renderPaywall();
    userEvent.click(await subscribe());
    expect(await screen.findByText(OFFLINE_AFTER_PAY)).toHaveAttribute('role', 'status');
    expect(screen.queryByText(/Unexpected token/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    userEvent.click(screen.getByRole('button', { name: 'Restore purchases' }));
    await waitFor(() => expect(API.billing.verify).toHaveBeenCalledTimes(2));
    expect(API.billing.verify).toHaveBeenLastCalledWith({ purchase_token: 'fake-token-1', product_id: 'luna_ai_monthly' }, 'tok');
  });

  test('409 "not active" shows the message without the "kept" hint; a 502 keeps the hint', async () => {
    API.billing.status.mockResolvedValue(FREE);
    API.billing.verify
      .mockRejectedValueOnce(apiError(409, 'This subscription is not active'))
      .mockRejectedValueOnce(apiError(502, 'Could not confirm the purchase with Google Play. Try again.'));
    renderPaywall();
    userEvent.click(await subscribe());
    expect(await screen.findByRole('alert')).toHaveTextContent('This subscription is not active');
    expect(screen.queryByText(HINT)).toBeNull();
    userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByText(/Could not confirm the purchase/)).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  test('an active plan without AI consent: consent first, as before (no paywall)', async () => {
    API.consents.get.mockResolvedValue({ ...ALL, ai_processing: false });
    API.billing.status.mockResolvedValue(ACTIVE);
    API.billing.refresh.mockResolvedValue(ACTIVE);
    renderJourney();
    userEvent.click(await chat());
    expect(await screen.findByText('Allow AI features?')).toBeInTheDocument();
    expect(queryPaywall()).toBeNull();
  });

  test('billing off without AI consent: consent first, as before', async () => {
    API.consents.get.mockResolvedValue({ ...ALL, ai_processing: false });
    renderJourney();
    userEvent.click(await chat());
    expect(await screen.findByText('Allow AI features?')).toBeInTheDocument();
    expect(queryPaywall()).toBeNull();
  });

  test('Profile > Upgrade > Not now: focus goes to the dock Profile tab (the drawer is closed)', async () => {
    API.billing.status.mockResolvedValue(FREE);
    renderJourney();
    userEvent.click(await screen.findByRole('button', { name: 'Profile' }));
    userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    const dialog = await findPaywall();
    userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(queryPaywall()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Profile' }));
  });

  test('the Terms and Privacy links are 44px targets in both directions', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'App.js'), 'utf8');
    const rule = source.split('\n').find(l => l.startsWith('.pay-legal a{'));
    expect(rule).toMatch(/min-height:44px/);
    expect(rule).toMatch(/min-width:44px/);
    expect(rule).toMatch(/padding:[^;]*[1-9]/);
    expect(rule).toMatch(/justify-content:center/);
  });

  test('Hindi: the on-hold and paused lines are translated', async () => {
    act(() => { setLanguage('hi'); });
    isNative.mockReturnValue(true);
    const status = { ...FREE, state: 'SUBSCRIPTION_STATE_PAUSED', product_id: 'luna_ai_monthly' };
    API.billing.status.mockResolvedValue(status);
    API.billing.refresh.mockResolvedValue(status);
    const { container } = renderPaywall({ startOpen: false });
    await screen.findByRole('button', { name: t('Manage subscription') });
    expect(findUntranslated(container, ['Luna'])).toEqual([]);
    expect(t('Payment on hold')).not.toBe('Payment on hold');
    expect(t('Paused')).not.toBe('Paused');
  });
});
