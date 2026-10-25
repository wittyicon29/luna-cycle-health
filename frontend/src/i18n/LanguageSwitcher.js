import React from 'react';
import { SUPPORTED, useLanguage, setLanguage, languageLabel } from './index';

const groupStyle = { display: 'flex', gap: '.4rem', justifyContent: 'center' };

function buttonStyle(active) {
  return {
    minHeight: 44,
    minWidth: 44,
    padding: '.4rem 1rem',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: "'Outfit','Noto Sans Devanagari',sans-serif",
    fontSize: '.85rem',
    color: active ? '#fff' : 'var(--muted)',
    background: active ? 'var(--cta, #FF6B8A)' : 'transparent',
    border: `1px solid ${active ? 'var(--cta, #FF6B8A)' : 'var(--border)'}`,
  };
}

// Language names are shown in their own language and are never translated.
export default function LanguageSwitcher() {
  const current = useLanguage();
  return (
    <div role="radiogroup" aria-label="Language" style={groupStyle}>
      {SUPPORTED.map(lang => {
        const active = current === lang;
        return (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={active}
            lang={lang}
            data-i18n-ignore
            style={buttonStyle(active)}
            onClick={() => setLanguage(lang)}
          >
            {languageLabel(lang)}
          </button>
        );
      })}
    </div>
  );
}
