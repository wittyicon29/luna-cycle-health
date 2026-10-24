import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: {
      register: jest.fn(),
      login: jest.fn(),
      getGoogleAuthUrl: jest.fn(),
      requestPasswordReset: jest.fn(),
    },
    verify: { resend: jest.fn() },
  },
}));

const { API } = require('./api');
const { AuthScreen } = require('./App');

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
});

function openRegister() {
  render(<AuthScreen onLogin={jest.fn()} initialMode="register" />);
}

function fillCredentials() {
  userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'new@gmail.com');
  userEvent.type(screen.getByPlaceholderText('•••••••'), 'password123');
}

test('the login tab shows no consent checkboxes', () => {
  render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);

  expect(screen.queryByLabelText(/18 years/i)).not.toBeInTheDocument();
});

test('register stays disabled until both boxes are ticked', () => {
  openRegister();
  fillCredentials();
  const submit = screen.getByRole('button', { name: 'Create Account' });

  expect(submit).toBeDisabled();
  userEvent.click(screen.getByLabelText(/18 years/i));
  expect(submit).toBeDisabled();
  userEvent.click(screen.getByLabelText(/agree to the/i));
  expect(submit).toBeEnabled();
});

test('register sends both consent flags', async () => {
  API.auth.register.mockResolvedValue({ message: 'Registration successful! Please verify your email.' });
  openRegister();
  fillCredentials();
  userEvent.click(screen.getByLabelText(/18 years/i));
  userEvent.click(screen.getByLabelText(/agree to the/i));

  userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

  await waitFor(() =>
    expect(API.auth.register).toHaveBeenCalledWith({
      email: 'new@gmail.com',
      password: 'password123',
      accepted_privacy_policy: true,
      confirmed_18_plus: true,
    })
  );
});

test('Google sign-up needs the boxes and remembers them across the redirect', async () => {
  API.auth.getGoogleAuthUrl.mockResolvedValue({ auth_url: 'http://localhost/#google' });
  openRegister();
  const google = screen.getByRole('button', { name: /continue with google/i });

  expect(google).toBeDisabled();
  userEvent.click(screen.getByLabelText(/18 years/i));
  userEvent.click(screen.getByLabelText(/agree to the/i));
  expect(google).toBeEnabled();
  userEvent.click(google);

  await waitFor(() => expect(API.auth.getGoogleAuthUrl).toHaveBeenCalled());
  expect(JSON.parse(sessionStorage.getItem('luna_google_consent'))).toEqual({ accepted: true, adult: true });
});

test('Google sign-in on the login tab works without ticking anything', async () => {
  API.auth.getGoogleAuthUrl.mockResolvedValue({ auth_url: 'http://localhost/#google' });
  render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);

  userEvent.click(screen.getByRole('button', { name: /continue with google/i }));

  await waitFor(() => expect(API.auth.getGoogleAuthUrl).toHaveBeenCalled());
  expect(JSON.parse(sessionStorage.getItem('luna_google_consent'))).toEqual({ accepted: false, adult: false });
});
