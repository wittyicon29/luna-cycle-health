import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({ ...jest.requireActual('./api'), API: { auth: {} } }));

const PasswordReset = require('./PasswordReset').default;
const { setLanguage, getLanguage } = require('./i18n');

afterEach(() => { act(() => { setLanguage('en'); }); });

test('the reset-password page offers the language switcher', () => {
  window.history.pushState({}, '', '/reset-password?token=abc');
  render(<PasswordReset />);
  userEvent.click(screen.getByRole('radio', { name: 'हिन्दी' }));
  expect(getLanguage()).toBe('hi');
});
