import React, { useRef } from 'react';
import { SUPPORTED, useLanguage, setLanguage, languageLabel, t } from './index';

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
  const refs = useRef({});

  function move(index) {
    const lang = SUPPORTED[(index + SUPPORTED.length) % SUPPORTED.length];
    setLanguage(lang);
    const node = refs.current[lang];
    if (node) node.focus();
  }

  function onKeyDown(e, index) {
    const keys = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: SUPPORTED.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(keys[e.key]);
  }

  return (
    <div role="radiogroup" aria-label={t('Language')} style={groupStyle}>
      {SUPPORTED.map((lang, index) => {
        const active = current === lang;
        return (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            ref={node => { refs.current[lang] = node; }}
            onKeyDown={e => onKeyDown(e, index)}
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
