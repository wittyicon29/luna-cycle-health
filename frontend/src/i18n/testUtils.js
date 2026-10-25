const DEFAULT_ALLOW = ['Luna', 'Google', 'Gmail', 'AI', 'PIN', 'DELETE', 'OK', 'ID'];
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_RE = /(?:https?:\/\/|www\.)\S+/g;

// Returns visible text fragments that still contain an English word of 3+ letters.
export function findUntranslated(container, allow = []) {
  const allowed = new Set([...DEFAULT_ALLOW, ...allow].map(w => w.toLowerCase()));
  const found = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const skip = parent && (parent.closest('[data-i18n-ignore]') || parent.closest('script,style,textarea,input'));
    if (!skip) {
      const text = node.nodeValue.trim();
      if (text) {
        const stripped = text.replace(EMAIL, ' ').replace(URL_RE, ' ');
        const words = stripped.match(/[A-Za-z]{3,}/g) || [];
        if (words.some(w => !allowed.has(w.toLowerCase()))) found.push(text);
      }
    }
    node = walker.nextNode();
  }
  return found;
}
