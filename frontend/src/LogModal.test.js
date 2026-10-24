import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { periods: { list: jest.fn().mockResolvedValue([]), create: jest.fn() } },
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
