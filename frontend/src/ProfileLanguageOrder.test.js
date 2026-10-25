import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./platform', () => ({ ...jest.requireActual('./platform'), isNative: jest.fn(() => true) }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    consents: { get: jest.fn(), set: jest.fn() },
    auth: { status: jest.fn() },
    periods: { list: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn() },
  },
}));

const { API } = require('./api');
const { isNative } = require('./platform');
const { JourneyApp } = require('./App');
const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: true, ai_processing: true };

test('the Language block comes before the Appearance block in the Profile drawer', async () => {
  isNative.mockReturnValue(true);
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
  userEvent.click(await screen.findByLabelText('Open profile'));
  const switcher = await screen.findByRole('radiogroup', { name: 'Language' });
  const appearance = await screen.findByRole('radiogroup', { name: 'App appearance' });
  expect(switcher.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
