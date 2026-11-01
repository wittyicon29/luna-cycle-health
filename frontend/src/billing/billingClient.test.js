// The native client talks to @capgo/native-purchases 7.19.3. The shapes below are the plugin's real Android
// output (NativePurchasesPlugin.java): one entry per subscription offer, `identifier` = base plan id,
// `planIdentifier` = subscription product id, price fields from the offer's first pricing phase, no
// subscriptionPeriod / introductoryPrice; rejections carry only a message (cancel = "Purchase is not purchased").
let mockImported = 0;
const mockPlugin = {
  isBillingSupported: jest.fn(),
  getProducts: jest.fn(),
  purchaseProduct: jest.fn(),
  getPurchases: jest.fn(),
  manageSubscriptions: jest.fn(),
  // The real plugin object is a Capacitor Proxy whose `then` throws on native.
  get then() { throw new Error('"NativePurchases.then()" is not implemented on android'); },
};

jest.mock('../platform', () => ({ isNative: jest.fn() }));
jest.mock('@capgo/native-purchases', () => {
  mockImported += 1;
  return { NativePurchases: mockPlugin };
});

const { isNative } = require('../platform');
const { setLanguage } = require('../i18n');
const hi = require('../i18n/catalogs/hi.json');
const { BillingError, getBillingClient, nativeClient, webClient } = require('./billingClient');
const { fakeClient } = require('./fakeClient');

const IDS = ['luna_ai_monthly', 'luna_ai_yearly'];

const androidOffer = (product, basePlan, extra = {}) => ({
  identifier: basePlan,
  planIdentifier: product,
  title: 'Luna AI (Luna Health)',
  description: 'AI insights and chat',
  price: 199,
  priceString: '₹199.00',
  currencyCode: 'INR',
  isFamilyShareable: false,
  offerToken: `offer-${product}-${basePlan}-${extra.offerId || 'base'}`,
  offerId: null,
  ...extra,
});

// Plugin rejections are CapacitorExceptions: message plus optional code.
const rejection = (message, code) => Object.assign(new Error(message), code ? { code } : {});

beforeEach(() => {
  isNative.mockReturnValue(true);
  mockPlugin.isBillingSupported.mockResolvedValue({ isBillingSupported: true });
  mockPlugin.getProducts.mockResolvedValue({ products: [] });
  mockPlugin.purchaseProduct.mockResolvedValue({});
  mockPlugin.getPurchases.mockResolvedValue({ purchases: [] });
  mockPlugin.manageSubscriptions.mockResolvedValue(undefined);
  setLanguage('en');
});

afterAll(() => setLanguage('en'));

describe('getBillingClient', () => {
  test('picks the native client on native and the web client elsewhere', () => {
    expect(getBillingClient()).toBe(nativeClient);
    isNative.mockReturnValue(false);
    expect(getBillingClient()).toBe(webClient);
  });
});

