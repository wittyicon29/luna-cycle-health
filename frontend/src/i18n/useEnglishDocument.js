import { useEffect } from 'react';
import { useLanguage, getLanguage, PSEUDO } from './index';

// For pages that stay English in every language (the marketing and legal pages): marks the document as English
// while mounted, so screen readers use an English voice and no :lang(hi) styles apply, then restores the app
// language on unmount. Re-applies if the app language changes while mounted.
export function useEnglishDocument() {
  const language = useLanguage();
  useEffect(() => {
    try { document.documentElement.lang = 'en'; } catch (e) { /* no document */ }
    return () => {
      const current = getLanguage();
      try { document.documentElement.lang = current === PSEUDO ? 'en' : current; } catch (e) { /* no document */ }
    };
  }, [language]);
}
