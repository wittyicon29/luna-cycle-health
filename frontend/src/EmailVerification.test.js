import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { verify: { check: jest.fn(), complete: jest.fn() } },
}));

const { API, ApiError } = require('./api');
const EmailVerification = require('./EmailVerification').default;

function renderPage(url, strict = true) {
  const page = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/verify-email" element={<EmailVerification />} />
        <Route path="/app" element={<div>APP MARKER</div>} />
        <Route path="/login" element={<div>LOGIN MARKER</div>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <React.StrictMode>{page}</React.StrictMode> : page);
}

async function openForm() {
  API.verify.check.mockResolvedValue({ email: 'u@gmail.com' });
  renderPage('/verify-email?token=tok-1');
  await screen.findByRole('heading', { name: 'Choose your password' });
}

function tick() {
  userEvent.click(screen.getByLabelText('I am 18 years of age or older.'));
  userEvent.click(screen.getByLabelText(/I agree to the/));
}

function fill(pw, confirm) {
  userEvent.type(screen.getByLabelText('New password'), pw);
  userEvent.type(screen.getByLabelText('Confirm password'), confirm);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

test('a valid token shows the email and the password form; check runs once under StrictMode', async () => {
  await openForm();

  expect(screen.getByDisplayValue('u@gmail.com')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
  expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  expect(API.verify.check).toHaveBeenCalledTimes(1);
  expect(API.verify.check).toHaveBeenCalledWith('tok-1');
});

test('mismatched passwords are rejected without calling the server', async () => {
  await openForm();
  fill('password123', 'password124');

  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

  expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  expect(API.verify.complete).not.toHaveBeenCalled();
});

test('a short password is rejected without calling the server', async () => {
  await openForm();
  fill('short', 'short');

  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

  expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
  expect(API.verify.complete).not.toHaveBeenCalled();
});

test('the password can be shown and hidden', async () => {
  await openForm();
  const input = screen.getByLabelText('New password');

  expect(input).toHaveAttribute('type', 'password');
  userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(input).toHaveAttribute('type', 'text');
  userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(input).toHaveAttribute('type', 'password');
});

test('a valid submit completes, stores the session and goes to /app', async () => {
  API.verify.complete.mockResolvedValue({ access_token: 'acc', refresh_token: 'ref', token_type: 'bearer' });
  await openForm();
  fill('password123', 'password123');
  tick();

  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

  expect(await screen.findByText('APP MARKER')).toBeInTheDocument();
  expect(API.verify.complete).toHaveBeenCalledWith('tok-1', 'password123', { accepted: true, adult: true });
  expect(localStorage.getItem('access_token')).toBe('acc');
  expect(localStorage.getItem('refresh_token')).toBe('ref');
  expect(localStorage.getItem('email')).toBe('u@gmail.com');
});

test('an invalid link shows the message and a way back to sign in', async () => {
  API.verify.check.mockRejectedValue(new ApiError('This link is invalid, expired or already used.', { status: 400 }));
  renderPage('/verify-email?token=bad');

  expect(await screen.findByText('This link is invalid, expired or already used.')).toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(await screen.findByText('LOGIN MARKER')).toBeInTheDocument();
});

test('a link without a token never calls the server', async () => {
  renderPage('/verify-email');

  expect(await screen.findByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();
  expect(API.verify.check).not.toHaveBeenCalled();
});

test('a complete failure shows the error and keeps the form usable', async () => {
  API.verify.complete.mockRejectedValueOnce(new ApiError('Something broke', { status: 500 }));
  API.verify.complete.mockResolvedValueOnce({ access_token: 'a', refresh_token: 'r' });
  await openForm();
  fill('password123', 'password123');
  tick();

  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

  expect(await screen.findByText('Something broke')).toBeInTheDocument();
  const submit = screen.getByRole('button', { name: 'Create my account' });
  expect(submit).toBeEnabled();
  userEvent.click(submit);
  await waitFor(() => expect(screen.getByText('APP MARKER')).toBeInTheDocument());
});

test('submit is blocked until both consents are ticked', async () => {
  await openForm();
  fill('password123', 'password123');

  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));
  expect(await screen.findByText(/18 or older and agree to the Terms/)).toBeInTheDocument();
  userEvent.click(screen.getByLabelText('I am 18 years of age or older.'));
  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

  expect(API.verify.complete).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
});

test('a password over 72 bytes is rejected without calling the server', async () => {
  await openForm();
  const long = 'é'.repeat(37);
  fill(long, long);
  tick();

  userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

  expect(await screen.findByText('Password must be at most 72 bytes')).toBeInTheDocument();
  expect(API.verify.complete).not.toHaveBeenCalled();
});

test('a changed token re-runs the check once; the same token under StrictMode checks once', async () => {
  API.verify.check.mockResolvedValue({ email: 'u@gmail.com' });
  let go;
  function Nav() {
    const navigate = require('react-router-dom').useNavigate();
    go = to => navigate(to);
    return null;
  }
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={['/verify-email?token=tok-1']}>
        <Nav />
        <Routes><Route path="/verify-email" element={<EmailVerification />} /></Routes>
      </MemoryRouter>
    </React.StrictMode>
  );
  await screen.findByRole('heading', { name: 'Choose your password' });
  expect(API.verify.check).toHaveBeenCalledTimes(1);

  require('react').act(() => go('/verify-email?token=tok-2'));

  await waitFor(() => expect(API.verify.check).toHaveBeenCalledTimes(2));
  expect(API.verify.check).toHaveBeenLastCalledWith('tok-2');
  await screen.findByRole('heading', { name: 'Choose your password' });
  expect(API.verify.check).toHaveBeenCalledTimes(2);
});
