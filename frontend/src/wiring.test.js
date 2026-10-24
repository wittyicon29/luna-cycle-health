import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// CRA 5 / Jest 27 cannot resolve react-router-dom v7 (package "exports" only), so it is
// mocked virtually; the mock reads the query string from MemoryRouter's initialEntries.
jest.mock(
  'react-router-dom',
  () => {
    let search = '';
    return {
      MemoryRouter: ({ initialEntries, children }) => {
        search = (initialEntries[0].split('?')[1]) || '';
        return children;
      },
      useSearchParams: () => [new URLSearchParams(search)],
      useNavigate: () => jest.fn(),
    };
  },
  { virtual: true }
);

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    verify: { verify: jest.fn(), resend: jest.fn() },
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
  API.verify.verify.mockResolvedValue({ message: 'Email verified successfully!' });
  const EmailVerification = require('./EmailVerification').default;

  render(
    <MemoryRouter initialEntries={['/verify-email?token=tok-1']}>
      <EmailVerification />
    </MemoryRouter>
  );

  await waitFor(() => expect(API.verify.verify).toHaveBeenCalledWith('tok-1'));
});

test('PasswordReset renders (its API import used to resolve to undefined)', () => {
  const PasswordReset = require('./PasswordReset').default;
  window.history.pushState({}, '', '/reset-password?token=abc');

  render(<PasswordReset />);

  expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
  expect(API.auth.resetPassword).toBeDefined();
});
