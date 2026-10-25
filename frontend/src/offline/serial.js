// Per-key promise chain: tasks for the same key run one after another (read-modify-write sections).
export function createSerial() {
  const chains = new Map();
  return function serial(email, task) {
    const key = String(email || '').trim().toLowerCase();
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return run;
  };
}

export const emailKey = email => String(email || '').trim().toLowerCase();
