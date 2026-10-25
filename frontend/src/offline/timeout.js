import { ApiError } from '../api';
import { connectionProblemMessage } from '../serverMessages';

// A request that hangs (captive portal, dead socket) must not block the facade's write chain or the sync chain, so
// every offline-layer request is raced against a timer. A timeout is reported like any connection failure (status 0):
// writes are queued, reads serve the cache, and the replay is idempotent if the request did reach the server.
export const DEFAULT_TIMEOUT_MS = 25 * 1000;
const CONNECTION_RAW = 'Connection problem. Please try again.';

export const timeoutError = () => new ApiError(connectionProblemMessage(), { status: 0, rawMessage: CONNECTION_RAW });

export function withTimeout(promise, ms) {
  if (!(typeof ms === 'number' && ms > 0 && Number.isFinite(ms))) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), ms); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Wraps every `api.<group>.<call>` in withTimeout. Calls are looked up when made, not when wrapped.
export function timedApi(api, ms) {
  const out = {};
  Object.keys(api || {}).forEach(group => {
    const g = api[group];
    if (!g || typeof g !== 'object') return;
    out[group] = {};
    Object.keys(g).forEach(name => {
      if (typeof g[name] !== 'function') return;
      out[group][name] = (...args) => withTimeout(new Promise(resolve => resolve(api[group][name](...args))), ms);
    });
  });
  return out;
}
