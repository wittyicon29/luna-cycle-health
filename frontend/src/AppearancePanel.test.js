import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppearancePanel from './AppearancePanel';
import { isNative } from './platform';
import { setAppearance } from './launcherAppearance';

jest.mock('./platform', () => ({ isNative: jest.fn() }));
jest.mock('./launcherAppearance', () => ({
  ...jest.requireActual('./launcherAppearance'),
  setAppearance: jest.fn(),
}));

beforeEach(() => {
  isNative.mockReturnValue(true);
  setAppearance.mockResolvedValue('notes');
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
  await screen.findByText('Done. Look for “Notes” on your home screen.');
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
