import { ApiError } from '../../api';

// Test-only in-memory server shaped like `API` (only the calls the offline modules use).
// `failNext(name, error, { after })` makes the next call to `name` throw, either before it applies (the request never
// reached the server) or after it applied (the response was lost). `setOffline(true)` makes every call fail with a
// network error (status 0) until it is turned off.
export const EMPTY_ENTRY = { mood: null, symptoms: [], flow: null, sleep_hours: null, water_glasses: null, medications_taken: [], note: null };
export const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const apiErr = (status, rawMessage) => new ApiError('err', { status, rawMessage });

export function makeServer() {
  const s = {
    periods: [], logs: {}, medications: [], consents: null, authStatus: null,
    foreignIds: new Set(), calls: [], faults: [], seq: 0, offline: false,
  };
  s.failNext = (name, error, { after = false } = {}) => s.faults.push({ name, error, after });
  s.setOffline = on => { s.offline = !!on; };
  const call = async (name, args, token, apply) => {
    s.calls.push({ name, args: clone(args), token });
    await Promise.resolve();
    if (s.offline) throw apiErr(0);
    const i = s.faults.findIndex(f => f.name === name);
    const fault = i >= 0 ? s.faults.splice(i, 1)[0] : null;
    if (fault && !fault.after) throw fault.error;
    const res = apply();
    if (fault) throw fault.error;
    return clone(res);
  };
  const isEmpty = d => Object.keys(d || {}).every(k => {
    const v = d[k];
    return v === null || v === undefined || (Array.isArray(v) && !v.length) || (typeof v === 'string' && !v.trim());
  });
  s.api = {
    periods: {
      create: (d, t) => call('periods.create', [d], t, () => {
        if (d.id && s.foreignIds.has(d.id)) throw apiErr(409, 'Period id is already in use');
        const existing = d.id && s.periods.find(p => p.id === d.id);
        if (existing) return existing;
        s.seq += 1;
        const p = { ...d, id: d.id || `srv-${s.seq}`, end_date: d.end_date || null };
        s.periods.push(p);
        return p;
      }),
      list: t => call('periods.list', [], t, () => s.periods),
    },
    logs: {
      list: (from, to, t) => call('logs.list', [from, to], t,
        () => Object.values(s.logs).filter(e => e.date >= from && e.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1))),
      put: (date, d, t) => call('logs.put', [date, d], t, () => {
        if (isEmpty(d)) { delete s.logs[date]; return { date, deleted: true }; }
        s.logs[date] = { ...EMPTY_ENTRY, ...d, date, updated_at: '2026-03-03T00:00:00Z' };
        return s.logs[date];
      }),
      remove: (date, t) => call('logs.remove', [date], t, () => { delete s.logs[date]; return { deleted: true }; }),
    },
    medications: {
      list: (t, includeArchived = false) => call('medications.list', [includeArchived], t,
        () => s.medications.filter(m => includeArchived || !m.archived)),
    },
    consents: { get: t => call('consents.get', [], t, () => s.consents) },
    auth: { status: t => call('auth.status', [], t, () => s.authStatus) },
  };
  s.names = () => s.calls.map(c => c.name);
  return s;
}