describe('web client', () => {
  test('is never available, every action throws BillingError(unavailable), and the plugin is never imported', async () => {
    isNative.mockReturnValue(false);
    const before = mockImported;
    const client = getBillingClient();

    await expect(client.isAvailable()).resolves.toBe(false);
    for (const call of [
      () => client.getProducts(IDS),
      () => client.purchase({ id: 'luna_ai_monthly', planId: 'monthly' }, 'acct'),
      () => client.restore(),
      () => client.manage(),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const error = await call().catch(e => e);
      expect(error).toBeInstanceOf(BillingError);
      expect(error.code).toBe('unavailable');
    }
    expect(mockImported).toBe(before);
    expect(mockImported).toBe(0);
  });

  test('loading the module does not import the plugin', () => {
    jest.isolateModules(() => {
      const before = mockImported;
      require('./billingClient');
      expect(mockImported).toBe(before);
    });
  });

  test('the native client on a non-native platform is unavailable without importing the plugin', async () => {
    isNative.mockReturnValue(false);

    await expect(nativeClient.isAvailable()).resolves.toBe(false);

    // Runs before any native test in this file, so the plugin module has never been required.
    expect(mockImported).toBe(0);
  });
});

describe('native client: availability', () => {
  test('true only when Play Billing is supported', async () => {
    await expect(nativeClient.isAvailable()).resolves.toBe(true);
    mockPlugin.isBillingSupported.mockResolvedValue({ isBillingSupported: false });
    await expect(nativeClient.isAvailable()).resolves.toBe(false);
    mockPlugin.isBillingSupported.mockRejectedValue(rejection('boom'));
    await expect(nativeClient.isAvailable()).resolves.toBe(false);
  });
});

describe('native client: products', () => {
  test('queries subscriptions and maps Android offers to plans, product id first', async () => {
    mockPlugin.getProducts.mockResolvedValue({
      products: [
        androidOffer('luna_ai_yearly', 'yearly', { price: 1499, priceString: '₹1,499.00' }),
        androidOffer('luna_ai_monthly', 'monthly'),
      ],
    });

    const plans = await nativeClient.getProducts(IDS);

    expect(mockPlugin.getProducts).toHaveBeenCalledWith({ productIdentifiers: IDS, productType: 'subs' });
    expect(plans).toEqual([
      {
        id: 'luna_ai_monthly',
        planId: 'monthly',
        title: 'Luna AI (Luna Health)',
        priceString: '₹199.00',
        price: 199,
        currencyCode: 'INR',
        period: { unit: 'month', count: 1 },
        periodLabel: 'month',
        trial: null,
        offerToken: 'offer-luna_ai_monthly-monthly-base',
      },
      expect.objectContaining({ id: 'luna_ai_yearly', planId: 'yearly', priceString: '₹1,499.00', period: { unit: 'year', count: 1 }, periodLabel: 'year', trial: null }),
    ]);
  });

  test('a free-trial offer becomes the trial line of its base plan and never replaces the base price', async () => {
    mockPlugin.getProducts.mockResolvedValue({
      products: [
        androidOffer('luna_ai_monthly', 'monthly', { offerId: 'free-trial', price: 0, priceString: 'Free' }),
        androidOffer('luna_ai_monthly', 'monthly'),
      ],
    });

    const [plan, ...rest] = await nativeClient.getProducts(IDS);

    expect(rest).toEqual([]);
    expect(plan.priceString).toBe('₹199.00');
    expect(plan.offerToken).toBe('offer-luna_ai_monthly-monthly-base');
    expect(plan.trial).toEqual({ text: 'Free trial available' });
  });

  test('a paid intro offer is not shown as a trial and an offer without its base plan is dropped', async () => {
    mockPlugin.getProducts.mockResolvedValue({
      products: [
        androidOffer('luna_ai_monthly', 'monthly', { offerId: 'intro', price: 99, priceString: '₹99.00' }),
        androidOffer('luna_ai_monthly', 'monthly'),
        androidOffer('luna_ai_yearly', 'yearly', { offerId: 'free-trial', price: 0, priceString: 'Free' }),
      ],
    });

    const plans = await nativeClient.getProducts(IDS);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'luna_ai_monthly', priceString: '₹199.00', trial: null });
  });

  test('ignores products the server did not offer', async () => {
    mockPlugin.getProducts.mockResolvedValue({ products: [androidOffer('someone_else', 'monthly'), androidOffer('luna_ai_monthly', 'monthly')] });

    const plans = await nativeClient.getProducts(IDS);

    expect(plans.map(p => p.id)).toEqual(['luna_ai_monthly']);
  });

  test('period labels from base plan ids, localised, and null when unknown', async () => {
    mockPlugin.getProducts.mockResolvedValue({
      products: [
        androidOffer('luna_ai_monthly', 'p1m'),
        androidOffer('luna_ai_monthly', 'three-months'),
        androidOffer('luna_ai_yearly', 'annual'),
        androidOffer('luna_ai_yearly', 'weekly'),
        androidOffer('luna_ai_yearly', 'base'),
      ],
    });
    setLanguage('hi');

    const plans = await nativeClient.getProducts(IDS);
    const byPlan = Object.fromEntries(plans.map(p => [p.planId, p]));

    expect(byPlan.p1m.period).toEqual({ unit: 'month', count: 1 });
    expect(byPlan.p1m.periodLabel).toBe(hi.month);
    expect(byPlan['three-months'].period).toEqual({ unit: 'month', count: 3 });
    expect(byPlan['three-months'].periodLabel).toBe('3 महीने');
    expect(byPlan.annual.periodLabel).toBe(hi.year);
    expect(byPlan.weekly.periodLabel).toBe(hi.week);
    expect(byPlan.base.period).toBeNull();
    expect(byPlan.base.periodLabel).toBeNull();
  });

  test('uses subscriptionPeriod and introductoryPrice when the plugin provides them', async () => {
    mockPlugin.getProducts.mockResolvedValue({
      products: [
        {
          identifier: 'luna_ai_monthly',
          title: 'Luna AI',
          price: 199,
          priceString: '₹199.00',
          currencyCode: 'INR',
          subscriptionPeriod: { numberOfUnits: 1, unit: 2 },
          introductoryPrice: { price: 0, priceString: 'Free', paymentMode: 2, numberOfPeriods: 1, subscriptionPeriod: { numberOfUnits: 7, unit: 0 } },
        },
        {
          identifier: 'luna_ai_yearly',
          title: 'Luna AI',
          price: 1499,
          priceString: '₹1,499.00',
          currencyCode: 'INR',
          subscriptionPeriod: { numberOfUnits: 1, unit: 3 },
          introductoryPrice: null,
        },
      ],
    });

    const [monthly, yearly] = await nativeClient.getProducts(IDS);

    expect(monthly).toMatchObject({ id: 'luna_ai_monthly', planId: undefined, periodLabel: 'month', trial: { text: '7-day free trial' } });
    expect(yearly).toMatchObject({ id: 'luna_ai_yearly', periodLabel: 'year', trial: null });
  });

  test('plugin failures become BillingError', async () => {
    mockPlugin.getProducts.mockRejectedValue(rejection('Product not found'));
    await expect(nativeClient.getProducts(IDS)).rejects.toMatchObject({ name: 'BillingError', code: 'unavailable' });

    // Capacitor's reject(msg, code) puts BILLING_SETUP_FAILED in the message and the text in the code.
    mockPlugin.getProducts.mockRejectedValue(rejection('BILLING_SETUP_FAILED', 'Billing service unavailable. Please check your internet connection and Google Play Services.'));
    await expect(nativeClient.getProducts(IDS)).rejects.toMatchObject({ code: 'network' });

    mockPlugin.getProducts.mockRejectedValue(rejection('BILLING_SETUP_FAILED', 'Billing is not available on this device.'));
    await expect(nativeClient.getProducts(IDS)).rejects.toMatchObject({ code: 'unavailable' });

    mockPlugin.getProducts.mockRejectedValue(rejection('something odd'));
    await expect(nativeClient.getProducts(IDS)).rejects.toMatchObject({ code: 'failed' });
  });

  test('an empty id list asks nothing', async () => {
    await expect(nativeClient.getProducts([])).resolves.toEqual([]);
    expect(mockPlugin.getProducts).not.toHaveBeenCalled();
  });
});

