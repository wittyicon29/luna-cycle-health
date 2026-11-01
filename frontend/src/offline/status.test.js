const { createStatus, webStatus } = require('./status');

test('stuck: set, acknowledged, and not shown again until a clean result releases it', () => {
  const { status, internal } = createStatus();
  expect(status.getState().stuck).toBe(false);
  internal.setStuck(true);
  expect(status.getState().stuck).toBe(true);
  status.acknowledge();
  expect(status.getState().stuck).toBe(false);
  internal.setStuck(true); // the same stuck queue reported again by the next run
  expect(status.getState().stuck).toBe(false);
  internal.setStuck(false);
  internal.setStuck(true);
  expect(status.getState().stuck).toBe(true);
});

test('lastError is cleared by acknowledge and not re-raised until a successful write releases it', () => {
  const { status, internal } = createStatus();
  const e = new Error('x');
  internal.setError(e);
  expect(status.getState().lastError).toBe(e);
  status.acknowledge();
  expect(status.getState().lastError).toBeNull();
  internal.setError(new Error('again'));
  expect(status.getState().lastError).toBeNull();
  internal.setError(null);
  internal.setError(e);
  expect(status.getState().lastError).toBe(e);
});

test('reset releases the suppression; web status has stuck false', () => {
  const { status, internal } = createStatus();
  internal.setStuck(true); status.acknowledge(); internal.reset();
  internal.setStuck(true);
  expect(status.getState().stuck).toBe(true);
  expect(webStatus.getState().stuck).toBe(false);
});

describe('acknowledge(kind) clears only what was shown', () => {
  test('dropped leaves queueLost, lastError and stuck alone', () => {
    const { status, internal } = createStatus();
    internal.addDropped([{ kind: 'x' }]); internal.reportLoss(); internal.setError(new Error('e')); internal.setStuck(true);
    status.acknowledge('dropped');
    expect(status.getState()).toMatchObject({ dropped: [], queueLost: true, stuck: true });
    expect(status.getState().lastError).toBeInstanceOf(Error);
    status.acknowledge('queueLost');
    expect(status.getState().queueLost).toBe(false);
    status.acknowledge('lastError');
    expect(status.getState().lastError).toBeNull();
    expect(status.getState().stuck).toBe(true);
    status.acknowledge('stuck');
    expect(status.getState().stuck).toBe(false);
  });

  test('stuck acknowledged stays hidden until a forced run allows it again', () => {
    const { status, internal } = createStatus();
    internal.setStuck(true);
    status.acknowledge('stuck');
    internal.setStuck(true); // timer run
    expect(status.getState().stuck).toBe(false);
    internal.allowStuck(); // forced run started
    internal.setStuck(true);
    expect(status.getState().stuck).toBe(true);
  });

  test('revision only moves when asked', () => {
    const { status, internal } = createStatus();
    expect(status.getState().revision).toBe(0);
    internal.bumpRevision();
    expect(status.getState().revision).toBe(1);
    expect(webStatus.getState().revision).toBe(0);
  });
});
