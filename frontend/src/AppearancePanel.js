import React, { useState, useEffect } from 'react';
import { isNative } from './platform';
import { rebuildRemindersForAppearance } from './reminderScheduler';
import { APPEARANCES, APPEARANCE_ICONS, setAppearance } from './launcherAppearance';

const noteStyle = { fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.5 };

function IconPreview({ iconKey }) {
  const icon = APPEARANCE_ICONS[iconKey];
  if (!icon) return null;
  return (
    <svg viewBox="0 0 108 108" width="40" height="40" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <rect width="108" height="108" rx="22" fill={icon.background} />
      {icon.shapes.map((s, i) => <path key={i} d={s.d} fill={s.fill} />)}
    </svg>
  );
}

export default function AppearancePanel({ appearance, onChange }) {
  const [pending, setPending] = useState(null);   // key awaiting confirmation
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Once the applied appearance catches up with the pending choice, there is nothing left to confirm.
  useEffect(() => { if (pending && pending === appearance) setPending(null); }, [appearance, pending]);

  if (!isNative()) return null;

  const labelOf = key => (APPEARANCES.find(a => a.key === key) || {}).label;

  async function confirm() {
    if (busy || !pending) return;
    setBusy(true);
    setMessage('');
    const key = pending;
    try {
      // Reminder wording first: the switch can send the app to the background or close it.
      await rebuildRemindersForAppearance(key);
      await setAppearance(key);
      setMessage(`Done. Look for “${labelOf(key)}” in your app list. You may need to add it to your home screen again.`);
      setPending(null);
      onChange(key);
    } catch (e) {
      await rebuildRemindersForAppearance(appearance);
      setMessage("Couldn't change the app appearance. Nothing was changed.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div className="ins-lbl">App appearance on this phone</div>
      <div role="radiogroup" aria-label="App appearance" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '.5rem' }}>
        {APPEARANCES.map(a => (
          <button
            key={a.key}
            type="button"
            role="radio"
            aria-checked={a.key === appearance}
            disabled={busy}
            className="btn btn-g"
            style={{ minHeight: 44, gap: '.35rem', alignItems: 'flex-start', textAlign: 'left', borderColor: a.key === appearance ? 'var(--cta, #FF6B8A)' : undefined }}
            onClick={() => { setMessage(''); if (a.key !== appearance) setPending(a.key); else setPending(null); }}
          >
            <IconPreview iconKey={a.key} />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span>{a.label}{a.key === appearance ? ' ✓' : ''}</span>
              <span style={noteStyle}>{a.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {pending && (
        <div role="group" aria-label="Confirm app appearance" style={{ ...noteStyle, color: 'var(--cream)' }}>
          <div>The app will appear as “{labelOf(pending)}” in your app list; your old home-screen shortcut will disappear. It can take a moment to update, and some launchers need a restart. The app may close once when this changes.</div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
            <button type="button" className="btn btn-p" style={{ minHeight: 44 }} disabled={busy} onClick={confirm}>Change</button>
            <button type="button" className="btn btn-g" style={{ minHeight: 44 }} disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite" style={noteStyle}>{message}</div>
      <div style={noteStyle}>Android still shows the real app name in Settings → Apps and in notifications.</div>
    </div>
  );
}
