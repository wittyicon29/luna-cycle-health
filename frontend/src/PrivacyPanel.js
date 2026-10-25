import React, { useState } from 'react';
import { API } from './api';
import { downloadJson } from './download';
import { clearLocalUserData } from './session';
import { t, useLanguage } from './i18n';

const section = { display: 'flex', flexDirection: 'column', gap: '.45rem' };
const title = { fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: '1.05rem', color: '#E8A09A', marginBottom: '.3rem' };

export default function PrivacyPanel({ token, consents, onSetConsent, onAccountDeleted }) {
  useLanguage();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null); // { text }: server text is already translated; empty text shows the generic fallback
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const aiOn = !!(consents && consents.ai_processing);

  async function run(name, action) {
    setBusy(name);
    setErr(null);
    setSaved(false);
    try {
      await action();
    } catch (e) {
      setErr({ text: e && e.message });
    } finally {
      setBusy('');
    }
  }

  const toggleAi = () => run('ai', () => onSetConsent('ai_processing', !aiOn));

  const exportData = () =>
    run('export', async () => {
      const data = await API.account.export(token);
      const day = new Date().toISOString().slice(0, 10);
      const didSave = await downloadJson(`luna-health-export-${day}.json`, data);
      if (didSave) setSaved(true);
    });

  const deleteAccount = () =>
    run('delete', async () => {
      await API.account.delete(token);
      clearLocalUserData();
      onAccountDeleted(); // only after the server confirmed
    });

  return (
    <div style={section}>
      <div style={title}>{t('Privacy & data')}</div>

      <button className="btn btn-g" style={{ justifyContent: 'flex-start' }} onClick={toggleAi} disabled={!!busy}>
        {aiOn ? t('Withdraw AI consent') : t('Allow AI features')}
      </button>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>
        {aiOn
          ? t('Chat and insights currently send your data to third-party AI services.')
          : t('Chat and insights are off until you allow AI features.')}
      </div>

      <button className="btn btn-g" style={{ justifyContent: 'flex-start' }} onClick={exportData} disabled={!!busy}>
        {busy === 'export' ? t('Preparing…') : t('Download my data')}
      </button>

      {!confirming ? (
        <button
          className="btn btn-g"
          style={{ justifyContent: 'flex-start', color: '#E07070', borderColor: 'rgba(224,112,112,.2)' }}
          onClick={() => setConfirming(true)}
          disabled={!!busy}
        >
          {t('Delete my account')}
        </button>
      ) : (
        <div style={{ border: '1px solid rgba(224,112,112,.3)', borderRadius: 8, padding: '.75rem' }}>
          <div style={{ fontSize: '.78rem', marginBottom: '.5rem' }}>
            {t('This permanently deletes your account and all your data. It cannot be undone.')}
          </div>
          <div className="f">
            <label htmlFor="delete-confirm">{t('Type DELETE to confirm')}</label>
            <input id="delete-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
            <button className="btn btn-g" onClick={() => { setConfirming(false); setTyped(''); }} disabled={!!busy}>{t('Cancel')}</button>
            <button
              className="btn btn-p"
              style={{ background: '#C0392B' }}
              onClick={deleteAccount}
              disabled={typed !== 'DELETE' || !!busy}
            >
              {busy === 'delete' ? t('Deleting…') : t('Delete forever')}
            </button>
          </div>
        </div>
      )}

      {err && <div className="err">⚠ {err.text || t('Something went wrong')}</div>}
      {saved && <div style={{ color: '#5FA87A', fontSize: '.78rem' }}>{t('Your data was downloaded.')}</div>}

      <div style={{ fontSize: '.7rem', marginTop: '.4rem' }}>
        <a className="legal-link" href="/privacy" target="_blank" rel="noreferrer">{t('Privacy Policy')}</a>
        {' · '}
        <a className="legal-link" href="/terms" target="_blank" rel="noreferrer">{t('Terms')}</a>
      </div>
    </div>
  );
}
