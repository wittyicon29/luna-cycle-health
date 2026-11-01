// Small observable store for the offline state the UI shows: { online, pendingCount, lastError, queueLost, dropped, stuck }
// (`stuck`: the last sync run stopped on an error with changes kept; `lastError`/`stuck` are also cleared by acknowledge()).
// `queueLost` and `dropped` stay set until acknowledge(); a loss reported again for the same unreadable queue is ignored.
const fresh = () => ({ pendingCount: 0, lastError: null, queueLost: false, dropped: [], stuck: false });
const deviceOnline = () => !(typeof navigator !== 'undefined' && navigator.onLine === false);

export function createStatus({ onAcknowledge } = {}) {
  const subs = new Set();
  let fields = fresh();
  let netOk = true;
  let suppressLoss = false; // after acknowledge, until the queue is seen readable again
  let suppressStuck = false; // after acknowledge, until a run is seen without the error
  let suppressError = false; // after acknowledge, until a write is stored again
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
      suppressStuck = true;
      suppressError = true;
      update({ queueLost: false, dropped: [], stuck: false, lastError: null });
      if (typeof onAcknowledge === 'function') onAcknowledge();
    },
    // Returns true when a request succeeded right after one had failed on the network (a recovery).
    setNetwork(ok) {
      const recovered = !netOk && !!ok;
      onlineChanged(() => { netOk = !!ok; });
      return recovered;
    },
    deviceChanged() { onlineChanged(() => {}); },
    setPending(n) { if (Number.isInteger(n) && n >= 0) update({ pendingCount: n }); },
    setError(e) {
      if (!e) suppressError = false;
      else if (suppressError) return;
      update({ lastError: e || null });
    },
    setStuck(on) {
      if (on && suppressStuck) return;
      if (!on) suppressStuck = false;
      update({ stuck: !!on });
    },
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
      suppressStuck = false;
      suppressError = false;
      netOk = true;
      fields = fresh();
      emit();
    },
  };
  const status = { getState, subscribe: internal.subscribe, acknowledge: internal.acknowledge };
  return { status, internal };
}

const WEB_STATE = Object.freeze({ online: true, pendingCount: 0, lastError: null, queueLost: false, dropped: Object.freeze([]), stuck: false });

export const webStatus = Object.freeze({
  getState: () => WEB_STATE,
  subscribe: () => () => {},
  acknowledge: () => {},
});
