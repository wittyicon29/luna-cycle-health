import { useEffect, useMemo, useRef } from 'react';
import { createOffline } from './index';
import { clearOthers } from './store';
import { isNative } from '../platform';
import { getAccessToken } from '../tokenStore';
import { OfflineContext, toContextValue } from './useOffline';

const safeRemove = h => { try { Promise.resolve(h.remove()).catch(() => {}); } catch (e) { /* already gone */ } };

// One offline facade per signed-in session (`email`). Starts sync while mounted, forces a sync when the app comes back
// to the foreground, drops other users' cached data at sign-in, and registers { pendingSummary, wipe } with the app
// root (`onRegister`) so sign-out can ask about unsynced changes and wipe the cache.
// Any wipe retires this facade; the root signs the user out right after, which unmounts the provider.
export default function OfflineProvider({ email, token, onRegister, children }) {
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Created lazily and kept per email: re-renders (and StrictMode's second render) reuse it.
  const slot = useRef(null);
  if (!slot.current || slot.current.email !== email) {
    slot.current = { email, offline: createOffline({ email, getToken: () => getAccessToken() || tokenRef.current }) };
  }
  const { offline } = slot.current;
  const value = useMemo(() => toContextValue(offline), [offline]);

  const cleared = useRef(null);
  useEffect(() => {
    if (cleared.current === email) return;
    cleared.current = email;
    clearOthers(email).catch(() => {});
  }, [email]);

  useEffect(() => {
    offline.startSync();
    // A queue left by an earlier session of this user (e.g. after the session expired) is replayed right away.
    offline.sync.syncNow({ force: true }).catch(() => {});

    let handle = null;
    let cancelled = false;
    if (isNative()) {
      (async () => {
        try {
          const { App } = await import('@capacitor/app');
          const h = await App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) offline.sync.syncNow({ force: true }).catch(() => {});
          });
          if (cancelled) safeRemove(h); else handle = h;
        } catch (e) { /* resume sync is best effort; the timer and online events still run */ }
      })();
    }
    return () => {
      cancelled = true;
      if (handle) safeRemove(handle);
      handle = null;
      offline.stopSync();
    };
  }, [offline]);

  useEffect(() => {
    if (typeof onRegister !== 'function') return undefined;
    const api = { pendingSummary: value.pendingSummary, wipe: value.wipe };
    const unregister = onRegister(api);
    return () => { if (typeof unregister === 'function') unregister(); };
  }, [onRegister, value]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
