import React from 'react';
import { createStatus } from '../status';
import { OfflineContext, toContextValue, passThroughData } from '../useOffline';

// A live status store for UI tests: render inside <Provider> and drive `internal`.
export function makeHarness() {
  const { status, internal } = createStatus();
  const value = toContextValue({ data: passThroughData, status, sync: { syncNow: async () => ({}) }, wipe: async () => {}, pendingSummary: async () => ({ count: 0 }) });
  const Provider = ({ children }) => <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
  return { status, internal, Provider };
}
