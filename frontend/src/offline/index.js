import { createOfflineData } from './data';

// Entry point for the app (wired in PR 3): createOffline({ email, getToken }) → { data, sync, status, … }.
// `data` mirrors the API calls the screens make; `sync` replays queued changes (not started here: call startSync());
// `status` is a small store { getState(), subscribe(fn), acknowledge() } for the offline status line.
export function createOffline({ email, getToken, api } = {}) {
  return createOfflineData({ email, getToken, api });
}
