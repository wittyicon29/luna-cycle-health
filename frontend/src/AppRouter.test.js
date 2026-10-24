import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('./LandingPage', () => () => <div>LANDING MARKER</div>);
jest.mock('./App', () => () => <div>APP MARKER</div>);
jest.mock('./EmailVerification', () => () => <div>VERIFY MARKER</div>);
jest.mock('./GoogleCallback', () => () => <div>GCB MARKER</div>);
jest.mock('./PasswordReset', () => () => <div>RESET MARKER</div>);
jest.mock('./LegalPage', () => () => <div>LEGAL MARKER</div>);

const AppRouter = require('./AppRouter').default;

const renderAt = path => {
  window.history.pushState({}, '', path);
  return render(<React.StrictMode><AppRouter /></React.StrictMode>);
};

beforeEach(() => localStorage.clear());

test('signed-in user at / ends on /app', () => {
  localStorage.setItem('access_token', 't');
  renderAt('/');
  expect(screen.getByText('APP MARKER')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/app');
});

test('signed-in user at /landing ends on /app', () => {
  localStorage.setItem('access_token', 't');
  renderAt('/landing');
  expect(screen.getByText('APP MARKER')).toBeInTheDocument();
});

test('signed-out user stays on the landing page', () => {
  renderAt('/');
  expect(screen.getByText('LANDING MARKER')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

test('signed-in user can still open the legal and verify pages', () => {
  localStorage.setItem('access_token', 't');
  renderAt('/privacy');
  expect(screen.getByText('LEGAL MARKER')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/privacy');
});
