// Small observable store for the offline state the UI shows: { online, pendingCount, lastError, queueLost, dropped }.
// `queueLost` and `dropped` stay set until acknowledge(); a loss reported again for the same unreadable queue is ignored.
const fresh = () => ({ pendingCount: 0, lastError: null, queueLost: false, dropped: [] });
const deviceOnline = () => !(typeof navigator !== 'undefined' && navigator.onLine === false);

export function createStatus({ onAcknowledge } = {}) {
  const subs = new Set();
  let fields = fresh();
  let netOk = true;
  let suppressLoss = false; // after acknowledge, until the queue is seen readable again
  let cached = null;

  function getState() {
    const online = netOk && deviceOnline();
    if (!cached || cached.online !== online) cached = { online, ...fields };
    return cached;
  }

  function emit() {
    cached = null;
    const state = getState();
    subs.forEach(fn => { try { fn(state); } catch (e) { /* a listener error must not break the others */ } });
  }

  function update(patch) {
    const changed = Object.keys(patch).some(k => fields[k] !== patch[k]);
    if (!changed) return;
    fields = { ...fields, ...patch };
    emit();
  }

  function onlineChanged(run) {
    const before = getState().online;
    run();
    cached = null;
    if (getState().online !== before) emit();
  }

  const internal = {
    getState,
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
    acknowledge() {
      suppressLoss = true;
      update({ queueLost: false, dropped: [] });
      if (typeof onAcknowledge === 'function') onAcknowledge();
    },
    setNetwork(ok) { onlineChanged(() => { netOk = !!ok; }); },
    deviceChanged() { onlineChanged(() => {}); },
    setPending(n) { if (Number.isInteger(n) && n >= 0) update({ pendingCount: n }); },
    setError(e) { update({ lastError: e || null }); },
    reportLoss() {
      if (fields.queueLost || suppressLoss) return;
      update({ queueLost: true });
    },
    outboxReadable() { suppressLoss = false; },
    addDropped(list) {
      if (Array.isArray(list) && list.length) update({ dropped: [...fields.dropped, ...list] });
    },
    reset() {
      suppressLoss = false;
      netOk = true;
      fields = fresh();
      emit();
    },
  };
  const status = { getState, subscribe: internal.subscribe, acknowledge: internal.acknowledge };
  return { status, internal };
}

const WEB_STATE = Object.freeze({ online: true, pendingCount: 0, lastError: null, queueLost: false, dropped: Object.freeze([]) });

export const webStatus = Object.freeze({
  getState: () => WEB_STATE,
  subscribe: () => () => {},
  acknowledge: () => {},
});
