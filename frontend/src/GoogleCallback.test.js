import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('./App', () => ({ injectStyles: jest.fn() }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { auth: { googleCallback: jest.fn() } },
}));

const { API, ApiError } = require('./api');
const { saveGoogleConsent } = require('./consentFlags');
const GoogleCallback = require('./GoogleCallback').default;

function open(search) {
  window.history.pushState({}, '', `/auth/google/callback${search}`);
}

function renderPage(wrapper = children => children) {
  return render(wrapper(<MemoryRouter><GoogleCallback /></MemoryRouter>));
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

test('exchanges the code with the saved consent flags and stores the session', async () => {
  open('?code=abc');
  saveGoogleConsent({ accepted: true, adult: true });
  API.auth.googleCallback.mockResolvedValue({
    access_token: 'a1',
    refresh_token: 'r1',
    user: { email: 'u@gmail.com' },
  });

  renderPage();

  await screen.findByText(/successful/i);
  expect(API.auth.googleCallback).toHaveBeenCalledWith('abc', { accepted: true, adult: true });
  expect(localStorage.getItem('access_token')).toBe('a1');
  expect(localStorage.getItem('refresh_token')).toBe('r1');
  expect(localStorage.getItem('email')).toBe('u@gmail.com');
});

test('the single-use code is exchanged once even under React StrictMode', async () => {
  open('?code=abc');
  API.auth.googleCallback.mockResolvedValue({
    access_token: 'a1',
    refresh_token: 'r1',
    user: { email: 'u@gmail.com' },
  });

  renderPage(children => <React.StrictMode>{children}</React.StrictMode>);

  await screen.findByText(/successful/i);
  expect(API.auth.googleCallback).toHaveBeenCalledTimes(1);
});

test('a new Google user who has not consented is sent to register', async () => {
  open('?code=abc');
  API.auth.googleCallback.mockRejectedValue(
    new ApiError('Please review and accept the required consent to continue.', {
      status: 400,
      detail: { code: 'consent_required', purposes: ['terms_privacy', 'age_18_plus'] },
    })
  );

  renderPage();

  expect(await screen.findByRole('button', { name: /go to register/i })).toBeInTheDocument();
  expect(screen.getByText(/18/)).toBeInTheDocument();
  expect(localStorage.getItem('access_token')).toBeNull();
});

test('other failures show the message and a way back to login', async () => {
  open('?code=abc');
  API.auth.googleCallback.mockRejectedValue(new ApiError('Failed to exchange authorization code', { status: 400 }));

  renderPage();

  expect(await screen.findByText('Failed to exchange authorization code')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /back to login/i })).toBeInTheDocument();
});

test('no code means nothing is sent to the server', async () => {
  open('');

  renderPage();

  expect(await screen.findByText('No authorization code received')).toBeInTheDocument();
  expect(API.auth.googleCallback).not.toHaveBeenCalled();
});

test('a cancelled Google prompt is reported without calling the server', async () => {
  open('?error=access_denied');

  renderPage();

  await waitFor(() => expect(screen.getByText(/cancelled or failed/i)).toBeInTheDocument());
  expect(API.auth.googleCallback).not.toHaveBeenCalled();
});
