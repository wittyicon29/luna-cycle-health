import React, { useState } from 'react';
import { isNative } from './platform';
import { APPEARANCES, setAppearance } from './launcherAppearance';

const noteStyle = { fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.5 };

export default function AppearancePanel({ appearance, onChange }) {
  const [pending, setPending] = useState(null);   // key awaiting confirmation
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!isNative()) return null;

  const labelOf = key => (APPEARANCES.find(a => a.key === key) || {}).label;

  async function confirm() {
    if (busy || !pending) return;
    setBusy(true);
    setMessage('');
    const key = pending;
    try {
      await setAppearance(key);
      setMessage(`Done. Look for “${labelOf(key)}” on your home screen.`);
      setPending(null);
      onChange(key);
    } catch (e) {
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
            className="btn btn-g"
            style={{ minHeight: 44, flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', borderColor: a.key === appearance ? 'var(--cta, #FF6B8A)' : undefined }}
            onClick={() => { setMessage(''); if (a.key !== appearance) setPending(a.key); else setPending(null); }}
          >
            <span>{a.label}{a.key === appearance ? ' ✓' : ''}</span>
            <span style={noteStyle}>{a.hint}</span>
          </button>
        ))}
      </div>
      {pending && (
        <div role="group" aria-label="Confirm app appearance" style={{ ...noteStyle, color: 'var(--cream)' }}>
          <div>The app will appear as “{labelOf(pending)}” on your home screen and app list. It may take a few seconds to update — look for the new icon after you close the app.</div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
            <button type="button" className="btn btn-p" style={{ minHeight: 44 }} disabled={busy} onClick={confirm}>Change</button>
            <button type="button" className="btn btn-g" style={{ minHeight: 44 }} disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {message && <div role="status" style={noteStyle}>{message}</div>}
      <div style={noteStyle}>Android still shows the real app name in Settings → Apps and in notifications.</div>
    </div>
  );
}
