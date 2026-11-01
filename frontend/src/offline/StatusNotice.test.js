import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusNotice from './StatusNotice';
import { makeHarness } from './testing/statusHarness';

const setup = () => { const h = makeHarness(); render(<h.Provider><StatusNotice /></h.Provider>); return h; };

const region = () => document.querySelector('[role="status"]');

test('an empty polite live region is always mounted; the text arrives in it, the row and button sit outside', () => {
  const h = setup();
  const node = region();
  expect(node).toHaveClass('vh');
  expect(node).toHaveAttribute('aria-live', 'polite');
  expect(node.textContent).toBe('');
  expect(document.querySelector('.today-note')).toBeNull();
  act(() => h.internal.setStuck(true));
  expect(region()).toBe(node); // same node, so the change is announced
  expect(node).toHaveTextContent("Syncing is paused. We'll keep trying.");
  const row = document.querySelector('.today-note');
  expect(node.contains(row)).toBe(false);
  expect(node.contains(screen.getByRole('button', { name: 'Dismiss notice' }))).toBe(false);
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
  expect(region()).toHaveTextContent(text);
});

test('dismissing acknowledges only the shown notice; the next one then appears', async () => {
  const h = setup();
  act(() => { h.internal.addDropped([{ kind: 'x' }]); h.internal.reportLoss(); h.internal.setStuck(true); });
  expect(region()).toHaveTextContent("1 change couldn't be saved.");
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  expect(region()).toHaveTextContent(/were lost/);
  expect(h.status.getState().stuck).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  expect(region()).toHaveTextContent("Syncing is paused");
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  expect(region().textContent).toBe('');
  expect(document.querySelector('.today-note')).toBeNull();
  act(() => { h.internal.setStuck(true); h.internal.reportLoss(); }); // the same conditions do not come back
  expect(region().textContent).toBe('');
});

test('a new drop after acknowledging shows again', async () => {
  const h = setup();
  act(() => h.internal.addDropped([{ kind: 'x' }]));
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  act(() => h.internal.addDropped([{ kind: 'y' }]));
  expect(region()).toHaveTextContent("1 change couldn't be saved.");
});
