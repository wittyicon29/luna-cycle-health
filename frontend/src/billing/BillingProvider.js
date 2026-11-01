import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API } from '../api';
import { t } from '../i18n';
import { isNative } from '../platform';
import { useOffline } from '../offline/useOffline';
import { getBillingClient } from './billingClient';
import { BillingContext } from './useBilling';

// Luna AI plan state for one signed-in account. Rules:
// - Access is unlocked ONLY by the server's status.active (from /billing/status, /verify or /refresh), never by a
//   client purchase result. Every purchase carries appAccountToken = status.account_token; the server acknowledges.
// - Purchase tokens live in memory only (to finish a verify after a connection drop) and are never logged or stored.
// - Billing off (status.enabled false) or no status: nothing here changes the app, and only GET /billing/status runs.
// - Status unknown: while the first request is in flight AI taps wait for it (no paywall flash). If the server could
//   not be reached and nothing is cached, AI opens (fail open: the server still answers plan_required, which opens
//   the paywall). If the server answered with an error, the tap asks again once, then shows the paywall's retry view.

export const PURCHASE_SLOW_MS = 30000; // after this a purchase that has not come back shows the "taking long" line
export const STATUS_WAIT_MS = 10000; // the longest an AI tap waits for the plan status before opening anyway

const DIFFERENT_ACCOUNT = 'This purchase belongs to a different account';
const ALREADY_LINKED = 'This purchase is already linked to another account';

const isApiError = e => !!e && e.name === 'ApiError';
const isNetwork = e => isApiError(e) && e.status === 0;
const serverAnswered = e => isApiError(e) && e.status > 0;

// The paywall offers a plan only with a price and a billing period (the disclosure rule); Android gives no period,
// so a plan whose base plan id did not name one has periodLabel null and is left out.
export const offerable = plan => !!(plan && plan.id && plan.priceString && plan.periodLabel);

const hasStoredPlan = s => !!(s && s.enabled && (s.active || s.product_id || s.state));

