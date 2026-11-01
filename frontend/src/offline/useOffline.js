import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { createOffline } from './index';

// Hooks for the per-session offline facade that <OfflineProvider> creates. Without a provider (web screens rendered
// on their own, every existing test) they return one module-level pass-through facade: plain `API` calls, a fixed
// "online, nothing pending" status, and no storage at all.
export const OfflineContext = createContext(null);

// Built with an empty email, so createOffline() takes its web/pass-through path on every platform.
const passThrough = createOffline({ email: '' });
export const passThroughData = passThrough.data;

export function toContextValue(offline) {
  return {
    data: offline.data,
    status: offline.status,
    acknowledge: () => offline.status.acknowledge(),
    syncNow: opts => offline.sync.syncNow(opts),
    wipe: () => offline.wipe(),
    pendingSummary: () => offline.pendingSummary(),
  };
}

const PASS_VALUE = toContextValue(passThrough);

export function useOffline() {
  const ctx = useContext(OfflineContext) || PASS_VALUE;
  const { status: store } = ctx;
  const status = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => ({
    data: ctx.data,
    status,
    acknowledge: ctx.acknowledge,
    syncNow: ctx.syncNow,
    wipe: ctx.wipe,
    pendingSummary: ctx.pendingSummary,
  }), [ctx, status]);
}

export function useOfflineData() {
  return (useContext(OfflineContext) || PASS_VALUE).data;
}
