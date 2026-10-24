import React, { useEffect } from 'react';
import { injectStyles } from './App';

const heading = { fontFamily: "'Cormorant Garamond', serif", fontWeight: 400 };

export default function LegalPage({ doc }) {
  useEffect(() => {
    injectStyles();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--cream)', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', lineHeight: 1.6 }}>
        <a href="/" style={{ color: 'var(--muted)', fontSize: '.8rem' }}>← Back to Luna Health</a>
        <h1 style={{ ...heading, fontSize: '2rem' }}>{doc.title}</h1>
        <div
          role="note"
          style={{ border: '1px dashed var(--border)', padding: '.6rem .8rem', borderRadius: 8, fontSize: '.8rem', color: 'var(--muted)' }}
        >
          Draft — pending legal review. Last updated {doc.updated}.
        </div>
        {doc.sections.map(section => (
          <section key={section.heading}>
            <h2 style={{ ...heading, fontSize: '1.3rem', color: '#E8A09A' }}>{section.heading}</h2>
            {section.body.map(paragraph => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
