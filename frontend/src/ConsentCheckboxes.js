import React from 'react';
import { t, useLanguage } from './i18n';

const row = {
  display: 'flex',
  gap: '.5rem',
  alignItems: 'center',
  minHeight: 44,
  fontSize: '.75rem',
  color: 'var(--muted)',
  cursor: 'pointer',
  marginTop: '.6rem',
  textTransform: 'none',
  letterSpacing: 0,
};
const box = { width: 'auto', marginTop: 0 };

export default function ConsentCheckboxes({ adult, accepted, onAdultChange, onAcceptedChange }) {
  useLanguage();
  const parts = t('I agree to the {terms} and {privacy}.').split(/(\{terms\}|\{privacy\})/);
  const links = {
    '{terms}': <a className="legal-link" href="/terms" target="_blank" rel="noreferrer">{t('Terms')}</a>,
    '{privacy}': <a className="legal-link" href="/privacy" target="_blank" rel="noreferrer">{t('Privacy Policy')}</a>,
  };
  return (
    <div>
      <label style={row}>
        <input type="checkbox" checked={adult} onChange={e => onAdultChange(e.target.checked)} style={box} />
        <span>{t('I am 18 years of age or older.')}</span>
      </label>
      <label style={row}>
        <input type="checkbox" checked={accepted} onChange={e => onAcceptedChange(e.target.checked)} style={box} />
        <span>
          {parts.map((part, i) => (links[part] ? React.cloneElement(links[part], { key: i }) : part))}
        </span>
      </label>
    </div>
  );
}
