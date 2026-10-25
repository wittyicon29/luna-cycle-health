import { periodsWithPending, logsWithPending } from './overlay';

const create = (seq, clientId, start) => ({ seq, kind: 'period.create', clientId, payload: { start_date: start, notes: 'n' } });

describe('periodsWithPending', () => {
  test('appends the pending period once with pending:true, null cycle_length, sorted by start desc', () => {
    const periods = [{ id: 1, start_date: '2026-01-01', cycle_length: 28 }, { id: 2, start_date: '2025-12-01', cycle_length: 30 }];
    const out = periodsWithPending(periods, [create(1, 'c1', '2026-02-01'), create(2, 'c1', '2026-02-01')]);
    expect(out.map(p => p.id)).toEqual(['c1', 1, 2]);
    expect(out[0]).toMatchObject({ start_date: '2026-02-01', pending: true, cycle_length: null, notes: 'n' });
    expect(out.filter(p => p.pending)).toHaveLength(1);
  });
  test('sorts a pending period in the middle by date', () => {
    const out = periodsWithPending([{ id: 1, start_date: '2026-03-01' }, { id: 2, start_date: '2026-01-01' }], [create(1, 'c1', '2026-02-01')]);
    expect(out.map(p => p.id)).toEqual([1, 'c1', 2]);
  });
  test('not duplicated once the server list contains the id', () => {
    const out = periodsWithPending([{ id: 'c1', start_date: '2026-02-01', cycle_length: 28 }], [create(1, 'c1', '2026-02-01')]);
    expect(out).toHaveLength(1);
    expect(out[0].pending).toBeUndefined();
  });
  test('no pending items, null periods, and no mutation', () => {
    expect(periodsWithPending(null, [])).toEqual([]);
    const periods = [{ id: 1, start_date: '2026-01-01' }];
    const items = [create(1, 'c1', '2026-02-01')];
    const pc = JSON.stringify(periods); const ic = JSON.stringify(items);
    periodsWithPending(periods, items);
    expect(JSON.stringify(periods)).toBe(pc);
    expect(JSON.stringify(items)).toBe(ic);
  });
});

describe('logsWithPending', () => {
  const logs = { '2026-03-01': { date: '2026-03-01', mood: 2, sleep_hours: 0, updated_at: 'u' }, '2026-03-02': { date: '2026-03-02', mood: 3 } };
  test('applies patch, replace, delete in seq order and marks pending', () => {
    const items = [
      { seq: 3, kind: 'log.delete', date: '2026-03-02' },
      { seq: 1, kind: 'log.patch', date: '2026-03-01', set: { note: 'hi' }, clear: [] },
      { seq: 2, kind: 'log.replace', date: '2026-03-04', payload: { water_glasses: 0 } },
    ];
    const out = logsWithPending(logs, items);
    expect(out['2026-03-01']).toEqual({ date: '2026-03-01', mood: 2, sleep_hours: 0, note: 'hi', pending: true });
    expect(out['2026-03-04']).toEqual({ date: '2026-03-04', water_glasses: 0, pending: true });
    expect(out['2026-03-02']).toBeUndefined();
  });
  test('patch after replace layers on top; replace after patch wins', () => {
    const out = logsWithPending({}, [
      { seq: 1, kind: 'log.patch', date: 'd', set: { mood: 1 }, clear: [] },
      { seq: 2, kind: 'log.replace', date: 'd', payload: { note: 'r' } },
      { seq: 3, kind: 'log.patch', date: 'd', set: { mood: 5 }, clear: [] },
    ]);
    expect(out.d).toMatchObject({ note: 'r', mood: 5, pending: true });
  });
  test('empty merged result removes the day', () => {
    const out = logsWithPending({ d: { date: 'd', mood: 1 } }, [{ seq: 1, kind: 'log.patch', date: 'd', set: {}, clear: ['mood'] }]);
    expect(out.d).toBeUndefined();
  });
  test('untouched days are not marked pending; inputs not mutated', () => {
    const items = [{ seq: 1, kind: 'log.patch', date: '2026-03-01', set: { mood: 9 }, clear: [] }];
    const lc = JSON.stringify(logs); const ic = JSON.stringify(items);
    const out = logsWithPending(logs, items);
    expect(out['2026-03-02'].pending).toBeUndefined();
    expect(JSON.stringify(logs)).toBe(lc);
    expect(JSON.stringify(items)).toBe(ic);
    expect(logsWithPending(null, [])).toEqual({});
  });
});
