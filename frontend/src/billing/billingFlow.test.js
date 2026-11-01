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

  test('consent first, then the paywall; Subscribe buys with the account token, the server verifies, Insights opens', async () => {
    API.consents.get.mockResolvedValue({ ...ALL, ai_processing: false });
    renderJourney();
    userEvent.click(await insights());
    userEvent.click(await screen.findByRole('button', { name: /allow ai features/i }));

    const dialog = await findPaywall();
    expect(API.analysis.list).not.toHaveBeenCalled();
    const yearly = await within(dialog).findByRole('radio', { name: '₹1,499.00 per year' });
    expect(within(dialog).getByRole('radio', { name: /₹199.00 per month/ })).toHaveAttribute('aria-checked', 'true');
    userEvent.click(yearly);
    expect(yearly).toHaveAttribute('aria-checked', 'true');
    userEvent.click(within(dialog).getByRole('button', { name: 'Subscribe' }));

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
    mockClient = fakeClient({ products: plans(), purchase: { pending: true }, purchases: [{ purchaseToken: 'tok-paid', productId: 'luna_ai_monthly' }] });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));
    expect(await within(dialog).findByText("Your payment is pending. We'll unlock the plan when it completes.")).toBeInTheDocument();
    expect(API.billing.verify).not.toHaveBeenCalled();
    expect(API.chat.history).not.toHaveBeenCalled();

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
    mockClient = fakeClient({ products: plans(), purchases: [{ purchaseToken: 'fake-token-1', productId: 'luna_ai_monthly' }] });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Subscribe' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(raw);
    expect(within(dialog).getByText('Your purchase is kept. Tap Restore purchases to try again.')).toBeInTheDocument();
    expect(API.chat.history).not.toHaveBeenCalled();

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
    mockClient = fakeClient({ products: plans(), purchases: [{ purchaseToken: 'a', productId: 'luna_ai_monthly' }, { purchaseToken: 'b', productId: 'luna_ai_yearly' }] });
    renderJourney();
    userEvent.click(await chat());
    const dialog = await findPaywall();
    userEvent.click(await within(dialog).findByRole('button', { name: 'Restore purchases' }));
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
