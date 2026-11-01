import { isNative } from '../platform';
import { t, tn } from '../i18n';

// A thin client over Google Play Billing (@capgo/native-purchases 7.19.3, pinned).
//
// Interface (nativeClient, webClient and fakeClient all implement it):
//   isAvailable(): Promise<boolean>
//   getProducts(ids): Promise<Plan[]>
//     Plan = { id, planId?, title, priceString, price, currencyCode, period: { unit, count } | null,
//              periodLabel: string | null, trial: { text } | null, offerToken? }
//   purchase(plan, accountToken): Promise<{ purchaseToken, productId } | { cancelled: true } | { pending: true }>
//   restore(): Promise<Array<{ purchaseToken, productId }>>
//   manage(): Promise<void>
// Failures are BillingError with code 'unavailable' | 'network' | 'failed'. Nothing here grants access: the
// server verifies (and acknowledges) every purchase. Purchase tokens are never logged or stored here.

export class BillingError extends Error {
  constructor(code) {
    super(`Billing ${code}`);
    this.name = 'BillingError';
    this.code = code;
  }
}

const SUBS = 'subs';

// --- periods and trials ---------------------------------------------------------------------------

// StoreKit-style SubscriptionPeriod.unit values (the plugin's Product type).
const UNIT_BY_NUMBER = ['day', 'week', 'month', 'year'];
const UNIT_WORDS = {
  day: 'day', days: 'day', daily: 'day',
  week: 'week', weeks: 'week', weekly: 'week',
  month: 'month', months: 'month', monthly: 'month',
  year: 'year', years: 'year', yearly: 'year', annual: 'year', annually: 'year',
};
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12 };
const LETTER_UNITS = { d: 'day', w: 'week', m: 'month', y: 'year' };

function fromSubscriptionPeriod(sp) {
  if (!sp || typeof sp !== 'object') return null;
  const unit = UNIT_BY_NUMBER[sp.unit];
  const count = Number(sp.numberOfUnits);
  return unit && Number.isInteger(count) && count > 0 ? { unit, count } : null;
}

// Android's product details (as this plugin returns them) carry no billing period, so it is read from the
// Play base plan id (or the product id): "monthly", "yearly", "annual", "p1m", "1y", "3-months", "quarterly".
function fromIdentifier(id) {
  const tokens = String(id || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'quarterly') return { unit: 'month', count: 3 };
    const letters = /^p?(\d+)([dwmy])$/.exec(token);
    if (letters) return { unit: LETTER_UNITS[letters[2]], count: Number(letters[1]) || 1 };
    const unit = UNIT_WORDS[token];
    if (unit) {
      const prev = tokens[i - 1];
      const count = prev && (/^\d+$/.test(prev) ? Number(prev) : NUMBER_WORDS[prev]);
      return { unit, count: count > 0 ? count : 1 };
    }
  }
  return null;
}

function periodLabel(period) {
  if (!period) return null;
  const { unit, count } = period;
  if (count === 1) {
    if (unit === 'day') return t('day');
    if (unit === 'week') return t('week');
    if (unit === 'month') return t('month');
    return t('year');
  }
  if (unit === 'day') return tn(count, '{count} day', '{count} days');
  if (unit === 'week') return tn(count, '{count} week', '{count} weeks');
  if (unit === 'month') return tn(count, '{count} month', '{count} months');
  return tn(count, '{count} year', '{count} years');
}

function trialText(length) {
  if (!length) return t('Free trial available');
  const { unit, count } = length;
  if (unit === 'day') return t('{count}-day free trial', { count });
  if (unit === 'week') return t('{count}-week free trial', { count });
  if (unit === 'month') return t('{count}-month free trial', { count });
  return t('{count}-year free trial', { count });
}

// SKProductDiscount: paymentMode 2 is a free trial.
function trialFromIntro(intro) {
  if (!intro || typeof intro !== 'object' || !(intro.paymentMode === 2 || intro.price === 0)) return null;
  const sp = fromSubscriptionPeriod(intro.subscriptionPeriod);
  const periods = Number(intro.numberOfPeriods) > 0 ? Number(intro.numberOfPeriods) : 1;
  return { text: trialText(sp ? { unit: sp.unit, count: sp.count * periods } : null) };
}

