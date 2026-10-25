import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  API: {
    auth: { status: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn(), prediction: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn() },
    logs: { list: jest.fn(), put: jest.fn(), remove: jest.fn() },
    medications: { list: jest.fn() },
  },
}));
jest.mock('../platform', () => ({ isNative: jest.fn(() => false) }));

const { API } = require('../api');
const { isNative } = require('../platform');
const { JourneyApp } = require('../App');
const { setLanguage } = require('../i18n');
const PlayfulSettings = require('./PlayfulSettings').default;
const SkyCheckIn = require('./SkyCheckIn').default;
const { PLAYFUL_KEY, savePlayful, getPlayful } = require('./playfulPrefs');

const setReduced = reduced => { window.matchMedia = jest.fn().mockImplementation(() => ({ matches: reduced })); };
const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: true, ai_processing: true };
const ANIM = '.lc-animate, .lc-spark, .fog-lift, .sky-pulse';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.scrollTo = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setReduced(false);
  savePlayful('normal');
  act(() => { setLanguage('en'); });
  isNative.mockReturnValue(false);
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.periods.prediction.mockResolvedValue({ predicted_next_period: '2026-10-28', earliest: '2026-10-26', latest: '2026-10-30' });
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  API.logs.list.mockResolvedValue([]);
  API.logs.put.mockResolvedValue({});
  API.medications.list.mockResolvedValue([]);
});
afterEach(() => { act(() => { setLanguage('en'); }); savePlayful('normal'); });

describe('PlayfulSettings', () => {
  test('renders both options with the current one checked', () => {
    render(<PlayfulSettings />);
    expect(screen.getByText('Playful effects')).toBeInTheDocument();
    expect(screen.getByText("Quiet turns off Luna's animation, sparkles and vibration.")).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Playful effects' });
    expect(group).toBeInTheDocument();
    const [normal, quiet] = screen.getAllByRole('radio');
    expect(normal).toHaveTextContent('Normal');
    expect(quiet).toHaveTextContent('Quiet');
    expect(normal).toHaveAttribute('aria-checked', 'true');
    expect(quiet).toHaveAttribute('aria-checked', 'false');
    expect(normal.tabIndex).toBe(0);
    expect(quiet.tabIndex).toBe(-1);
    screen.getAllByRole('radio').forEach(r => expect(parseInt(r.style.minHeight, 10)).toBeGreaterThanOrEqual(44));
  });

  test('Quiet persists, Normal restores', () => {
    render(<PlayfulSettings />);
    userEvent.click(screen.getByRole('radio', { name: 'Quiet' }));
    expect(localStorage.getItem(PLAYFUL_KEY)).toBe('quiet');
    expect(getPlayful()).toBe('quiet');
    expect(screen.getByRole('radio', { name: 'Quiet' })).toHaveAttribute('aria-checked', 'true');
    userEvent.click(screen.getByRole('radio', { name: 'Normal' }));
    expect(localStorage.getItem(PLAYFUL_KEY)).toBe('normal');
    expect(screen.getByRole('radio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  });

  test('keyboard: arrows move and select, focus follows', () => {
    render(<PlayfulSettings />);
    const normal = screen.getByRole('radio', { name: 'Normal' });
    normal.focus();
    fireEvent.keyDown(normal, { key: 'ArrowRight' });
    expect(getPlayful()).toBe('quiet');
    expect(screen.getByRole('radio', { name: 'Quiet' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Quiet' }).tabIndex).toBe(0);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Quiet' }), { key: 'ArrowLeft' });
    expect(getPlayful()).toBe('normal');
    expect(screen.getByRole('radio', { name: 'Normal' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Normal' }), { key: 'End' });
    expect(getPlayful()).toBe('quiet');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Quiet' }), { key: 'Home' });
    expect(getPlayful()).toBe('normal');
  });

  test('default respects reduced motion only when nothing is stored', () => {
    const { loadPlayful } = require('./playfulPrefs');
    localStorage.removeItem(PLAYFUL_KEY);
    setReduced(true);
    expect(loadPlayful()).toBe('quiet');
    localStorage.setItem(PLAYFUL_KEY, 'normal');
    expect(loadPlayful()).toBe('normal');
  });

  test('toggling Quiet in the Profile drawer updates a mounted JourneyApp at once', async () => {
    const { container } = render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
    await screen.findByLabelText('Open profile');
    const root = () => container.querySelector('[data-playful]');
    expect(root()).toHaveAttribute('data-playful', 'normal');
    expect(document.querySelector('.lc-animate')).not.toBeNull();
    userEvent.click(screen.getByLabelText('Open profile'));
    const group = await screen.findByRole('radiogroup', { name: 'Playful effects' });
    userEvent.click(group.querySelector('[role="radio"]:last-child'));
    expect(root()).toHaveAttribute('data-playful', 'quiet');
    expect(document.querySelector(ANIM)).toBeNull();
    userEvent.click(screen.getByRole('radio', { name: 'Normal' }));
    expect(root()).toHaveAttribute('data-playful', 'normal');
    expect(document.querySelector('.lc-animate')).not.toBeNull();
  });

  test('sky-pulse disappears the moment Quiet is chosen', async () => {
    render(<><PlayfulSettings /><SkyCheckIn token="t" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()} /></>);
    await act(async () => { screen.getAllByRole('radio').find(r => r.className.includes('sky-btn')).click(); });
    expect(document.querySelector('.sky-pulse')).not.toBeNull();
    userEvent.click(screen.getByRole('radio', { name: 'Quiet' }));
    expect(document.querySelector('.sky-pulse')).toBeNull();
  });

  test('the setting sits above the Language block in the Profile main view, web and native', async () => {
    for (const native of [false, true]) {
      isNative.mockReturnValue(native);
      const { unmount } = render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
      userEvent.click(await screen.findByLabelText('Open profile'));
      const playful = await screen.findByRole('radiogroup', { name: 'Playful effects' });
      const language = await screen.findByRole('radiogroup', { name: 'Language' });
      expect(playful.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      unmount();
    }
  });
});
