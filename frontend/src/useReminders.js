import { useEffect, useRef, useState } from 'react';
import { API } from './api';
import { isNative } from './platform';
import { getAccessToken } from './tokenStore';
import { localDateString } from './localDate';
import { anyEnabled } from './reminderPrefs';
import { cancelAllReminders, rebuildReminders } from './reminderScheduler';

const DEBOUNCE_MS = 500;
const safeRemove = h => { try { Promise.resolve(h.remove()).catch(() => {}); } catch (e) { /* already gone */ } };

// The API sends naive UTC timestamps (no offset); read those as UTC, not as local time.
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
const parseCreated = v => new Date(HAS_OFFSET.test(v) ? v : `${v}Z`);

function summarize(periods) {
  let lastPeriodStart = null;
  let newest = null;
  for (const p of periods || []) {
    if (p.start_date && (!lastPeriodStart || p.start_date > lastPeriodStart)) lastPeriodStart = p.start_date;
    const created = p.created_at ? parseCreated(p.created_at) : null;
    if (created && !Number.isNaN(created.getTime()) && (!newest || created > newest)) newest = created;
  }
  return { lastPeriodStart, lastLoggedOn: newest ? localDateString(newest) : null };
}

export function useReminders({ token, periods, prefs, appearance }) {
  const lastPrediction = useRef(null);
  const [resumeTick, setResumeTick] = useState(0);

  useEffect(() => {
    if (!isNative()) return undefined;
    let handle = null;
    let cancelled = false;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const h = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) setResumeTick(t => t + 1);
        });
        if (cancelled) safeRemove(h); else handle = h;
      } catch (e) { /* resume rebuilds are best effort */ }
    })();
    return () => { cancelled = true; if (handle) safeRemove(handle); };
  }, []);

  useEffect(() => {
    if (!isNative() || !token) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!getAccessToken()) return;
      if (!anyEnabled(prefs)) {
        await cancelAllReminders();
        return;
      }
      try { lastPrediction.current = await API.periods.prediction(token); } catch (e) { /* keep the last known prediction */ }
      if (cancelled || !getAccessToken()) return;
      await rebuildReminders({ prefs, prediction: lastPrediction.current, ...summarize(periods) });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token, periods, prefs, appearance, resumeTick]);
}
