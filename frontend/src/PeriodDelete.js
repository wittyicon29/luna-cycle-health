import { useState } from 'react';
import { API } from './api';

// Two-step inline confirmation for removing a logged period.
export default function PeriodDelete({ period, token, onDeleted }) {
  const [step, setStep] = useState('idle'); // idle | confirming | busy
  const [err, setErr] = useState('');

  async function confirm() {
    setStep('busy');
    setErr('');
    try {
      await API.periods.remove(period.id, token);
      onDeleted();
    } catch (e) {
      setErr(e.message || 'Could not delete this entry');
      setStep('confirming');
    }
  }

  if (step === 'idle') {
    return (
      <button type="button" className="btn btn-g btn-sm"
        style={{ marginTop: '.7rem', minHeight: 44, color: '#E8706A' }}
        onClick={() => setStep('confirming')}>Delete this entry</button>
    );
  }

  const busy = step === 'busy';
  return (
    <div style={{ marginTop: '.7rem' }}>
      <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: '.5rem', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
        This entry will be removed from your journey. This can't be undone.
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-g btn-sm" style={{ minHeight: 44, color: '#E8706A' }}
          disabled={busy} onClick={confirm}>{busy ? 'Deleting…' : 'Yes, delete'}</button>
        <button type="button" className="btn btn-g btn-sm" style={{ minHeight: 44 }}
          disabled={busy} onClick={() => { setStep('idle'); setErr(''); }}>Cancel</button>
      </div>
      {err && <div role="alert" style={{ fontSize: '.72rem', color: '#E8706A', marginTop: '.45rem' }}>{err}</div>}
    </div>
  );
}
