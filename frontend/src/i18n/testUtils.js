// Product and third-party brand names stay in Latin script; Groq and Hugging Face are named in the AI consent text.
const DEFAULT_ALLOW = ['Luna', 'Google', 'Gmail', 'AI', 'PIN', 'DELETE', 'OK', 'ID', 'Groq', 'Hugging Face'];
const EMAIL = /\S+@\S+/g;
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const DOMAIN = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?:\/\S*)?/g;
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isHidden(el, container) {
  for (let node = el; node && node !== container.parentElement; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return true;
    if (node.style && node.style.display === 'none') return true;
  }
  return false;
}

// Returns visible text fragments (text nodes plus aria-label / placeholder / title / alt and the value of
// button-like inputs) that still contain an English word of 3+ letters. Allow-list entries match as whole
// phrases anywhere in a fragment ("Google Calendar", "e-mail") and as single words.
// Options: { includeHidden: true } also inspects hidden / aria-hidden / display:none subtrees.
export function findUntranslated(container, allow = [], { includeHidden = false } = {}) {
  const entries = [...DEFAULT_ALLOW, ...allow].map(e => String(e).trim()).filter(Boolean);
  const phrases = entries
    .sort((a, b) => b.length - a.length)
    .map(e => new RegExp(`(?<![A-Za-z])${escapeRe(e)}(?![A-Za-z])`, 'gi'));
  const words = new Set(entries.map(e => e.toLowerCase()));

  const offending = raw => {
    let text = raw.replace(EMAIL, ' ').replace(URL_RE, ' ').replace(DOMAIN, ' ');
    phrases.forEach(re => { text = text.replace(re, ' '); });
    return (text.match(/[A-Za-z]{3,}/g) || []).some(w => !words.has(w.toLowerCase()));
  };
  const skipped = el => !!el.closest('[data-i18n-ignore]') || (!includeHidden && isHidden(el, container));

  const found = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,textarea,input') || skipped(parent)) continue;
    const text = node.nodeValue.trim();
    if (text && offending(text)) found.push(text);
  }

  const elements = [container, ...container.querySelectorAll('*')].filter(el => el.nodeType === 1);
  elements.forEach(el => {
    if (skipped(el)) return;
    const values = ATTRS.map(a => el.getAttribute(a));
    if (el.tagName === 'INPUT' && ['button', 'submit'].includes((el.getAttribute('type') || '').toLowerCase())) values.push(el.getAttribute('value'));
    values.forEach(v => {
      const text = (v || '').trim();
      if (text && offending(text)) found.push(text);
    });
  });
  return found;
}
