import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

beforeAll(() => {
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
});

const AppRouter = require('./AppRouter').default;

// After sign-out the router stays mounted on /app (App owns the screen), so the landing page's own
// router navigation used to change the URL while App kept showing the landing page.
test('signed-out landing inside the app shows the auth form when a call to action is clicked', () => {
  localStorage.clear();
  window.history.pushState({}, '', '/app');
  render(<AppRouter />);
  fireEvent.click(screen.getAllByRole('button', { name: /get started|sign in|sign up/i })[0]);
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
});
