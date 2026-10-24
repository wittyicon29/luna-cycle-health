import React from 'react';

const row = {
  display: 'flex',
  gap: '.5rem',
  alignItems: 'flex-start',
  fontSize: '.75rem',
  color: 'var(--muted)',
  cursor: 'pointer',
  marginTop: '.6rem',
  textTransform: 'none',
  letterSpacing: 0,
};
const box = { width: 'auto', marginTop: '.15rem' };

export default function ConsentCheckboxes({ adult, accepted, onAdultChange, onAcceptedChange }) {
  return (
    <div>
      <label style={row}>
        <input type="checkbox" checked={adult} onChange={e => onAdultChange(e.target.checked)} style={box} />
        <span>I am 18 years of age or older.</span>
      </label>
      <label style={row}>
        <input type="checkbox" checked={accepted} onChange={e => onAcceptedChange(e.target.checked)} style={box} />
        <span>
          I agree to the <a className="legal-link" href="/terms" target="_blank" rel="noreferrer">Terms</a> and{' '}
          <a className="legal-link" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
        </span>
      </label>
    </div>
  );
}
