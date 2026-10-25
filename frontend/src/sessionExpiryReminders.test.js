import React from 'react';
import { render, act } from '@testing-library/react';
import { teardownReminders } from './reminderScheduler';

jest.mock('./LandingPage', () => () => <div>LANDING</div>);
jest.mock('./reminderScheduler', () => ({
  teardownReminders: jest.fn(),
  cancelAllReminders: jest.fn(),
  rebuildReminders: jest.fn(),
  getReminderPermission: jest.fn(),
  requestReminderPermission: jest.fn(),
}));

const App = require('./App').default;

test('session expiry tears down reminders', () => {
  render(<App />);
  act(() => { window.dispatchEvent(new Event('luna:session-expired')); });
  expect(teardownReminders).toHaveBeenCalledTimes(1);
});
