import { useState } from 'react';
import { API } from './api';
import { t, useLanguage } from './i18n';
import { translateServer } from './serverMessages';

// Two-step inline confirmation for removing a logged period.
export default function PeriodDelete({ period, token, onDeleted }) {
  useLanguage();
  const [step, setStep] = useState('idle'); // idle | confirming | busy
  const [err, setErr] = useState('');

  async function confirm() {
    setStep('busy');
    setErr('');
    try {
      await API.periods.remove(period.id, token);
      onDeleted();
    } catch (e) {
      setErr(translateServer(e.message) || t('Could not delete this entry'));
      setStep('confirming');
    }
  }

  if (step === 'idle') {
    return (
      <button type="button" className="btn btn-g btn-sm"
        style={{ marginTop: '.7rem', minHeight: 44, color: '#E8706A' }}
        onClick={() => setStep('confirming')}>{t('Delete this entry')}</button>
    );
  }

  const busy = step === 'busy';
  return (
    <div style={{ marginTop: '.7rem' }}>
      <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: '.5rem', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
        {t("This entry will be removed from your journey. This can't be undone.")}
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-g btn-sm" style={{ minHeight: 44, color: '#E8706A' }}
          disabled={busy} onClick={confirm}>{busy ? t('Deleting…') : t('Yes, delete')}</button>
        <button type="button" className="btn btn-g btn-sm" style={{ minHeight: 44 }}
          disabled={busy} onClick={() => { setStep('idle'); setErr(''); }}>{t('Cancel')}</button>
      </div>
      {err && <div role="alert" style={{ fontSize: '.72rem', color: '#E8706A', marginTop: '.45rem' }}>{err}</div>}
    </div>
  );
}
