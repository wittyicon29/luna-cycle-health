import React, { useState } from 'react';
import { t, useLanguage } from './i18n';

export default function AiConsentModal({ onGrant, onClose }) {
  useLanguage();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function grant() {
    setSaving(true);
    setErr('');
    try {
      await onGrant();
    } catch (error) {
      setErr(error.message || t('Could not save your choice'));
    } finally {
      setSaving(false);
    }
  }

  // i18n-note: consent text, translated literally; "Luna ... sends" uses feminine verb forms; reviewer to confirm "तीसरे पक्ष की एआई सेवाओं"
  const body = t('To answer your questions and generate insights, Luna sends your messages, a summary of your recent cycle data and your health profile to third-party AI services (Groq and Hugging Face). They may process this data on servers outside India.');

  return (
    <div className="modal-ov">
      <div className="modal">
        <div className="modal-title">{t('Allow AI features?')}</div>
        <p style={{ fontSize: '.85rem', lineHeight: 1.6 }}>
          {body}
        </p>
        <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
          {t('This is optional. You can withdraw your consent any time in Profile → Privacy & data. Cycle tracking works without it.')}
        </p>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn btn-g" onClick={onClose} disabled={saving}>{t('Not now')}</button>
          <button className="btn btn-p" onClick={grant} disabled={saving}>{saving ? t('Saving…') : t('Allow AI features')}</button>
        </div>
      </div>
    </div>
  );
}
