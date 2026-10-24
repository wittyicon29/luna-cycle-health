import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { periods: { remove: jest.fn() } },
}));

const { API } = require('./api');
const PeriodDelete = require('./PeriodDelete').default;

beforeEach(() => jest.clearAllMocks());

const period = { id: 'p1', start_date: '2026-10-08' };

test('deleting needs a second, explicit confirmation', () => {
  render(<PeriodDelete period={period} token="tok" onDeleted={jest.fn()} />);

  userEvent.click(screen.getByRole('button', { name: /delete this entry/i }));

  expect(API.periods.remove).not.toHaveBeenCalled();
  expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
});

test('confirming removes the entry and tells the parent', async () => {
  API.periods.remove.mockResolvedValue({ message: 'Period deleted' });
  const onDeleted = jest.fn();
  render(<PeriodDelete period={period} token="tok" onDeleted={onDeleted} />);
  userEvent.click(screen.getByRole('button', { name: /delete this entry/i }));

  userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));

  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  expect(API.periods.remove).toHaveBeenCalledWith('p1', 'tok');
});

test('cancelling backs out without calling the server', () => {
  render(<PeriodDelete period={period} token="tok" onDeleted={jest.fn()} />);
  userEvent.click(screen.getByRole('button', { name: /delete this entry/i }));

  userEvent.click(screen.getByRole('button', { name: /cancel/i }));

  expect(API.periods.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /delete this entry/i })).toBeInTheDocument();
});

test('a server error is shown and the parent is not told', async () => {
  API.periods.remove.mockRejectedValue(new Error('Period not found'));
  const onDeleted = jest.fn();
  render(<PeriodDelete period={period} token="tok" onDeleted={onDeleted} />);
  userEvent.click(screen.getByRole('button', { name: /delete this entry/i }));

  userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));

  expect(await screen.findByText(/Period not found/)).toBeInTheDocument();
  expect(onDeleted).not.toHaveBeenCalled();
});