// --- product mapping ------------------------------------------------------------------------------

// The plugin returns one Android entry per subscription offer: the base plan (offerId null, price = the
// recurring price) plus each developer offer (a free trial's first phase is price 0, "Free"). Entries are grouped
// per product + base plan. purchaseProduct buys the FIRST Play offer of the base plan, in the same order as these
// entries, so the first entry decides what the paywall may show:
//   base plan first   -> its price, no trial line (Play will not apply a later free offer);
//   free offer first  -> "Free trial available" plus the base plan's regular price;
//   paid offer first  -> dropped: Play would charge an intro price this paywall does not show.
export function toPlans(products, ids) {
  const wanted = new Set(ids);
  const groups = new Map();
  (Array.isArray(products) ? products : []).forEach(raw => {
    if (!raw || typeof raw !== 'object') return;
    const id = raw.planIdentifier || raw.identifier;
    if (!wanted.has(id)) return;
    const planId = raw.planIdentifier ? raw.identifier : undefined;
    const key = `${id}\u0000${planId || ''}`;
    if (!groups.has(key)) groups.set(key, { id, planId, first: raw, base: null });
    const group = groups.get(key);
    if (!raw.offerId && !group.base) group.base = raw;
  });

  const plans = [];
  groups.forEach(({ id, planId, first, base }) => {
    if (!base) return; // an offer without its base plan has no recurring price to show
    const freeFirst = !!first.offerId && first.price === 0;
    if (first.offerId && !freeFirst) return; // a paid intro offer would be charged first
    const freeOffer = freeFirst;
    // Android: the base plan id only (one product can hold base plans of different lengths, so the product
    // id is no guide). Other stores: the product id.
    const period = fromSubscriptionPeriod(base.subscriptionPeriod) || fromIdentifier(planId !== undefined ? planId : id);
    const trial = trialFromIntro(base.introductoryPrice) || (freeOffer ? { text: trialText(null) } : null);
    const plan = {
      id,
      planId,
      title: base.title,
      priceString: base.priceString,
      price: base.price,
      currencyCode: base.currencyCode,
      period,
      periodLabel: periodLabel(period),
      trial,
    };
    if (base.offerToken) plan.offerToken = base.offerToken;
    plans.push(plan);
  });
  const order = id => ids.indexOf(id);
  return plans.sort((a, b) => order(a.id) - order(b.id));
}

// --- errors ---------------------------------------------------------------------------------------

// Plugin rejections are message-only (Capacitor's reject(msg, code) sometimes swaps the two), so both are read.
// User cancel and every other non-OK Play response arrive as "Purchase is not purchased".
function classify(error) {
  const text = `${(error && error.message) || ''} ${(error && error.code) || ''}`;
  if (/pending/i.test(text)) return 'pending';
  if (/not purchased|cancel/i.test(text)) return 'cancelled';
  if (/internet|disconnected|network|timed? ?out/i.test(text)) return 'network';
  if (/BILLING_SETUP_FAILED|not available|not supported|unavailable|product not found|no subscription offers|no pricing phases|not implemented/i.test(text)) {
    return 'unavailable';
  }
  return 'failed';
}

const toBillingError = error => {
  if (error instanceof BillingError) return error;
  const kind = classify(error);
  return new BillingError(kind === 'network' || kind === 'unavailable' ? kind : 'failed');
};

// --- native client --------------------------------------------------------------------------------

let pluginPromise = null;

// The plugin object is a Capacitor Proxy whose `then` throws on native. Never resolve a promise with it:
// return plain wrapper functions instead (as tokenStore.js does). Imported only on first use, on native.
function loadPlugin() {
  if (!pluginPromise) {
    pluginPromise = import('@capgo/native-purchases').then(({ NativePurchases: plugin }) => ({
      isBillingSupported: () => plugin.isBillingSupported(),
      getProducts: options => plugin.getProducts(options),
      purchaseProduct: options => plugin.purchaseProduct(options),
      getPurchases: options => plugin.getPurchases(options),
      manageSubscriptions: () => plugin.manageSubscriptions(),
    }));
    pluginPromise.catch(() => { pluginPromise = null; });
  }
  return pluginPromise;
}

