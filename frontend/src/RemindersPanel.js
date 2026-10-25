import React, { useEffect, useRef, useState } from 'react';
import { isNative } from './platform';
import { getReminderPermission, requestReminderPermission } from './reminderScheduler';

const section = { display: 'flex', flexDirection: 'column', gap: '.45rem' };
const title = { fontFamily: "'Cormorant Garamond', serif", fontSize: '1.05rem', color: '#E8A09A', marginBottom: '.3rem' };
const row = { display: 'flex', alignItems: 'center', gap: '.6rem', minHeight: 44, fontSize: '.85rem', cursor: 'pointer' };
const box = { width: 20, height: 20, flexShrink: 0 };
const field = { minHeight: 44, minWidth: 44 };
const note = { fontSize: '.7rem', color: 'var(--muted)' };
const DENIED =
  'Notifications are turned off for Luna. Turn them on in Android Settings → Apps → Luna → Notifications, then try again.';

const safeRemove = h => { try { Promise.resolve(h.remove()).catch(() => {}); } catch (e) { /* already gone */ } };
const WARN =
  "Notifications are turned off for Luna, so these reminders won't appear. Turn them on in Android Settings → Apps → Luna → Notifications.";

export default function RemindersPanel({ prefs, onChange }) {
  const [permission, setPermission] = useState(null);
  const [message, setMessage] = useState('');
  const native = isNative();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const busy = useRef(false);

  useEffect(() => {
    if (!native) return undefined;
    let live = true;
    const refresh = () => getReminderPermission().then(p => { if (live) setPermission(p); }).catch(() => {});
    refresh();
    let handle = null;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const h = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh(); });
        if (!live) safeRemove(h); else handle = h;
      } catch (e) { /* resume refresh is best effort */ }
    })();
    return () => { live = false; if (handle) safeRemove(handle); };
  }, [native]);

  if (!native || !prefs) return null;

  async function toggle(kind) {
    setMessage('');
    if (prefs[kind].enabled) {
      const cur = prefsRef.current;
      onChange({ ...cur, [kind]: { ...cur[kind], enabled: false } });
      return;
    }
    if (busy.current) return;
    busy.current = true;
    try {
      let current = await getReminderPermission();
      if (current !== 'granted') current = await requestReminderPermission();
      setPermission(current);
      if (current !== 'granted') {
        setMessage(DENIED);
        return;
      }
      const cur = prefsRef.current;
      onChange({ ...cur, [kind]: { ...cur[kind], enabled: true } });
    } finally {
      busy.current = false;
    }
  }

  const setField = (kind, patch) => onChange({ ...prefs, [kind]: { ...prefs[kind], ...patch } });
  const anyOn = prefs.periodExpected.enabled || prefs.dailyLog.enabled || prefs.lateCheckIn.enabled;

  return (
    <div style={section}>
      <div style={title}>Reminders</div>

      <label style={row}>
        <input type="checkbox" style={box} checked={prefs.periodExpected.enabled} onChange={() => toggle('periodExpected')} />
        Period expected soon
      </label>
      {prefs.periodExpected.enabled && (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <select
            aria-label="Days before"
            style={field}
            value={prefs.periodExpected.daysBefore}
            onChange={e => setField('periodExpected', { daysBefore: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <option key={n} value={n}>{n} {n === 1 ? 'day' : 'days'} before</option>
            ))}
          </select>
          <input
            type="time"
            aria-label="Period expected reminder time"
            style={field}
            value={prefs.periodExpected.time}
            onChange={e => e.target.value && setField('periodExpected', { time: e.target.value })}
          />
        </div>
      )}

      <label style={row}>
        <input type="checkbox" style={box} checked={prefs.dailyLog.enabled} onChange={() => toggle('dailyLog')} />
        Daily check-in nudge
      </label>
      {prefs.dailyLog.enabled && (
        <input
          type="time"
          aria-label="Daily check-in reminder time"
          style={field}
          value={prefs.dailyLog.time}
          onChange={e => e.target.value && setField('dailyLog', { time: e.target.value })}
        />
      )}

      <label style={row}>
        <input type="checkbox" style={box} checked={prefs.lateCheckIn.enabled} onChange={() => toggle('lateCheckIn')} />
        Late period check-in
      </label>

      <label style={row}>
        <input
          type="checkbox"
          style={box}
          checked={prefs.explicit}
          aria-describedby="reminders-explicit-help"
          onChange={() => onChange({ ...prefs, explicit: !prefs.explicit })}
        />
        Show details in notifications
      </label>
      <div id="reminders-explicit-help" style={note}>Details are hidden on the lock screen where Android allows it; check Settings → Notifications → Lock screen.</div>

      {anyOn && permission && permission !== 'granted' && !message && (
        <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{WARN}</div>
      )}
      <div style={note}>Daily nudges are scheduled for the next two weeks each time you open the app.</div>
      {message && <div role="alert" style={{ fontSize: '.75rem', color: '#E07070' }}>{message}</div>}
      <div style={note}>Reminders arrive within a few minutes of the set time.</div>
    </div>
  );
}
