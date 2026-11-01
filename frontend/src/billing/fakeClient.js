// A scriptable billingClient for tests. Never imported by production code.
//
// fakeClient({ available, products, purchases, purchase, restore, manage })
//   available  boolean (default true)
//   products   Plan[] returned by getProducts (filtered to the requested ids), or an Error to throw
//   purchases  owned purchases returned by restore(), or an Error to throw
//   purchase   outcome(s) for purchase(): a result object, an Error (thrown), a function (plan, accountToken)
//              => result, or an array of those consumed in order. Default: a new fake token for the plan.
//   manage     an Error to throw from manage()
// `calls` records what the code under test asked for.
const settle = value => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));

export function fakeClient({ available = true, products = [], purchases = [], purchase, manage } = {}) {
  const outcomes = Array.isArray(purchase) ? [...purchase] : null;
  let counter = 0;
  const calls = { isAvailable: 0, getProducts: [], purchase: [], restore: 0, manage: 0 };

  return {
    calls,
    isAvailable() {
      calls.isAvailable += 1;
      return Promise.resolve(available);
    },
    getProducts(ids) {
      calls.getProducts.push(ids);
      if (products instanceof Error) return Promise.reject(products);
      const wanted = new Set(ids);
      return Promise.resolve(products.filter(p => wanted.has(p.id)));
    },
    purchase(plan, accountToken) {
      calls.purchase.push({ plan, accountToken });
      let outcome = outcomes ? outcomes.shift() : purchase;
      if (typeof outcome === 'function') {
        try { outcome = outcome(plan, accountToken); } catch (e) { return Promise.reject(e); }
      }
      if (outcome === undefined) {
        counter += 1;
        outcome = { purchaseToken: `fake-token-${counter}`, productId: plan.id };
      }
      return settle(outcome);
    },
    restore() {
      calls.restore += 1;
      return settle(purchases instanceof Error ? purchases : [...purchases]);
    },
    manage() {
      calls.manage += 1;
      return manage instanceof Error ? Promise.reject(manage) : Promise.resolve();
    },
  };
}
