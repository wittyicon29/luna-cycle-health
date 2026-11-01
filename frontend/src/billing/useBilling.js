import { createContext, useContext } from 'react';

// The billing context <BillingProvider> fills. Without a provider (screens rendered on their own, most tests) the
// hook returns billing switched off: no plan row, no paywall, AI opens as before.
export const BillingContext = createContext(null);

const none = () => Promise.resolve();

export const BILLING_OFF = Object.freeze({
  enabled: false,
  status: null,
  statusState: 'ready',
  loading: false,
  products: [],
  productsState: 'idle',
  available: null,
  busy: '',
  slow: false,
  notice: null,
  error: null,
  online: true,
  hasPlan: false,
  canPurchase: false,
  access: () => 'open',
  checkAccess: () => Promise.resolve('open'),
  loadProducts: none,
  buy: none,
  restore: none,
  refresh: none,
  retryStatus: none,
  manage: none,
  cancelBusy: () => {},
  clearNotice: () => {},
});

export default function useBilling() {
  return useContext(BillingContext) || BILLING_OFF;
}
