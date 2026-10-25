import React, { useRef } from 'react';
import { t, useLanguage } from '../i18n';
import { usePlayful } from './playfulPrefs';

const OPTIONS = [
  { mode: 'normal', label: () => t('Normal') },
  { mode: 'quiet', label: () => t('Quiet') },
];
const noteStyle = { fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.5 };

function optionStyle(active) {
  return {
    minHeight: 44,
    minWidth: 44,
    flex: 1,
    justifyContent: 'center',
    borderColor: active ? 'var(--cta, #FF6B8A)' : undefined,
  };
}

export default function PlayfulSettings() {
  useLanguage();
  const { mode, setMode } = usePlayful();
  const refs = useRef({});

  function move(index) {
    const next = OPTIONS[(index + OPTIONS.length) % OPTIONS.length].mode;
    setMode(next);
    const node = refs.current[next];
    if (node) node.focus();
  }

  function onKeyDown(e, index) {
    const keys = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: OPTIONS.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(keys[e.key]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div className="ins-lbl">{t('Playful effects')}</div>
      <div role="radiogroup" aria-label={t('Playful effects')} style={{ display: 'flex', gap: '.5rem' }}>
        {OPTIONS.map((o, index) => {
          const active = mode === o.mode;
          return (
            <button
              key={o.mode}
              ref={node => { refs.current[o.mode] = node; }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className="btn btn-g"
              style={optionStyle(active)}
              onClick={() => setMode(o.mode)}
              onKeyDown={e => onKeyDown(e, index)}
            >
              {o.label()}
            </button>
          );
        })}
      </div>
      <div style={noteStyle}>{t("Quiet turns off Luna's animation, sparkles and vibration.")}</div>
    </div>
  );
}
