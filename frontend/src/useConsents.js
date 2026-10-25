import { useCallback, useEffect, useState } from 'react';
import { API } from './api';
import { t } from './i18n';
import { translateServer } from './serverMessages';

export default function useConsents(token) {
  const [consents, setConsents] = useState(null); // null = still loading
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setConsents(await API.consents.get(token));
    } catch (e) {
      setError(translateServer(e.message) || t('Could not load your privacy settings'));
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const setConsent = useCallback(
    async (purpose, granted) => {
      const next = await API.consents.set(purpose, granted, token);
      setConsents(next);
      return next;
    },
    [token]
  );

  return { consents, error, reload: load, setConsent };
}
