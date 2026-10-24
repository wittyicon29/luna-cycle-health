import React, { useState } from 'react';

export default function AiConsentModal({ onGrant, onClose }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function grant() {
    setSaving(true);
    setErr('');
    try {
      await onGrant();
    } catch (error) {
      setErr(error.message || 'Could not save your choice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-ov">
      <div className="modal">
        <div className="modal-title">Allow AI features?</div>
        <p style={{ fontSize: '.85rem', lineHeight: 1.6 }}>
          To answer your questions and generate insights, Luna sends your messages, a summary of your recent cycle
          data and your health profile to third-party AI services (Groq and Hugging Face). They may process this data
          on servers outside India.
        </p>
        <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
          This is optional. You can withdraw your consent any time in Profile → Privacy &amp; data. Cycle tracking
          works without it.
        </p>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn btn-g" onClick={onClose} disabled={saving}>Not now</button>
          <button className="btn btn-p" onClick={grant} disabled={saving}>{saving ? 'Saving…' : 'Allow AI features'}</button>
        </div>
      </div>
    </div>
  );
}
