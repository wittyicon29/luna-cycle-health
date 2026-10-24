import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('./App', () => ({ __esModule: true, default: () => null, injectStyles: jest.fn() }));
jest.mock('./LandingPage', () => ({ __esModule: true, default: () => null }));

import LegalPage from './LegalPage';
import AppRouter from './AppRouter';
import { PRIVACY_POLICY, TERMS } from './legalContent';

test('renders the title, the draft notice and every section heading', () => {
  render(<LegalPage doc={PRIVACY_POLICY} />);

  expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent(/draft/i);
  PRIVACY_POLICY.sections.forEach(section => {
    expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument();
  });
});

test('the privacy policy states the facts users must be told', () => {
  const text = JSON.stringify(PRIVACY_POLICY).toLowerCase();

  expect(text).toContain('18');
  expect(text).toContain('groq');
  expect(text).toContain('hugging face');
  expect(text).toContain('delete');
  expect(text).toContain('withdraw');
});

test('the terms say Luna is not medical advice and is for adults', () => {
  const text = JSON.stringify(TERMS).toLowerCase();

  expect(text).toContain('not medical advice');
  expect(text).toContain('18');
});

test('the router serves /terms and /privacy', () => {
  window.history.pushState({}, '', '/terms');
  const first = render(<AppRouter />);
  expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
  first.unmount();

  window.history.pushState({}, '', '/privacy');
  render(<AppRouter />);
  expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
});

test('the router serves the password reset page that the email link points to', () => {
  window.history.pushState({}, '', '/reset-password?token=abc');

  render(<AppRouter />);

  expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
});
