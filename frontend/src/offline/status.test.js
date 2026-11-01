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
