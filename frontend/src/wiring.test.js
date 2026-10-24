import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    verify: { check: jest.fn(), complete: jest.fn(), resend: jest.fn() },
    auth: { resetPassword: jest.fn() },
  },
}));

const { API } = require('./api');

test('App.js exposes the pieces other files and tests rely on', () => {
  const app = require('./App');

  expect(typeof app.default).toBe('function');
  expect(typeof app.injectStyles).toBe('function');
  expect(typeof app.AuthScreen).toBe('function');
  expect(typeof app.JourneyApp).toBe('function');
});

test('EmailVerification uses the shared API client', async () => {
  API.verify.check.mockResolvedValue({ email: 'u@gmail.com' });
  const EmailVerification = require('./EmailVerification').default;

  render(
    <MemoryRouter initialEntries={['/verify-email?token=tok-1']}>
      <EmailVerification />
    </MemoryRouter>
  );

  await waitFor(() => expect(API.verify.check).toHaveBeenCalledWith('tok-1'));
});

test('PasswordReset renders (its API import used to resolve to undefined)', () => {
  const PasswordReset = require('./PasswordReset').default;
  window.history.pushState({}, '', '/reset-password?token=abc');

  render(<PasswordReset />);

  expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
});
