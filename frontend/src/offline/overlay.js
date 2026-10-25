import { applyPatch, entryToPayload } from './patch';

const bySeq = items => (items || []).slice().sort((a, b) => a.seq - b.seq);

// Server periods plus unsynced period.create items (shown once; gone from the pending list once the server has the id).
export function periodsWithPending(periods, items) {
  const base = Array.isArray(periods) ? periods : [];
  const seen = new Set(base.map(p => p.id));
  const extra = [];
  bySeq(items).forEach(it => {
    if (it.kind !== 'period.create' || seen.has(it.clientId)) return;
    seen.add(it.clientId);
    extra.push({ ...it.payload, id: it.clientId, cycle_length: null, pending: true });
  });
  const startOf = p => String(p.start_date || '');
  return [...base, ...extra].sort((a, b) => (startOf(a) < startOf(b) ? 1 : startOf(a) > startOf(b) ? -1 : 0));
}

// Queued log changes applied in order onto a copy of the logs map; touched days are marked pending.
export function logsWithPending(logs, items) {
  const out = { ...(logs && typeof logs === 'object' ? logs : {}) };
  bySeq(items).forEach(it => {
    if (!it.date) return;
    let payload;
    if (it.kind === 'log.patch') payload = applyPatch(out[it.date], it);
    else if (it.kind === 'log.replace') payload = entryToPayload(it.payload);
    else if (it.kind === 'log.delete') payload = {};
    else return;
    if (Object.keys(payload).length === 0) delete out[it.date];
    else out[it.date] = { ...payload, date: it.date, pending: true };
  });
  return out;
}
