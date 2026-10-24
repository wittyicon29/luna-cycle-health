import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { account: { export: jest.fn(), delete: jest.fn() } },
}));
jest.mock('./download', () => ({ downloadJson: jest.fn() }));

const { API } = require('./api');
const { downloadJson } = require('./download');
const PrivacyPanel = require('./PrivacyPanel').default;

beforeEach(() => jest.clearAllMocks());

function setup(overrides = {}) {
  const props = {
    token: 'tok',
    consents: { ai_processing: true },
    onSetConsent: jest.fn().mockResolvedValue({}),
    onAccountDeleted: jest.fn(),
    ...overrides,
  };
  render(<PrivacyPanel {...props} />);
  return props;
}

test('links to the policies', () => {
  setup();

  expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
  expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
});

test('AI consent can be withdrawn and granted again', async () => {
  const props = setup({ consents: { ai_processing: true } });

  userEvent.click(screen.getByRole('button', { name: /withdraw ai consent/i }));

  await waitFor(() => expect(props.onSetConsent).toHaveBeenCalledWith('ai_processing', false));
});

test('AI consent can be granted when it is off', async () => {
  const props = setup({ consents: { ai_processing: false } });

  userEvent.click(screen.getByRole('button', { name: /allow ai features/i }));

  await waitFor(() => expect(props.onSetConsent).toHaveBeenCalledWith('ai_processing', true));
});

test('download my data fetches the export and saves a dated file', async () => {
  API.account.export.mockResolvedValue({ account: { email: 'u@gmail.com' } });
  setup();

  userEvent.click(screen.getByRole('button', { name: /download my data/i }));

  await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
  expect(API.account.export).toHaveBeenCalledWith('tok');
  expect(downloadJson.mock.calls[0][0]).toMatch(/^luna-health-export-\d{4}-\d{2}-\d{2}\.json$/);
  expect(downloadJson.mock.calls[0][1]).toEqual({ account: { email: 'u@gmail.com' } });
});

test('a failed export shows the error and downloads nothing', async () => {
  API.account.export.mockRejectedValue(new Error('Export failed'));
  setup();

  userEvent.click(screen.getByRole('button', { name: /download my data/i }));

  expect(await screen.findByText(/Export failed/)).toBeInTheDocument();
  expect(downloadJson).not.toHaveBeenCalled();
});

test('deleting needs the exact word DELETE', () => {
  setup();
  userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  const confirm = screen.getByRole('button', { name: /delete forever/i });
  const input = screen.getByLabelText(/type delete to confirm/i);

  expect(confirm).toBeDisabled();
  userEvent.type(input, 'delete');
  expect(confirm).toBeDisabled();
  userEvent.clear(input);
  userEvent.type(input, 'DELETE');
  expect(confirm).toBeEnabled();
});

test('a confirmed deletion calls the server and then signs the user out', async () => {
  API.account.delete.mockResolvedValue({ message: 'deleted' });
  const props = setup();
  userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  userEvent.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');

  userEvent.click(screen.getByRole('button', { name: /delete forever/i }));

  await waitFor(() => expect(props.onAccountDeleted).toHaveBeenCalledTimes(1));
  expect(API.account.delete).toHaveBeenCalledWith('tok');
});

test('a failed deletion keeps the user signed in and shows why', async () => {
  API.account.delete.mockRejectedValue(new Error('Server error'));
  const props = setup();
  userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  userEvent.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');

  userEvent.click(screen.getByRole('button', { name: /delete forever/i }));

  expect(await screen.findByText(/Server error/)).toBeInTheDocument();
  expect(props.onAccountDeleted).not.toHaveBeenCalled();
});
