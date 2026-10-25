import React, { useState } from 'react';
import ConsentCheckboxes from './ConsentCheckboxes';
import { t, useLanguage } from './i18n';

export default function RequiredConsentScreen({ onSubmit, onLogout }) {
  useLanguage();
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await onSubmit();
    } catch (error) {
      setErr(error.message || t('Could not save your choice'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-orb auth-orb-a" /><div className="auth-orb auth-orb-b" />
      <div className="auth-card">
        <div className="auth-logo"><span className="auth-moon">◐</span><h1>Luna Health</h1><p>{t('Before you continue')}</p></div>
        <form onSubmit={submit}>
          <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
            {t('Please confirm the following to use Luna Health.')}
          </p>
          <ConsentCheckboxes adult={adult} accepted={accepted} onAdultChange={setAdult} onAcceptedChange={setAccepted} />
          {err && <div className="err">⚠ {err}</div>}
          <button className="btn btn-p btn-full" style={{ marginTop: '1.1rem' }} type="submit" disabled={saving || !(adult && accepted)}>
            {saving ? t('Saving…') : t('Continue')}
          </button>
          <button type="button" className="btn btn-g btn-full" style={{ marginTop: '.5rem' }} onClick={onLogout}>
            {t('Sign out')}
          </button>
        </form>
      </div>
    </div>
  );
}