describe('native client: purchase', () => {
  const plan = { id: 'luna_ai_monthly', planId: 'monthly', offerToken: 'offer-x' };

  test('passes the account token, subs type, base plan and never auto-acknowledges', async () => {
    mockPlugin.purchaseProduct.mockResolvedValue({ purchaseToken: 'ptok', productIdentifier: 'luna_ai_monthly', purchaseState: '1', isAcknowledged: false });

    const result = await nativeClient.purchase(plan, 'acct-token');

    expect(mockPlugin.purchaseProduct).toHaveBeenCalledTimes(1);
    expect(mockPlugin.purchaseProduct.mock.calls[0][0]).toEqual({
      productIdentifier: 'luna_ai_monthly',
      planIdentifier: 'monthly',
      productType: 'subs',
      appAccountToken: 'acct-token',
      autoAcknowledgePurchases: false,
      isConsumable: false,
    });
    expect(result).toEqual({ purchaseToken: 'ptok', productId: 'luna_ai_monthly' });
  });

  test('refuses to start without an account token', async () => {
    await expect(nativeClient.purchase(plan, '')).rejects.toMatchObject({ code: 'failed' });
    await expect(nativeClient.purchase(plan, undefined)).rejects.toMatchObject({ code: 'failed' });
    expect(mockPlugin.purchaseProduct).not.toHaveBeenCalled();
  });

  test('user cancel is { cancelled: true }', async () => {
    mockPlugin.purchaseProduct.mockRejectedValue(rejection('Purchase is not purchased'));
    await expect(nativeClient.purchase(plan, 'acct')).resolves.toEqual({ cancelled: true });
    mockPlugin.purchaseProduct.mockRejectedValue(rejection('User cancelled the purchase'));
    await expect(nativeClient.purchase(plan, 'acct')).resolves.toEqual({ cancelled: true });
  });

  test('a pending payment is { pending: true }', async () => {
    mockPlugin.purchaseProduct.mockRejectedValue(rejection('Purchase is pending'));
    await expect(nativeClient.purchase(plan, 'acct')).resolves.toEqual({ pending: true });
    mockPlugin.purchaseProduct.mockResolvedValue({ purchaseToken: 'ptok', productIdentifier: 'luna_ai_monthly', purchaseState: '2' });
    await expect(nativeClient.purchase(plan, 'acct')).resolves.toEqual({ pending: true });
  });

  test('other failures are typed BillingErrors without the plugin text', async () => {
    mockPlugin.purchaseProduct.mockRejectedValue(rejection('BILLING_SETUP_FAILED', 'Billing service disconnected. Please try again.'));
    const network = await nativeClient.purchase(plan, 'acct').catch(e => e);
    expect(network).toBeInstanceOf(BillingError);
    expect(network.code).toBe('network');
    expect(network.message).not.toMatch(/disconnected/);

    mockPlugin.purchaseProduct.mockRejectedValue(rejection('Product not found'));
    await expect(nativeClient.purchase(plan, 'acct')).rejects.toMatchObject({ code: 'unavailable' });

    mockPlugin.purchaseProduct.mockRejectedValue(rejection('planIdentifier cannot be empty if productType is subs'));
    await expect(nativeClient.purchase(plan, 'acct')).rejects.toMatchObject({ code: 'failed' });

    mockPlugin.purchaseProduct.mockResolvedValue({ productIdentifier: 'luna_ai_monthly' });
    await expect(nativeClient.purchase(plan, 'acct')).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('native client: restore and manage', () => {
  test('restore returns owned, completed subscriptions only', async () => {
    mockPlugin.getPurchases.mockResolvedValue({
      purchases: [
        { purchaseToken: 'a', productIdentifier: 'luna_ai_monthly', purchaseState: '1', productType: 'subs' },
        { purchaseToken: 'b', productIdentifier: 'luna_ai_yearly', purchaseState: '2', productType: 'subs' },
        { productIdentifier: 'luna_ai_yearly', purchaseState: '1', productType: 'subs' },
        { purchaseToken: 'c', productIdentifier: 'luna_ai_yearly', purchaseState: '1', productType: 'subs', isAcknowledged: false },
      ],
    });

    const owned = await nativeClient.restore();

    expect(mockPlugin.getPurchases).toHaveBeenCalledWith({ productType: 'subs' });
    expect(owned).toEqual([
      { purchaseToken: 'a', productId: 'luna_ai_monthly' },
      { purchaseToken: 'c', productId: 'luna_ai_yearly' },
    ]);
  });

  test('restore failures are BillingErrors', async () => {
    mockPlugin.getPurchases.mockRejectedValue(rejection('BILLING_SETUP_FAILED', 'Billing is not available on this device.'));
    await expect(nativeClient.restore()).rejects.toMatchObject({ name: 'BillingError', code: 'unavailable' });
  });

  test('manage opens the Play subscription page; failures are BillingError(unavailable)', async () => {
    await expect(nativeClient.manage()).resolves.toBeUndefined();
    expect(mockPlugin.manageSubscriptions).toHaveBeenCalledTimes(1);
    mockPlugin.manageSubscriptions.mockRejectedValue(rejection('Failed to open subscription management page'));
    await expect(nativeClient.manage()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('native client: plugin hygiene', () => {
  test('never resolves an async function with the plugin proxy (then() throws) and serialises plugin calls', async () => {
    let releaseFirst;
    mockPlugin.getProducts.mockImplementation(() => new Promise(resolve => { releaseFirst = () => resolve({ products: [] }); }));
    mockPlugin.getPurchases.mockResolvedValue({ purchases: [] });

    const first = nativeClient.getProducts(IDS);
    const second = nativeClient.restore();
    await new Promise(r => setTimeout(r, 0));

    // The plugin keeps one pending call and one BillingClient: the second call waits for the first.
    expect(mockPlugin.getPurchases).not.toHaveBeenCalled();
    releaseFirst();
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    expect(mockPlugin.getPurchases).toHaveBeenCalledTimes(1);
  });
});

describe('native client: a plugin call that never settles', () => {
  test('holds the queue for at most STUCK_CALL_MS', async () => {
    const { STUCK_CALL_MS } = require('./billingClient');
    jest.useFakeTimers();
    try {
      mockPlugin.purchaseProduct.mockImplementation(() => new Promise(() => {}));
      mockPlugin.getPurchases.mockResolvedValue({ purchases: [] });

      nativeClient.purchase({ id: 'luna_ai_monthly', planId: 'monthly' }, 'acct');
      const restored = nativeClient.restore();
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }; // eslint-disable-line no-await-in-loop
      await flush();
      jest.advanceTimersByTime(STUCK_CALL_MS - 1000);
      await flush();
      expect(mockPlugin.purchaseProduct).toHaveBeenCalledTimes(1);
      expect(mockPlugin.getPurchases).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2000);
      await flush();

      await expect(restored).resolves.toEqual([]);
      expect(mockPlugin.getPurchases).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('fake client', () => {
  test('implements the interface for tests', async () => {
    const plans = [{ id: 'luna_ai_monthly', planId: 'monthly', title: 'Luna AI', priceString: '₹199.00', price: 199, currencyCode: 'INR', periodLabel: 'month', trial: null }];
    const client = fakeClient({ products: plans, purchases: [{ purchaseToken: 'old', productId: 'luna_ai_monthly' }] });

    await expect(client.isAvailable()).resolves.toBe(true);
    await expect(client.getProducts(IDS)).resolves.toEqual(plans);
    await expect(client.purchase(plans[0], 'acct')).resolves.toEqual({ purchaseToken: 'fake-token-1', productId: 'luna_ai_monthly' });
    await expect(client.restore()).resolves.toEqual([{ purchaseToken: 'old', productId: 'luna_ai_monthly' }]);
    await client.manage();
    expect(client.calls.purchase).toEqual([{ plan: plans[0], accountToken: 'acct' }]);
    expect(client.calls.manage).toBe(1);
  });

  test('scripted outcomes and failures', async () => {
    const client = fakeClient({ available: false, purchase: [{ cancelled: true }, { pending: true }, new BillingError('network')] });

    await expect(client.isAvailable()).resolves.toBe(false);
    await expect(client.purchase({ id: 'x' }, 'acct')).resolves.toEqual({ cancelled: true });
    await expect(client.purchase({ id: 'x' }, 'acct')).resolves.toEqual({ pending: true });
    await expect(client.purchase({ id: 'x' }, 'acct')).rejects.toMatchObject({ code: 'network' });
  });
});
