import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./platform', () => ({ ...jest.requireActual('./platform'), isNative: jest.fn(() => true) }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    consents: { get: jest.fn(), set: jest.fn() },
    auth: { status: jest.fn() },
    periods: { list: jest.fn(), create: jest.fn() },
    logs: { list: jest.fn(), put: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn() },
  },
}));

const { API } = require('./api');
const { JourneyApp } = require('./App');
const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: true, ai_processing: true };
const PERIODS = [{ id: 1, start_date: '2026-10-01', end_date: '2026-10-05' }];
const appSrc = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');

function setup({ complete = true } = {}) {
  sessionStorage.clear();
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  API.consents.get.mockResolvedValue(ALL);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: complete });
  API.periods.list.mockResolvedValue(PERIODS);
  API.logs.list.mockResolvedValue([]);
  API.logs.put.mockResolvedValue({});
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  return render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
}
const BANNER = 'Complete your health profile for better insights.';

beforeEach(() => jest.clearAllMocks());

test('no stats strip, no day badge, one Today card between the map and the dock', async () => {
  const { container } = setup();
  await waitFor(() => expect(container.querySelector('.today-card')).not.toBeNull());
  expect(container.querySelector('.stats-strip')).toBeNull();
  expect(container.querySelector('.cday-badge')).toBeNull();
  expect(container.querySelectorAll('.today-card')).toHaveLength(1);
  const card = container.querySelector('.today-card');
  const map = container.querySelector('.j-canvas');
  const dock = container.querySelector('.dock');
  expect(map.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the top bar holds only the logo, at most one phase pill and the avatar', async () => {
  const { container } = setup();
  await waitFor(() => expect(container.querySelector('.today-card')).not.toBeNull());
  const bar = container.querySelector('.topbar');
  expect(bar.querySelector('.tlogo')).not.toBeNull();
  expect(bar.querySelectorAll('.phase-pill').length).toBeLessThanOrEqual(1);
  expect(within(bar).getByRole('button', { name: 'Open profile' })).toBeInTheDocument();
  expect(bar.textContent).not.toMatch(/Day/);
});

test('the profile prompt is hidden when collapsed, shown expanded, flagged on the avatar, and Later clears it', async () => {
  const { container } = setup({ complete: false });
  const avatar = await screen.findByRole('button', { name: 'Open profile' });
  await waitFor(() => expect(avatar.parentElement.querySelector('.avatar-dot')).not.toBeNull());
  expect(avatar).toHaveAccessibleDescription('Profile incomplete');
  expect(screen.queryByText(BANNER)).toBeNull();
  userEvent.click(screen.getByRole('button', { name: /Show today's details/ }));
  expect(await screen.findByText(BANNER)).toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: 'Later' }));
  await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
  expect(avatar.parentElement.querySelector('.avatar-dot')).toBeNull();
  expect(avatar).not.toHaveAccessibleDescription('Profile incomplete');
  expect(screen.getByRole('button', { name: /today's details/i })).not.toHaveAttribute('aria-describedby');
  expect(container.querySelector('.today-card [class*="dot"]')).toBeNull();
});

const flush = async () => { for (let i = 0; i < 3; i += 1) await act(async () => {}); };

test('the dot appears for an incomplete profile and is absent for a complete one, after status resolves', async () => {
  const first = setup({ complete: false });
  await waitFor(() => expect(first.container.querySelector('.avatar-dot')).not.toBeNull());
  first.unmount();
  const { container } = setup({ complete: true });
  await waitFor(() => expect(container.querySelector('.today-card')).not.toBeNull());
  await waitFor(() => expect(API.auth.status).toHaveBeenCalledTimes(2));
  await flush();
  expect(container.querySelector('.avatar-dot')).toBeNull();
  expect(screen.getByRole('button', { name: 'Open profile' })).not.toHaveAttribute('aria-describedby');
});

test('the Today card is absent while loading and when consents block the journey', async () => {
  setup();
  API.consents.get.mockReturnValue(new Promise(() => {}));
  const loading = render(<JourneyApp token="tok" email="v@gmail.com" onLogout={jest.fn()} />);
  await flush();
  expect(loading.container.querySelector('.today-card')).toBeNull();
  loading.unmount();
  API.consents.get.mockResolvedValue({ ...ALL, age_18_plus: false });
  const blocked = render(<JourneyApp token="tok" email="v@gmail.com" onLogout={jest.fn()} />);
  await screen.findAllByText(/before you continue/i);
  expect(blocked.container.querySelector('.today-card')).toBeNull();
  blocked.unmount();
  API.consents.get.mockRejectedValue(new Error(''));
  const failed = render(<JourneyApp token="tok" email="v@gmail.com" onLogout={jest.fn()} />);
  await screen.findByRole('button', { name: 'Retry' });
  expect(failed.container.querySelector('.today-card')).toBeNull();
});

test('the stats are reachable by expanding the card', async () => {
  setup();
  userEvent.click(await screen.findByRole('button', { name: /Show today's details/ }));
  for (const label of ['Cycle Day', 'Next in', 'Avg Cycle', 'Logged', 'Phase']) {
    expect(await screen.findByText(label)).toBeInTheDocument();
  }
});

test('the check-in still saves through the card, merged from a fresh read', async () => {
  setup();
  API.logs.list.mockResolvedValue([{ date: new Date().toLocaleDateString('en-CA'), note: 'keep me' }]);
  userEvent.click(await screen.findByRole('radio', { name: /Good/ }));
  await waitFor(() => expect(API.logs.put).toHaveBeenCalled());
  const payload = API.logs.put.mock.calls[0][1];
  expect(payload.mood).toBe(4);
  expect(payload.note).toBe('keep me');
});

test('the month row is an overlay strip without a blurred backdrop', () => {
  const m = appSrc.match(/(^|\n)\.month-row\{([^}]*)\}/);
  expect(m).not.toBeNull();
  expect(m[2]).toMatch(/position:absolute/);
  expect(m[2]).toMatch(/pointer-events:none/);
  expect(m[2]).not.toMatch(/backdrop-filter/);
  expect(appSrc).not.toMatch(/cday-badge|stats-strip/);
  const z = Number(m[2].match(/z-index:(\d+)/)[1]);
  const fogSrc = fs.readFileSync(path.join(__dirname, 'playful', 'FogLayer.js'), 'utf8');
  const fogZ = Number(fogSrc.match(/className="fog"[^>]*zIndex:\s*(\d+)/)[1]);
  expect(z).toBe(6);
  expect(z).toBeGreaterThan(fogZ);
});

test('the map canvas isolates its stacking so map layers stay below the Today panel', () => {
  const canvas = appSrc.match(/(^|\n)\.j-canvas\{([^}]*)\}/)[2];
  expect(canvas).toMatch(/isolation:isolate/);
  expect(canvas).toMatch(/position:relative/);
  // inside the canvas: log pill 20, cards 25, empty state 30 all stay contained
  expect(appSrc).toMatch(/\.log-fab\{[^}]*z-index:20/);
  expect(appSrc).toMatch(/\.j-empty\{[^}]*z-index:30/);
});

test('the phase pill label truncates with an ellipsis while the icon stays', () => {
  expect(appSrc).toMatch(/\.phase-pill-lbl\{[^}]*min-width:0[^}]*overflow:hidden[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  expect(appSrc).toMatch(/className="phase-pill-lbl"/);
});
