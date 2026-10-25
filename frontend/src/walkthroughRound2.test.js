import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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
const { JourneyApp, AnalysisDrawer } = require('./App');

const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: true, ai_processing: true };

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.scrollTo = jest.fn();
  window.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
});

const analysis = over => ({
  id: 1, cycle_health_score: 80, avg_cycle_length: 28, cycle_std_deviation: 2,
  predictions: { predicted_next_period: '2026-11-21' }, llm_response: null, ...over,
});

describe('AnalysisDrawer score', () => {
  test('null score shows a placeholder, not a number', async () => {
    API.analysis.latest.mockResolvedValue(analysis({ cycle_health_score: null }));
    API.analysis.list.mockResolvedValue([analysis({ cycle_health_score: null })]);
    const { container } = render(<AnalysisDrawer token="t" onClose={() => {}} />);

    expect(await screen.findByText('Needs 3+ cycles for a score')).toBeInTheDocument();
    expect(container.querySelector('.score-num .n').textContent).toBe('—');
    expect(container.textContent).not.toMatch(/null|undefined|NaN|\/ 100/);
  });

  test('a numeric score shows the number', async () => {
    API.analysis.latest.mockResolvedValue(analysis());
    API.analysis.list.mockResolvedValue([analysis()]);
    const { container } = render(<AnalysisDrawer token="t" onClose={() => {}} />);

    await waitFor(() => expect(container.querySelector('.score-num .n')).not.toBeNull());
    expect(container.querySelector('.score-num .n').textContent).toBe('80');
    expect(screen.queryByText('Needs 3+ cycles for a score')).not.toBeInTheDocument();
  });
});

describe('first-run empty state', () => {
  const renderJourney = () => render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);

  test('with no periods a call to action opens the Log modal', async () => {
    renderJourney();

    expect(await screen.findByText('Your journey starts with your first period.')).toBeInTheDocument();
    const bg = document.querySelector('.phase-bg');
    userEvent.hover(bg);
    expect(screen.queryByText('Log a period to calibrate your journey map.')).not.toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Log a period' }));
    expect(await screen.findByText('Log New Period')).toBeInTheDocument();
  });

  test('with a period the call to action is absent', async () => {
    API.periods.list.mockResolvedValue([{ id: 1, start_date: '2026-10-01', end_date: '2026-10-05' }]);
    renderJourney();

    await waitFor(() => expect(API.periods.list).toHaveBeenCalled());
    await screen.findByText('NOW');
    expect(screen.queryByText('Your journey starts with your first period.')).not.toBeInTheDocument();
  });
});

describe('profile language switcher', () => {
  test('the Profile drawer offers the language switcher above Appearance', async () => {
    const { setLanguage, getLanguage } = require('./i18n');
    render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
    userEvent.click(await screen.findByLabelText('Open profile'));
    expect(await screen.findByText('Language')).toBeInTheDocument();
    userEvent.click(screen.getByRole('radio', { name: 'हिन्दी' }));
    expect(getLanguage()).toBe('hi');
    act(() => { setLanguage('en'); });
  });
});
