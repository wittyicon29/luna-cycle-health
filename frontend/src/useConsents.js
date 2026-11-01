import { useCallback, useEffect, useState } from 'react';
import { API } from './api';
import { useOfflineData } from './offline/useOffline';
import { t } from './i18n';

export default function useConsents(token) {
  const data = useOfflineData();
  const [consents, setConsents] = useState(null); // null = still loading
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setConsents(await data.getConsents(token)); // offline: the cached server answer, never a made-up one
    } catch (e) {
      setError(e.message || t('Could not load your privacy settings'));
    }
  }, [token, data]);

  useEffect(() => {
    load();
  }, [load]);

  const setConsent = useCallback(
    async (purpose, granted) => {
      let next;
      try {
        next = await API.consents.set(purpose, granted, token); // online only
      } catch (e) {
        await data.refreshConsents(undefined).catch(() => {}); // the outcome is unknown: drop the cached copy
        throw e;
      }
      await data.refreshConsents(next).catch(() => {}); // the cached copy must not keep the old answer
      setConsents(next);
      return next;
    },
    [token, data]
  );

  return { consents, error, reload: load, setConsent };
}
