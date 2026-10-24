import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    consents: { get: jest.fn(), set: jest.fn() },
    auth: { status: jest.fn() },
    periods: { list: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
  },
}));

const { API } = require('./api');
const { JourneyApp } = require('./App');

const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: false, ai_processing: true };

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.scrollTo = jest.fn();
  window.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.consents.set.mockImplementation(async (purpose, granted) => ({ ...ALL, ai_processing: false, [purpose]: granted }));
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
});

const renderJourney = () => render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);

beforeEach(() => { sessionStorage.clear(); });

test('an incomplete profile shows a banner instead of forcing the questionnaire open', async () => {
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: false });
  renderJourney();

  expect(await screen.findByText(/Complete your health profile/i)).toBeInTheDocument();
  expect(screen.queryByText('Basic Info')).not.toBeInTheDocument();
});

test('Start opens the questionnaire', async () => {
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: false });
  renderJourney();

  userEvent.click(await screen.findByRole('button', { name: 'Start' }));

  expect(await screen.findByText('Basic Info')).toBeInTheDocument();
});

test('Later hides the banner for the session', async () => {
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: false });
  renderJourney();

  userEvent.click(await screen.findByRole('button', { name: 'Later' }));

  expect(screen.queryByText(/Complete your health profile/i)).not.toBeInTheDocument();
  expect(sessionStorage.getItem('luna_profile_banner_dismissed')).toBe('1');
});

test('a completed profile shows no banner', async () => {
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  renderJourney();

  await screen.findByRole('button', { name: /chat/i });
  expect(screen.queryByText(/Complete your health profile/i)).not.toBeInTheDocument();
});

test('the consent screen still comes before everything else', async () => {
  API.consents.get.mockResolvedValue({ ...ALL, age_18_plus: false });
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: false });
  renderJourney();

  expect(await screen.findByText(/before you continue/i)).toBeInTheDocument();
  expect(screen.queryByText(/Complete your health profile/i)).not.toBeInTheDocument();
});

describe('AnalysisDrawer empty state', () => {
  test('says what is needed to get insights', async () => {
    const { AnalysisDrawer } = require('./App');
    API.analysis.list.mockResolvedValue([]);
    API.analysis.latest.mockRejectedValue(new Error('No analysis found'));

    render(<AnalysisDrawer token="tok" onClose={jest.fn()} />);

    expect(await screen.findByText(/Log at least two periods/i)).toBeInTheDocument();
  });
});
