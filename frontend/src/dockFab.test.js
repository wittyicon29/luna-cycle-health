import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./platform', () => ({ ...jest.requireActual('./platform'), isNative: jest.fn(() => true) }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    consents: { get: jest.fn(), set: jest.fn() },
    auth: { status: jest.fn() },
    periods: { list: jest.fn(), create: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn() },
  },
}));

const { API } = require('./api');
const { JourneyApp } = require('./App');
const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: true, ai_processing: true };

function setup(periods) {
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue(periods);
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  return render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
}

test('the dock has exactly five tabs and no round log button', async () => {
  const { container } = setup([{ id: 1, start_date: '2026-10-01', end_date: '2026-10-05' }]);
  await screen.findByRole('button', { name: /Log period/ });
  const dock = container.querySelector('.dock');
  expect(dock.querySelectorAll('button')).toHaveLength(5);
  expect(dock.querySelector('.dock-log')).toBeNull();
  expect(dock.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(5);
  expect(dock.querySelector('[aria-current="page"]').textContent).toMatch(/Journey/);
});

test('the floating Log period button opens the log modal', async () => {
  const { container } = setup([{ id: 1, start_date: '2026-10-01', end_date: '2026-10-05' }]);
  const fab = await screen.findByRole('button', { name: /Log period/ });
  expect(fab.classList.contains('log-fab')).toBe(true);
  expect(container.querySelector('.j-canvas').contains(fab)).toBe(true);
  expect(container.querySelector('.dock').contains(fab)).toBe(false);
  userEvent.click(fab);
  expect(await screen.findByRole('button', { name: 'Save to Journey' })).toBeInTheDocument();
});

test('with no periods only the empty-state button shows', async () => {
  const { container } = setup([]);
  await screen.findByRole('button', { name: 'Log a period' });
  expect(container.querySelector('.log-fab')).toBeNull();
});
