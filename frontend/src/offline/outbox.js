import * as store from './store';
import { mergePatches } from './patch';

// Queue of changes made offline. Stored as one encrypted blob { nextSeq, items }.
// Every operation is a read-modify-write, so each runs inside a per-email promise chain.
export const OUTBOX_CAP = 500;
const NAME = 'outbox';
const chains = new Map();

function serial(email, task) {
  const key = String(email || '').trim().toLowerCase();
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

async function readBlob(email) {
  const { value } = await store.readDetailed(email, NAME); // unreadable/corrupt behaves as empty
  const items = value && Array.isArray(value.items) ? value.items.filter(i => i && typeof i.seq === 'number') : [];
  const maxSeq = items.reduce((m, i) => Math.max(m, i.seq), 0);
  const nextSeq = Math.max(value && Number.isInteger(value.nextSeq) ? value.nextSeq : 1, maxSeq + 1);
  return { items, nextSeq };
}

const writeBlob = (email, blob) => store.write(email, NAME, blob);
const bySeq = items => items.slice().sort((a, b) => a.seq - b.seq);
const isLogKind = k => k === 'log.patch' || k === 'log.replace' || k === 'log.delete';
const clone = v => JSON.parse(JSON.stringify(v));

export function loadOutbox(email) {
  return serial(email, async () => bySeq((await readBlob(email)).items));
}

export function enqueue(email, item) {
  return serial(email, async () => {
    const blob = await readBlob(email);
    let items = blob.items;
    const incoming = clone(item);
    const seq = blob.nextSeq;
    blob.nextSeq += 1;
    let stored = null;

    if (incoming.kind === 'period.create' && items.some(i => i.kind === 'period.create' && i.clientId === incoming.clientId)) {
      stored = items.find(i => i.kind === 'period.create' && i.clientId === incoming.clientId); // idempotent
    } else if (incoming.kind === 'log.patch') {
      const sameDay = bySeq(items.filter(i => isLogKind(i.kind) && i.date === incoming.date));
      const last = sameDay[sameDay.length - 1];
      if (last && last.kind === 'log.patch') {
        const merged = mergePatches(last, incoming);
        items = items.map(i => (i === last ? { ...i, set: merged.set, clear: merged.clear } : i));
        stored = items.find(i => i.seq === last.seq);
      }
    } else if (incoming.kind === 'log.replace' || incoming.kind === 'log.delete') {
      items = items.filter(i => !(isLogKind(i.kind) && i.date === incoming.date));
    }

    if (!stored) {
      const base = incoming.kind === 'log.patch' ? { set: {}, clear: [], ...incoming } : incoming;
      stored = { ...base, id: `ob-${seq}`, seq, attempts: 0, nextTryAt: 0 };
      items = [...items, stored];
    }

    let dropped = [];
    if (items.length > OUTBOX_CAP) {
      const sorted = bySeq(items);
      dropped = sorted.slice(0, items.length - OUTBOX_CAP);
      items = sorted.slice(dropped.length);
    }
    await writeBlob(email, { nextSeq: blob.nextSeq, items });
    return { item: stored, dropped };
  });
}

export function markFailed(email, id, nextTryAt) {
  return serial(email, async () => {
    const blob = await readBlob(email);
    if (!blob.items.some(i => i.id === id)) return;
    await writeBlob(email, { nextSeq: blob.nextSeq, items: blob.items.map(i => (i.id === id ? { ...i, attempts: (i.attempts || 0) + 1, nextTryAt } : i)) });
  });
}

export function remove(email, id) {
  return serial(email, async () => {
    const blob = await readBlob(email);
    if (!blob.items.some(i => i.id === id)) return;
    await writeBlob(email, { nextSeq: blob.nextSeq, items: blob.items.filter(i => i.id !== id) });
  });
}
