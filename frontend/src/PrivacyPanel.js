import React, { useState } from 'react';
import { API } from './api';
import { downloadJson } from './download';
import { clearLocalUserData } from './session';

const section = { display: 'flex', flexDirection: 'column', gap: '.45rem' };
const title = { fontFamily: "'Cormorant Garamond', serif", fontSize: '1.05rem', color: '#E8A09A', marginBottom: '.3rem' };

export default function PrivacyPanel({ token, consents, onSetConsent, onAccountDeleted }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const aiOn = !!(consents && consents.ai_processing);

  async function run(name, action) {
    setBusy(name);
    setErr('');
    setMsg('');
    try {
      await action();
    } catch (e) {
      setErr(e.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  }

  const toggleAi = () => run('ai', () => onSetConsent('ai_processing', !aiOn));

  const exportData = () =>
    run('export', async () => {
      const data = await API.account.export(token);
      const day = new Date().toISOString().slice(0, 10);
      const saved = await downloadJson(`luna-health-export-${day}.json`, data);
      if (saved) setMsg('Your data was downloaded.');
    });

  const deleteAccount = () =>
    run('delete', async () => {
      await API.account.delete(token);
      clearLocalUserData();
      onAccountDeleted(); // only after the server confirmed
    });

  return (
    <div style={section}>
      <div style={title}>Privacy &amp; data</div>

      <button className="btn btn-g" style={{ justifyContent: 'flex-start' }} onClick={toggleAi} disabled={!!busy}>
        {aiOn ? 'Withdraw AI consent' : 'Allow AI features'}
      </button>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>
        {aiOn
          ? 'Chat and insights currently send your data to third-party AI services.'
          : 'Chat and insights are off until you allow AI features.'}
      </div>

      <button className="btn btn-g" style={{ justifyContent: 'flex-start' }} onClick={exportData} disabled={!!busy}>
        {busy === 'export' ? 'Preparing…' : 'Download my data'}
      </button>

      {!confirming ? (
        <button
          className="btn btn-g"
          style={{ justifyContent: 'flex-start', color: '#E07070', borderColor: 'rgba(224,112,112,.2)' }}
          onClick={() => setConfirming(true)}
          disabled={!!busy}
        >
          Delete my account
        </button>
      ) : (
        <div style={{ border: '1px solid rgba(224,112,112,.3)', borderRadius: 8, padding: '.75rem' }}>
          <div style={{ fontSize: '.78rem', marginBottom: '.5rem' }}>
            This permanently deletes your account and all your data. It cannot be undone.
          </div>
          <div className="f">
            <label htmlFor="delete-confirm">Type DELETE to confirm</label>
            <input id="delete-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
            <button className="btn btn-g" onClick={() => { setConfirming(false); setTyped(''); }} disabled={!!busy}>Cancel</button>
            <button
              className="btn btn-p"
              style={{ background: '#C0392B' }}
              onClick={deleteAccount}
              disabled={typed !== 'DELETE' || !!busy}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </div>
      )}

      {err && <div className="err">⚠ {err}</div>}
      {msg && <div style={{ color: '#5FA87A', fontSize: '.78rem' }}>{msg}</div>}

      <div style={{ fontSize: '.7rem', marginTop: '.4rem' }}>
        <a className="legal-link" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
        {' · '}
        <a className="legal-link" href="/terms" target="_blank" rel="noreferrer">Terms</a>
      </div>
    </div>
  );
}