// The plugin keeps a single BillingClient and pending call: a new call closes the previous one. Run one at a time.
// A plugin call that never settles (the plugin ignores a failed launchBillingFlow result) holds the queue for at
// most STUCK_CALL_MS, so later calls (restore, products) are not blocked for the rest of the session.
export const STUCK_CALL_MS = 120000;
let chain = Promise.resolve();
function serial(task) {
  const run = chain.then(task, task);
  let timer;
  const released = new Promise(resolve => { timer = setTimeout(resolve, STUCK_CALL_MS); });
  chain = Promise.race([run.catch(() => {}), released]).then(() => clearTimeout(timer));
  return run;
}

// Runs `task(plugin)` on native only, one at a time; failures to load the plugin are 'unavailable'.
function withPlugin(task) {
  if (!isNative()) return Promise.reject(new BillingError('unavailable'));
  return serial(async () => {
    let plugin;
    try {
      plugin = await loadPlugin();
    } catch (e) {
      throw new BillingError('unavailable');
    }
    return task(plugin);
  });
}

export const nativeClient = {
  async isAvailable() {
    if (!isNative()) return false;
    try {
      return await withPlugin(async plugin => {
        const result = await plugin.isBillingSupported();
        return !!(result && result.isBillingSupported === true);
      });
    } catch (e) {
      return false;
    }
  },

  getProducts(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id);
    if (!list.length) return Promise.resolve([]);
    return withPlugin(async plugin => {
      try {
        const result = await plugin.getProducts({ productIdentifiers: list, productType: SUBS });
        return toPlans(result && result.products, list);
      } catch (e) {
        throw toBillingError(e);
      }
    });
  },

  // The plugin's purchaseProduct has no offer-token option: it buys the first Play offer of `planIdentifier`
  // (the base plan). appAccountToken binds the purchase to this account; the server acknowledges.
  purchase(plan, accountToken) {
    if (!plan || !plan.id || typeof accountToken !== 'string' || !accountToken) {
      return Promise.reject(new BillingError('failed'));
    }
    return withPlugin(async plugin => {
      let tx;
      try {
        tx = await plugin.purchaseProduct({
          productIdentifier: plan.id,
          planIdentifier: plan.planId,
          productType: SUBS,
          appAccountToken: accountToken,
          autoAcknowledgePurchases: false,
          isConsumable: false,
        });
      } catch (e) {
        const kind = classify(e);
        if (kind === 'cancelled') return { cancelled: true };
        if (kind === 'pending') return { pending: true };
        throw toBillingError(e);
      }
      if (tx && tx.purchaseState !== undefined && tx.purchaseState !== null && String(tx.purchaseState) !== '1') {
        return { pending: true };
      }
      if (!tx || typeof tx.purchaseToken !== 'string' || !tx.purchaseToken) throw new BillingError('failed');
      return { purchaseToken: tx.purchaseToken, productId: tx.productIdentifier || plan.id };
    });
  },

  // Subscriptions this Play account currently owns and has paid for (pending payments are left out).
  restore() {
    return withPlugin(async plugin => {
      let result;
      try {
        result = await plugin.getPurchases({ productType: SUBS });
      } catch (e) {
        throw toBillingError(e);
      }
      const purchases = result && Array.isArray(result.purchases) ? result.purchases : [];
      return purchases
        .filter(p => p && typeof p.purchaseToken === 'string' && p.purchaseToken && p.productIdentifier)
        .filter(p => p.purchaseState === undefined || p.purchaseState === null || String(p.purchaseState) === '1')
        .map(p => ({ purchaseToken: p.purchaseToken, productId: p.productIdentifier }));
    });
  },

  manage() {
    return withPlugin(async plugin => {
      try {
        await plugin.manageSubscriptions();
      } catch (e) {
        throw new BillingError('unavailable');
      }
    });
  },
};

// --- web client -----------------------------------------------------------------------------------

const unavailable = () => Promise.reject(new BillingError('unavailable'));

// Web builds never sell: the plan is bought in the Android app.
export const webClient = {
  isAvailable: () => Promise.resolve(false),
  getProducts: unavailable,
  purchase: unavailable,
  restore: unavailable,
  manage: unavailable,
};

export const getBillingClient = () => (isNative() ? nativeClient : webClient);
