import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusNotice from './StatusNotice';
import { makeHarness } from './testing/statusHarness';

const setup = () => { const h = makeHarness(); render(<h.Provider><StatusNotice /></h.Provider>); return h; };

test('renders nothing when there is nothing to say', () => {
  setup();
  expect(screen.queryByRole('status')).toBeNull();
});

test.each([
  ['one dropped', h => h.internal.addDropped([{ kind: 'day.patch', reason: 'rejected' }]), "1 change couldn't be saved."],
  ['two dropped', h => h.internal.addDropped([{ kind: 'a' }, { kind: 'b' }]), "2 changes couldn't be saved."],
  ['queue lost', h => h.internal.reportLoss(), "Offline data couldn't be read, so changes waiting to sync were lost."],
  ['cache error', h => h.internal.setError(new Error('x')), "Couldn't save offline data on this phone."],
  ['paused', h => h.internal.setStuck(true), "Syncing is paused. We'll keep trying."],
])('%s', (_n, drive, text) => {
  const h = setup();
  act(() => drive(h));
  expect(screen.getByRole('status')).toHaveTextContent(text);
});

test('the dismiss button is at least 44px, acknowledges, and the notice does not come back', async () => {
  const h = setup();
  act(() => { h.internal.setStuck(true); h.internal.reportLoss(); });
  const btn = screen.getByRole('button', { name: 'Dismiss' });
  await userEvent.click(btn);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => { h.internal.setStuck(true); h.internal.reportLoss(); });
  expect(screen.queryByRole('status')).toBeNull();
});

test('queue lost wins over the paused notice; a new drop after acknowledge shows again', async () => {
  const h = setup();
  act(() => { h.internal.setStuck(true); h.internal.reportLoss(); });
  expect(screen.getByRole('status')).toHaveTextContent(/were lost/);
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  act(() => h.internal.addDropped([{ kind: 'x' }]));
  expect(screen.getByRole('status')).toHaveTextContent("1 change couldn't be saved.");
});
