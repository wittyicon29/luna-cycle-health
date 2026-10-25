import { createOfflineData } from './data';

// Entry point for the app (wired in PR 3): createOffline({ email, getToken }) → { data, sync, status, … }.
// `data` mirrors the API calls the screens make; `sync` replays queued changes (not started here: call startSync());
// `status` is a small store { getState(), subscribe(fn), acknowledge() } for the offline status line.
// PR 3 creates ONE facade per signed-in session: any sign-out (wipe(), clearLocalUserData()) retires every facade
// created before it, which from then on only passes calls through to the server and stores nothing.
// Other options (`api`, `timeoutMs`, `syncFactory`) exist for tests.
export function createOffline(options = {}) {
  return createOfflineData(options);
}