function normalise(s) {
  const enabled = s.enabled === true;
  return {
    ...s,
    enabled,
    active: enabled && s.active === true,
    product_ids: Array.isArray(s.product_ids) ? s.product_ids : [],
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const notices = {
  cancelled: () => ({ kind: 'neutral', text: t("The purchase wasn't completed.") }),
  pending: () => ({ kind: 'info', text: t("Your payment is pending. We'll unlock the plan when it completes.") }),
  offlineAfterPay: () => ({ kind: 'info', text: t("Your purchase went through, but Luna couldn't confirm it yet. We'll finish this when you're back online.") }),
  active: () => ({ kind: 'success', text: t('Your Luna AI plan is active.') }),
  nothingToRestore: () => ({ kind: 'neutral', text: t('No purchases to restore on this Google Play account.') }),
  noneActive: () => ({ kind: 'neutral', text: t('No active Luna AI plan was found to restore.') }),
  // Only an ApiError's message is shown (it is the server's translated text). A 409 (linked to another account, not
  // active, wrong product) will not change by restoring, so it carries no "kept" hint.
  rejected: error => ({
    kind: 'error',
    text: (isApiError(error) && error.message) || t('This purchase could not be verified'),
    hint: isApiError(error) && error.status === 409 ? undefined : t('Your purchase is kept. Tap Restore purchases to try again.'),
  }),
};

function clientNotice(error, action) {
  const code = error && error.code;
  if (code === 'network') return { kind: 'error', text: t('Connection problem. Please try again.') };
  if (code === 'unavailable') return { kind: 'error', text: t("Google Play isn't available right now. Please try again later.") };
  if (action === 'restore') return { kind: 'error', text: t("Your purchases couldn't be checked. Please try again.") };
  if (action === 'manage') return { kind: 'error', text: t("Google Play couldn't be opened. Please try again.") };
  return { kind: 'error', text: t("The purchase couldn't be started. Please try again.") };
}

// State is per account: a new email mounts a fresh provider, so nothing from account A reaches account B.
export default function BillingProvider(props) {
  return <BillingState key={props.email || ''} {...props} />;
}

function BillingState({ token, client: clientProp, slowMs = PURCHASE_SLOW_MS, children }) {
  const client = useMemo(() => clientProp || getBillingClient(), [clientProp]);
  const { status: offlineStatus } = useOffline();
  const online = offlineStatus.online;

  const [status, setStatus] = useState(null);
  const [statusState, setStatusStateValue] = useState('loading'); // loading | ready | unreachable | error
  const [checking, setChecking] = useState(false); // a refresh after plan_required is in flight
  const [products, setProducts] = useState([]);
  const [productsState, setProductsStateValue] = useState('idle'); // idle | loading | ready | error
  const [available, setAvailable] = useState(null);
  const [busy, setBusy] = useState(''); // '' | 'buy' | 'restore'
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState(null);

  const alive = useRef(true);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const statusRef = useRef(null);
  const statusStateRef = useRef('loading');
  const productsStateRef = useRef('idle');
  const statusPromise = useRef(null);
  const refreshPromise = useRef(null);
  const inFlight = useRef(false);
  const gen = useRef(0);
  const unverified = useRef([]); // { purchaseToken, productId } whose verify could not reach the server (memory only)
  const pendingPurchase = useRef(false);
  const manageOpened = useRef(false);
  const rechecking = useRef(false);
  const startupRefresh = useRef(null); // the authoritative refresh at start, while it runs (a plan is on record)
  const quietChecked = useRef(false); // owned purchases are verified quietly once per session, when the paywall loads
  const quietRestoreRef = useRef(null);

  const setStatusState = useCallback(value => { statusStateRef.current = value; setStatusStateValue(value); }, []);
  const setProductsState = useCallback(value => { productsStateRef.current = value; setProductsStateValue(value); }, []);

  const applyStatus = useCallback(s => {
    if (!alive.current || !s || typeof s !== 'object') return;
    const next = normalise(s);
    statusRef.current = next;
    setStatus(next);
    setStatusState('ready');
  }, [setStatusState]);

  const fetchStatus = useCallback(() => {
    if (statusPromise.current) return statusPromise.current;
    if (!statusRef.current) setStatusState('loading');
    const run = (async () => {
      try {
        const s = await API.billing.status(tokenRef.current);
        if (!s || typeof s !== 'object') throw new Error('No billing status');
        applyStatus(s);
        return s;
      } catch (e) {
        // A cached status stays in force; without one, an HTTP error keeps the gate closed (retry), and anything
        // else (offline, DNS, timeout) means unknown: AI opens and the server enforces the plan.
        // Fail open: no HTTP answer => open; the server enforces plan_required (which opens the paywall). This also
        // keeps old test mocks without API.billing working.
        if (alive.current && !statusRef.current) setStatusState(serverAnswered(e) ? 'error' : 'unreachable');
        return null;
      } finally {
        statusPromise.current = null;
      }
    })();
    statusPromise.current = run;
    return run;
  }, [applyStatus, setStatusState]);

  const refresh = useCallback(() => {
    if (refreshPromise.current) return refreshPromise.current;
    const run = (async () => {
      try {
        const s = await API.billing.refresh(tokenRef.current);
        applyStatus(s);
        return s;
      } catch (e) {
        return statusRef.current ? null : fetchStatus();
      } finally {
        refreshPromise.current = null;
      }
    })();
    refreshPromise.current = run;
    return run;
  }, [applyStatus, fetchStatus]);

  // Start: the cached status, then one authoritative refresh when a plan is on record.
  useEffect(() => {
    alive.current = true;
    (async () => {
      const s = await fetchStatus();
      if (alive.current && s && hasStoredPlan(normalise(s))) {
        const run = refresh();
        startupRefresh.current = run;
        run.finally(() => { if (startupRefresh.current === run) startupRefresh.current = null; });
      }
    })();
    return () => { alive.current = false; };
  }, [fetchStatus, refresh]);

  // Back online with no status yet: ask again (offline start).
  useEffect(() => {
    if (online && !statusRef.current && statusStateRef.current === 'unreachable') fetchStatus();
  }, [online, fetchStatus]);

  // The server refused an AI call with plan_required: the plan is not active, whatever we had cached. Revoking
  // locally is safe (it never grants); the refresh brings the authoritative status.
  useEffect(() => {
    const onPlanRequired = () => {
      const cur = statusRef.current;
      if (cur && cur.active) applyStatus({ ...cur, active: false, plan: 'free' });
      setChecking(true);
      refresh().finally(() => { if (alive.current) setChecking(false); });
    };
    window.addEventListener('luna:plan-required', onPlanRequired);
    return () => window.removeEventListener('luna:plan-required', onPlanRequired);
  }, [applyStatus, refresh]);

  // `waitForRefresh`: a renewing user's cached status may say "not active" until the startup refresh answers, so
  // while it runs the answer is 'loading' (the tap waits) instead of a paywall flash.
  const access = useCallback((waitForRefresh = true) => {
    const s = statusRef.current;
    if (s && waitForRefresh && !s.active && s.enabled && hasStoredPlan(s) && startupRefresh.current) return 'loading';
    if (s) return !s.enabled || s.active ? 'open' : 'paywall';
    const state = statusStateRef.current;
    if (state === 'unreachable') return 'open';
    if (state === 'error') return 'error';
    return 'loading';
  }, []);

  const checkAccess = useCallback(async () => {
    const now = access();
    if (now === 'open' || now === 'paywall') return now;
    const waitFor = statusRef.current && startupRefresh.current ? startupRefresh.current : statusPromise.current || fetchStatus();
    await withTimeout(waitFor, STATUS_WAIT_MS);
    const after = access(false);
    return after === 'loading' ? 'open' : after;
  }, [access, fetchStatus]);

  const retryStatus = useCallback(() => fetchStatus(), [fetchStatus]);

  const loadProducts = useCallback(async (force = false) => {
    const s = statusRef.current;
    if (!s || !s.enabled || s.active) return;
    const state = productsStateRef.current;
    if (state === 'loading' || (state === 'ready' && !force)) return;
    setProductsState('loading');
    let ok = false;
    try { ok = await client.isAvailable(); } catch (e) { ok = false; }
    if (!alive.current) return;
    setAvailable(ok);
    if (!ok) { setProducts([]); setProductsState('ready'); return; }
    // A purchase paid before the app was killed (or whose verify never reached the server) is finished here.
    if (!quietChecked.current && quietRestoreRef.current) {
      quietChecked.current = true;
      quietRestoreRef.current();
    }
    try {
      const plans = await client.getProducts(s.product_ids);
      if (!alive.current) return;
      setProducts((Array.isArray(plans) ? plans : []).filter(offerable));
      setProductsState('ready');
    } catch (e) {
      if (alive.current) setProductsState('error');
    }
  }, [client, setProductsState]);

  // Sends one purchase to the server. Only the server's answer changes access.
  const verify = useCallback(async purchase => {
    const forget = () => {
      unverified.current = unverified.current.filter(p => p.purchaseToken !== purchase.purchaseToken);
    };
    try {
      const s = await API.billing.verify({ purchase_token: purchase.purchaseToken, product_id: purchase.productId }, tokenRef.current);
      forget();
      applyStatus(s);
      return { status: normalise(s || {}) };
    } catch (e) {
      // No usable answer (offline, or a non-API failure such as a non-JSON 200): keep it and retry later.
      if (isNetwork(e) || !isApiError(e)) {
        if (!unverified.current.some(p => p.purchaseToken === purchase.purchaseToken)) {
          unverified.current = [...unverified.current, { purchaseToken: purchase.purchaseToken, productId: purchase.productId }];
        }
        return { network: true };
      }
      forget();
      return { error: e };
    }
  }, [applyStatus]);

  // Verifies what Play says this account owns (plus anything a connection drop left unverified), one at a time.
  // A purchase linked to another Luna account is reported once, however many there are.
  const restoreOwned = useCallback(async ({ quiet = false } = {}) => {
    let owned;
    try {
      owned = await client.restore();
    } catch (e) {
      owned = null;
      if (!unverified.current.length) return quiet ? null : clientNotice(e, 'restore');
    }
    const seen = new Set();
    const list = [...unverified.current, ...(Array.isArray(owned) ? owned : [])].filter(p => {
      if (!p || !p.purchaseToken || seen.has(p.purchaseToken)) return false;
      seen.add(p.purchaseToken);
      return true;
    });
    if (!list.length) return quiet ? null : notices.nothingToRestore();
    let network = false;
    let foreign = null;
    let other = null;
    for (const purchase of list) {
      const result = await verify(purchase);
      if (result.status && result.status.active) return notices.active();
      if (result.network) network = true;
      else if (result.error) {
        const raw = result.error.rawMessage;
        if (result.error.status === 409 && (raw === DIFFERENT_ACCOUNT || raw === ALREADY_LINKED)) foreign = foreign || result.error;
        else other = other || result.error;
      }
    }
    if (quiet) return null;
    if (network) return notices.offlineAfterPay();
    if (foreign) return { kind: 'error', text: foreign.message };
    if (other) return notices.rejected(other);
    return notices.noneActive();
  }, [client, verify]);

  // Verifies owned purchases without reporting anything but success (no "nothing owned", no other-account line).
  const quietRestore = useCallback(async () => {
    const result = await restoreOwned({ quiet: true });
    if (result && result.kind === 'success') pendingPurchase.current = false;
    return result;
  }, [restoreOwned]);
  quietRestoreRef.current = quietRestore;

  const finishRun = useCallback((mine, timer) => {
    if (timer) clearTimeout(timer);
    if (gen.current !== mine) return;
    inFlight.current = false;
    if (alive.current) { setBusy(''); setSlow(false); }
  }, []);

  const buy = useCallback(async plan => {
    const s = statusRef.current;
    if (inFlight.current || !s || !s.enabled || s.active || !s.account_token || !offerable(plan) || !onlineRef.current) return;
    inFlight.current = true;
    const mine = ++gen.current;
    const current = () => alive.current && gen.current === mine;
    setBusy('buy');
    setSlow(false);
    setNotice(null);
    const timer = setTimeout(() => { if (current()) setSlow(true); }, slowMs);
    try {
      let result;
      try {
        result = await client.purchase(plan, s.account_token);
      } catch (e) {
        if (current()) setNotice(clientNotice(e, 'buy'));
        return;
      }
      if (!result) return;
      if (result.cancelled) {
        if (current()) setNotice(notices.cancelled());
        // "Already owned" and other Play failures look like a cancel: check what this account owns.
        await quietRestore();
        return;
      }
      if (result.pending) { pendingPurchase.current = true; if (current()) setNotice(notices.pending()); return; }
      if (!result.purchaseToken) return;
      // Paid: always finish with the server, even when the user closed the paywall meanwhile.
      const outcome = await verify({ purchaseToken: result.purchaseToken, productId: result.productId || plan.id });
      if (!alive.current) return;
      if (outcome.status) setNotice(outcome.status.active ? null : notices.rejected(null));
      else if (outcome.network) setNotice(notices.offlineAfterPay());
      else setNotice(notices.rejected(outcome.error));
    } finally {
      finishRun(mine, timer);
    }
  }, [client, slowMs, verify, finishRun, quietRestore]);

  const restore = useCallback(async () => {
    const s = statusRef.current;
    if (inFlight.current || !s || !s.enabled || !onlineRef.current) return;
    inFlight.current = true;
    const mine = ++gen.current;
    setBusy('restore');
    setNotice(null);
    try {
      const result = await restoreOwned();
      if (alive.current && gen.current === mine) setNotice(result);
    } finally {
      finishRun(mine, null);
    }
  }, [restoreOwned, finishRun]);

  // Opens Play's subscription screen. Resolves to null, or the notice to show where the button was.
  const manage = useCallback(async () => {
    try {
      await client.manage();
      manageOpened.current = true;
      return null;
    } catch (e) {
      const failed = clientNotice(e, 'manage');
      if (alive.current) setNotice(failed);
      return failed;
    }
  }, [client]);

  // Escape hatch for a purchase that never comes back (the Play sheet failed to open): clears the busy state here
  // only. The purchase call keeps running; if it does return a purchase, it is still verified. Grants nothing.
  const cancelBusy = useCallback(() => {
    if (!inFlight.current) return;
    gen.current += 1;
    inFlight.current = false;
    setBusy('');
    setSlow(false);
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  // Unfinished work picks up when the connection or the app comes back.
  const recheck = useCallback(async () => {
    if (rechecking.current || inFlight.current || !onlineRef.current || !statusRef.current || !statusRef.current.enabled) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    rechecking.current = true;
    try {
      if (pendingPurchase.current || unverified.current.length) {
        const result = await quietRestore();
        if (result && alive.current) setNotice(result);
      }
      if (manageOpened.current) {
        manageOpened.current = false;
        await refresh();
      }
    } finally {
      rechecking.current = false;
    }
  }, [quietRestore, refresh]);

  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) recheck();
    wasOnline.current = online;
  }, [online, recheck]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    let handle = null;
    let live = true;
    if (isNative()) {
      (async () => {
        try {
          const { App } = await import('@capacitor/app');
          const h = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) recheck(); });
          if (!live) { try { h.remove(); } catch (e) { /* ignore */ } } else handle = h;
        } catch (e) { /* resume checks are best effort */ }
      })();
    }
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (handle) { try { handle.remove(); } catch (e) { /* ignore */ } }
    };
  }, [recheck]);

  const enabled = !!(status && status.enabled);
  const active = !!(status && status.active);
  const value = useMemo(() => ({
    enabled,
    status,
    statusState,
    loading: !status && statusState === 'loading',
    checking,
    products,
    productsState,
    available,
    busy,
    slow,
    notice,
    error: notice && notice.kind === 'error' ? notice.text : null,
    online,
    hasPlan: hasStoredPlan(status),
    canPurchase: enabled && !active && available === true && online && !!(status && status.account_token) && !busy,
    access,
    checkAccess,
    loadProducts,
    buy,
    restore,
    refresh,
    retryStatus,
    manage,
    cancelBusy,
    clearNotice,
  }), [enabled, active, status, statusState, checking, products, productsState, available, busy, slow, notice, online,
    access, checkAccess, loadProducts, buy, restore, refresh, retryStatus, manage, cancelBusy, clearNotice]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
