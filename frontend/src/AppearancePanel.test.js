import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppearancePanel from './AppearancePanel';
import { isNative } from './platform';
import { setAppearance } from './launcherAppearance';
import { rebuildRemindersForAppearance } from './reminderScheduler';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('./reminderScheduler', () => ({ rebuildRemindersForAppearance: jest.fn() }));
jest.mock('./launcherAppearance', () => ({
  ...jest.requireActual('./launcherAppearance'),
  setAppearance: jest.fn(),
}));

beforeEach(() => {
  isNative.mockReturnValue(true);
  setAppearance.mockResolvedValue('notes');
  rebuildRemindersForAppearance.mockResolvedValue({});
});

const LABELS = ['Luna Health', 'Notes', 'Daily Planner', 'Journal', 'Checklist', 'Organizer'];

test('renders nothing on web', () => {
  isNative.mockReturnValue(false);
  const { container } = render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

test('native: six radios, current one checked, 44px targets', () => {
  render(<AppearancePanel appearance="journal" onChange={jest.fn()} />);
  const radios = screen.getAllByRole('radio');
  expect(radios).toHaveLength(6);
  radios.forEach((r, i) => {
    expect(r).toHaveTextContent(LABELS[i]);
    expect(r).toHaveAttribute('aria-checked', LABELS[i] === 'Journal' ? 'true' : 'false');
    expect(r.style.minHeight).toBe('44px');
  });
});

test('choosing the current option does nothing', () => {
  render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  fireEvent.click(screen.getAllByRole('radio')[0]);
  expect(screen.queryByText('Change')).toBeNull();
});

test('choosing another shows confirmation; Cancel hides it without calling setAppearance', () => {
  render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  expect(screen.getByText(/appear as “Notes”/)).toBeInTheDocument();
  expect(screen.getByText('Change')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.queryByText(/appear as “Notes”/)).toBeNull();
  expect(setAppearance).not.toHaveBeenCalled();
});

test('Change applies once (double click ignored), confirms and notifies', async () => {
  const onChange = jest.fn();
  render(<AppearancePanel appearance="default" onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  const change = screen.getByText('Change');
  fireEvent.click(change);
  fireEvent.click(change);
  await screen.findByText('Done. Look for “Notes” in your app list. You may need to add it to your home screen again.');
  expect(setAppearance).toHaveBeenCalledTimes(1);
  expect(setAppearance).toHaveBeenCalledWith('notes');
  expect(onChange).toHaveBeenCalledWith('notes');
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('failure shows the error and does not call onChange', async () => {
  setAppearance.mockRejectedValue(new Error('x'));
  const onChange = jest.fn();
  render(<AppearancePanel appearance="default" onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  fireEvent.click(screen.getByText('Change'));
  await screen.findByText("Couldn't change the app appearance. Nothing was changed.");
  await waitFor(() => expect(screen.queryByText('Change')).toBeNull());
  expect(onChange).not.toHaveBeenCalled();
});

test('limits note is always shown and copy avoids sensitive words', async () => {
  const { container } = render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  expect(screen.getByText('Android still shows the real app name in Settings → Apps and in notifications.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  expect(container.textContent).not.toMatch(/ovulat|fertil|pregnan|period|cycle/i);
});

test('each tile has an aria-hidden svg preview and the accessible name is still the label', () => {
  render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  screen.getAllByRole('radio').forEach((r, i) => {
    const svg = r.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 108 108');
    expect(r).toHaveAccessibleName(new RegExp(`^${LABELS[i]}`));
  });
});

test('the status live region exists before any message', () => {
  render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  const region = screen.getByRole('status');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('');
});

test('radios are disabled and clicks ignored while a switch is in flight', async () => {
  let resolve;
  setAppearance.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  fireEvent.click(screen.getByText('Change'));
  const other = screen.getByRole('radio', { name: /Journal/ });
  expect(other).toBeDisabled();
  fireEvent.click(other);
  expect(screen.getByText(/appear as “Notes”/)).toBeInTheDocument();
  await waitFor(() => expect(setAppearance).toHaveBeenCalled());
  resolve('notes');
  await screen.findByText(/Done\./);
  expect(screen.getByRole('radio', { name: /Journal/ })).not.toBeDisabled();
});

test('pending is cleared when the appearance prop catches up', () => {
  const { rerender } = render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  expect(screen.getByText('Change')).toBeInTheDocument();
  rerender(<AppearancePanel appearance="notes" onChange={jest.fn()} />);
  expect(screen.queryByText('Change')).toBeNull();
});

test('reminders are rebuilt for the target BEFORE the switch', async () => {
  render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  expect(screen.getByText(/The app may close once when this changes\./)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Change'));
  await screen.findByText(/Done\./);
  expect(rebuildRemindersForAppearance).toHaveBeenCalledWith('notes');
  expect(rebuildRemindersForAppearance.mock.invocationCallOrder[0]).toBeLessThan(setAppearance.mock.invocationCallOrder[0]);
});

test('a failed switch restores the reminders for the current appearance', async () => {
  setAppearance.mockRejectedValue(new Error('x'));
  render(<AppearancePanel appearance="journal" onChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('radio', { name: /Notes/ }));
  fireEvent.click(screen.getByText('Change'));
  await screen.findByText(/Nothing was changed/);
  expect(rebuildRemindersForAppearance).toHaveBeenNthCalledWith(1, 'notes');
  expect(rebuildRemindersForAppearance).toHaveBeenNthCalledWith(2, 'journal');
});
