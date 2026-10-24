import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { periods: { list: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) } },
}));

const { LogModal } = require('./App');

afterEach(() => jest.useRealTimers());

test('the start date defaults to the local date today', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 24, 23, 30)); // 23:30 local

  render(<LogModal token="tok" onClose={jest.fn()} onSave={jest.fn()} />);

  const [start] = document.querySelectorAll('input[type=date]');
  expect(start.value).toBe('2026-10-24');
});

test('dates cannot be in the future and the end cannot precede the start', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 24, 12, 0));

  render(<LogModal token="tok" onClose={jest.fn()} onSave={jest.fn()} />);

  const [start, end] = document.querySelectorAll('input[type=date]');
  expect(start).toHaveAttribute('max', '2026-10-24');
  expect(end).toHaveAttribute('max', '2026-10-24');
  expect(end).toHaveAttribute('min', start.value);
});

test('Save and Cancel are in a footer that stays visible while the form scrolls', () => {
  render(<LogModal token="tok" onClose={jest.fn()} onSave={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Save to Journey' })).toBeInTheDocument();
  const fs = require('fs');
  const css = fs.readFileSync(require('path').join(__dirname, 'App.js'), 'utf8');
  expect(css).toMatch(/\.modal-foot\{[^}]*position:sticky/);
});

describe('save() validation', () => {
  const { API } = require('./api');
  const setup = () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 24, 12, 0));
    const onSave = jest.fn();
    render(<LogModal token="tok" onClose={jest.fn()} onSave={onSave} />);
    const [start, end] = document.querySelectorAll('input[type=date]');
    return { start, end, onSave };
  };
  beforeEach(() => API.periods.create.mockClear());

  test('refuses an end date before the start date', () => {
    const { start, end } = setup();
    fireEvent.change(start, { target: { value: '2026-10-10' } });
    fireEvent.change(end, { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Journey' }));

    expect(screen.getByText(/end date can't be before the start date/i)).toBeInTheDocument();
    expect(API.periods.create).not.toHaveBeenCalled();
  });

  test('refuses dates in the future', () => {
    const { start } = setup();
    fireEvent.change(start, { target: { value: '2026-10-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Journey' }));

    expect(screen.getByText(/dates can't be in the future/i)).toBeInTheDocument();
    expect(API.periods.create).not.toHaveBeenCalled();
  });

  test('refuses a future end date', () => {
    const { start, end } = setup();
    fireEvent.change(start, { target: { value: '2026-10-20' } });
    fireEvent.change(end, { target: { value: '2026-10-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Journey' }));

    expect(screen.getByText(/dates can't be in the future/i)).toBeInTheDocument();
    expect(API.periods.create).not.toHaveBeenCalled();
  });

  test('a valid range still saves', async () => {
    const { start, end, onSave } = setup();
    jest.useRealTimers();
    fireEvent.change(start, { target: { value: '2026-10-20' } });
    fireEvent.change(end, { target: { value: '2026-10-24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Journey' }));

    await screen.findByRole('button', { name: 'Save to Journey' });
    await require('@testing-library/react').waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(API.periods.create).toHaveBeenCalledTimes(1);
  });
});
