import React from 'react';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

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
const appSrc = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');

function setup() {
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([{ id: 1, start_date: '2026-10-01', end_date: '2026-10-05' }]);
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  return render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
}

test('only the active dock label is visible; all stay accessible names', async () => {
  const { container } = setup();
  await screen.findByRole('button', { name: /Log period/ });
  const dock = container.querySelector('.dock');
  expect(dock.querySelectorAll('button')).toHaveLength(5);
  for (const n of [/Calendar/, /Insights/, /Chat/, /Profile/, /Journey/]) {
    expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
  }
  const journey = dock.querySelector('[aria-current="page"]');
  expect(journey.textContent).toMatch(/Journey/);
  expect(journey.querySelector('.dl').classList.contains('vh')).toBe(false);
  const others = [...dock.querySelectorAll('button')].filter((b) => b !== journey);
  expect(others).toHaveLength(4);
  others.forEach((b) => expect(b.querySelector('.dl').classList.contains('vh')).toBe(true));
});

test('dock CSS is 56px tall with equal-width tabs', () => {
  expect(appSrc).toMatch(/\.dock\{[^}]*height:56px/);
  expect(appSrc).toMatch(/\.dk\{[^}]*flex:1;min-width:0/);
});
