import * as store from './store';
import { mergePatches } from './patch';
import { createSerial, emailKey } from './serial';

// Queue of changes made offline. Stored as one encrypted blob { nextSeq, items }.
// Every operation is a read-modify-write, so each runs inside a per-email promise chain.
export const OUTBOX_CAP = 500;
const NAME = 'outbox';
const KINDS = ['period.create', 'log.patch', 'log.replace', 'log.delete'];
const serial = createSerial();
const lossFlags = new Set(); // emails whose queued changes were lost (unreadable blob or invalid items); in memory only
const locks = new Map(); // emailKey -> Set of item ids currently being sent; in memory only

const lockedSet = email => locks.get(emailKey(email)) || new Set();
function lock(email, id) {
  const k = emailKey(email);
  if (!locks.has(k)) locks.set(k, new Set());
  locks.get(k).add(id);
}
export function release(email, id) {
  const set = locks.get(emailKey(email));
  if (set) { set.delete(id); if (!set.size) locks.delete(emailKey(email)); }
}

const validItem = i => i && typeof i === 'object' && typeof i.id === 'string' && typeof i.seq === 'number'
  && Number.isFinite(i.seq) && KINDS.includes(i.kind);

async function readBlob(email) {
  const { value, status } = await store.readDetailed(email, NAME);
  const raw = value && Array.isArray(value.items) ? value.items : [];
  const items = raw.filter(validItem);
  const lost = status === 'unreadable' || items.length !== raw.length || (status === 'ok' && !Array.isArray(value && value.items));
  if (lost) lossFlags.add(emailKey(email));
  const maxSeq = items.reduce((m, i) => Math.max(m, i.seq), 0);
  const nextSeq = Math.max(value && Number.isInteger(value.nextSeq) ? value.nextSeq : 1, maxSeq + 1);
  return { items, nextSeq, lost };
}

const writeBlob = (email, blob, gen) => store.writeChecked(email, NAME, blob, gen);
const bySeq = items => items.slice().sort((a, b) => a.seq - b.seq);
const isLogKind = k => k === 'log.patch' || k === 'log.replace' || k === 'log.delete';
const clone = v => JSON.parse(JSON.stringify(v));
const newId = seq => `ob-${Date.now().toString(36)}-${seq}`;

export function loadOutboxDetailed(email) {
  return serial(email, async () => {
    const blob = await readBlob(email);
    return { items: bySeq(blob.items), unreadable: blob.lost };
  });
}

export async function loadOutbox(email) { return (await loadOutboxDetailed(email)).items; }

// Returns true once if queued changes were lost since the last call.
export function consumeOutboxLoss(email) {
  const k = emailKey(email);
  const had = lossFlags.has(k);
  lossFlags.delete(k);
  return had;
}

export function enqueue(email, item) {
  const gen = store.currentGeneration();
  return serial(email, async () => {
    const blob = await readBlob(email);
    const locked = lockedSet(email);
    let items = blob.items;
    const incoming = clone(item);
    const lostPending = blob.lost;
    const result = (stored, dropped, persisted) => ({ item: stored, dropped, persisted, lostPending });

    if (incoming.kind === 'log.patch' && !Object.keys(incoming.set || {}).length && !(incoming.clear || []).length) {
      return result(null, [], true);
    }
    if (incoming.kind === 'period.create') {
      const dup = items.find(i => i.kind === 'period.create' && i.clientId === incoming.clientId);
      if (dup) return result(dup, [], true); // idempotent: no write, no seq bump
    }

    const seq = blob.nextSeq;
    let stored = null;
    if (incoming.kind === 'log.patch') {
      const sameDay = bySeq(items.filter(i => isLogKind(i.kind) && i.date === incoming.date));
      const last = sameDay[sameDay.length - 1];
      if (last && last.kind === 'log.patch' && !locked.has(last.id)) {
        const merged = mergePatches(last, incoming);
        stored = { ...last, set: merged.set, clear: merged.clear };
        items = items.map(i => (i.id === last.id ? stored : i));
      }
    } else if (incoming.kind === 'log.replace' || incoming.kind === 'log.delete') {
      items = items.filter(i => !(isLogKind(i.kind) && i.date === incoming.date) || locked.has(i.id));
    }

    let nextSeq = blob.nextSeq;
    if (!stored) {
      const base = incoming.kind === 'log.patch' ? { set: {}, clear: [], ...incoming } : incoming;
      stored = { ...base, id: newId(seq), seq, attempts: 0, nextTryAt: 0 };
      items = [...items, stored];
      nextSeq += 1;
    }

    const dropped = [];
    if (items.length > OUTBOX_CAP) {
      const sorted = bySeq(items);
      const drop = new Set();
      sorted.forEach(i => { if (drop.size < items.length - OUTBOX_CAP && !locked.has(i.id) && i.id !== stored.id) drop.add(i.id); });
      sorted.forEach(i => { if (drop.has(i.id)) dropped.push(i); });
      items = sorted.filter(i => !drop.has(i.id));
    }
    const persisted = await writeBlob(email, { nextSeq, items }, gen);
    return result(stored, dropped, persisted);
  });
}

// Picks the head item (lowest seq not already claimed) if it may be tried now, and locks it against coalescing/dropping.
export function claimNext(email, now) {
  return serial(email, async () => {
    const locked = lockedSet(email);
    const head = bySeq((await readBlob(email)).items).find(i => !locked.has(i.id));
    if (!head || (head.nextTryAt || 0) > now) return null;
    lock(email, head.id);
    return clone(head);
  });
}

export function markFailed(email, id, nextTryAt) {
  const gen = store.currentGeneration();
  return serial(email, async () => {
    release(email, id);
    const blob = await readBlob(email);
    if (!blob.items.some(i => i.id === id)) return;
    await writeBlob(email, { nextSeq: blob.nextSeq, items: blob.items.map(i => (i.id === id ? { ...i, attempts: (i.attempts || 0) + 1, nextTryAt } : i)) }, gen);
  });
}

export function remove(email, id) {
  const gen = store.currentGeneration();
  return serial(email, async () => {
    release(email, id);
    const blob = await readBlob(email);
    if (!blob.items.some(i => i.id === id)) return;
    await writeBlob(email, { nextSeq: blob.nextSeq, items: blob.items.filter(i => i.id !== id) }, gen);
  });
}

// In-memory state (locks, loss flags) is not persisted; sign-out or tests reset it.
export function __resetForTests() { locks.clear(); lossFlags.clear(); }
