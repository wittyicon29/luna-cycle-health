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
}

test('the register tab has no password field or show-password button', () => {
  openRegister();

  expect(screen.queryByPlaceholderText('•••••••')).toBeNull();
  expect(screen.queryByRole('button', { name: /show password/i })).toBeNull();
  expect(screen.queryByText(/at least 8 characters/i)).toBeNull();
});

test('register needs an email as well as both boxes', () => {
  openRegister();
  const submit = screen.getByRole('button', { name: 'Create Account' });
  userEvent.click(screen.getByLabelText(/18 years/i));
  userEvent.click(screen.getByLabelText(/agree to the/i));

  expect(submit).toBeDisabled();
  userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'new@gmail.com');
  expect(submit).toBeEnabled();
});

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
  expect((sessionStorage.getItem('luna_google_state') || '').length).toBeGreaterThanOrEqual(16);
});

test('Google sign-in on the login tab works without ticking anything', async () => {
  API.auth.getGoogleAuthUrl.mockResolvedValue({ auth_url: 'http://localhost/#google' });
  render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);

  userEvent.click(screen.getByRole('button', { name: /continue with google/i }));

  await waitFor(() => expect(API.auth.getGoogleAuthUrl).toHaveBeenCalled());
  expect(JSON.parse(sessionStorage.getItem('luna_google_consent'))).toEqual({ accepted: false, adult: false });
});

test('the login submit button says what it does', () => {
  render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);

  expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Begin Your Journey' })).not.toBeInTheDocument();
});

test('the Gmail-only note appears on the register tab only', () => {
  const { unmount } = render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);
  expect(screen.queryByText(/Only Gmail addresses/)).not.toBeInTheDocument();
  unmount();

  render(<AuthScreen onLogin={jest.fn()} initialMode="register" />);
  expect(screen.getByText(/Only Gmail addresses/)).toBeInTheDocument();
});

test('the password can be shown and hidden', () => {
  render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);
  const input = screen.getByPlaceholderText('•••••••');

  expect(input).toHaveAttribute('type', 'password');
  userEvent.click(screen.getByRole('button', { name: /show password/i }));
  expect(input).toHaveAttribute('type', 'text');
  userEvent.click(screen.getByRole('button', { name: /hide password/i }));
  expect(input).toHaveAttribute('type', 'password');
});

test('the browser is told what each field is for', () => {
  const { unmount } = render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);
  expect(screen.getByPlaceholderText('your@gmail.com')).toHaveAttribute('autocomplete', 'email');
  expect(screen.getByPlaceholderText('•••••••')).toHaveAttribute('autocomplete', 'current-password');
  unmount();
});

test('the password field reserves room for the show/hide button', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');

  // `.f .pw-wrap input` (0,2,1) outranks `.f input` (0,1,1) regardless of order.
  expect(app).toMatch(/\.f \.pw-wrap input\{[^}]*padding-right:3rem/);
});

test('the login password field has no minimum length', () => {
  render(<AuthScreen onLogin={jest.fn()} initialMode="login" />);
  expect(screen.getByPlaceholderText('•••••••')).not.toHaveAttribute('minlength');
});

test('a register response without tokens shows the message and does not log in', async () => {
  API.auth.register.mockResolvedValue({ message: 'Registration successful! Please check your email.' });
  const onLogin = jest.fn();
  render(<AuthScreen onLogin={onLogin} initialMode="register" />);
  fillCredentials();
  userEvent.click(screen.getByLabelText(/18 years/i));
  userEvent.click(screen.getByLabelText(/agree to the/i));

  userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

  expect(await screen.findByText(/choose your password/i)).toBeInTheDocument();
  expect(onLogin).not.toHaveBeenCalled();
});

test('a login response with no tokens shows an error, not a verify-email message', async () => {
  API.auth.login.mockResolvedValue({});
  const onLogin = jest.fn();
  render(<AuthScreen onLogin={onLogin} initialMode="login" />);
  userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'a@gmail.com');
  userEvent.type(screen.getByPlaceholderText('•••••••'), 'password123');

  userEvent.click(screen.getByRole('button', { name: 'Log in' }));

  expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  expect(onLogin).not.toHaveBeenCalled();
});
