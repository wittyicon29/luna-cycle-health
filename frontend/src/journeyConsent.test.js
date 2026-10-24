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
    analysis: { list: jest.fn(), latest: jest.fn() },
  },
}));

const { API } = require('./api');
const { JourneyApp } = require('./App');

const ALL = { terms_privacy: true, age_18_plus: true, ai_processing: true };

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
const chatButton = () => screen.findByRole('button', { name: /chat/i });

describe('JourneyApp consent gate', () => {
  test.each([
    ['terms_privacy', { ...ALL, terms_privacy: false }],
    ['age_18_plus', { ...ALL, age_18_plus: false }],
  ])('missing %s shows the required screen instead of the app', async (_name, consents) => {
    API.consents.get.mockResolvedValue(consents);
    renderJourney();

    expect(await screen.findByText(/before you continue/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /chat/i })).not.toBeInTheDocument();
  });

  test('a consent load failure offers Retry and Sign out', async () => {
    API.consents.get.mockRejectedValueOnce(new Error('Network down'));
    renderJourney();

    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(API.consents.get).toHaveBeenCalledTimes(2));
    expect(await chatButton()).toBeInTheDocument();
  });

  test('without AI consent, Chat asks first and does not open the drawer', async () => {
    API.consents.get.mockResolvedValue({ ...ALL, ai_processing: false });
    renderJourney();

    userEvent.click(await chatButton());

    expect(await screen.findByText('Allow AI features?')).toBeInTheDocument();
    expect(API.chat.history).not.toHaveBeenCalled();
  });

  test('allowing saves the consent and then opens the chat', async () => {
    API.consents.get.mockResolvedValue({ ...ALL, ai_processing: false });
    renderJourney();
    userEvent.click(await chatButton());

    userEvent.click(await screen.findByRole('button', { name: /allow ai features/i }));

    await waitFor(() => expect(API.consents.set).toHaveBeenCalledWith('ai_processing', true, 'tok'));
    await waitFor(() => expect(API.chat.history).toHaveBeenCalledWith('tok'));
    expect(screen.queryByText('Allow AI features?')).not.toBeInTheDocument();
  });

  test('with AI consent, Chat opens directly', async () => {
    renderJourney();

    userEvent.click(await chatButton());

    await waitFor(() => expect(API.chat.history).toHaveBeenCalledWith('tok'));
    expect(screen.queryByText('Allow AI features?')).not.toBeInTheDocument();
  });

  test('a consent-required event shows the modal and reloads consents', async () => {
    renderJourney();
    await chatButton();
    expect(API.consents.get).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('luna:consent-required', { detail: { purpose: 'ai_processing' } }));
    });

    expect(await screen.findByText('Allow AI features?')).toBeInTheDocument();
    await waitFor(() => expect(API.consents.get).toHaveBeenCalledTimes(2));
  });
});
