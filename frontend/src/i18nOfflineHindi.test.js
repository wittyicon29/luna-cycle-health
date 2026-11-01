import React from 'react';
import { render, screen, act } from '@testing-library/react';

jest.mock('./api', () => ({ API: { logs: { list: jest.fn(), put: jest.fn(), remove: jest.fn() }, medications: { list: jest.fn() }, periods: { prediction: jest.fn() } } }));

const { API } = require('./api');
const { setLanguage, tn } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const { makeHarness } = require('./offline/testing/statusHarness');
const StatusNotice = require('./offline/StatusNotice').default;
const TodayCard = require('./home/TodayCard').default;
const DaySheet = require('./DaySheet').default;
const CalendarScreen = require('./CalendarScreen').default;

beforeEach(() => { act(() => { setLanguage('hi'); }); API.logs.list.mockResolvedValue([]); API.medications.list.mockResolvedValue([]); });
afterEach(() => { act(() => { setLanguage('en'); }); });

const card = h => render(<h.Provider><TodayCard token="t" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()}
  cycleDay={26} daysToNext={4} avgCycle={28} periodsCount={3} phaseName="ल्यूटियल" phaseColor="#aaa" profilePrompt={null} /></h.Provider>);
const hidden = { includeHidden: true };

test('Today card status line and live region read in Hindi (offline, pending, both)', () => {
  const h = makeHarness();
  const { container } = card(h);
  act(() => { h.internal.setNetwork(false); h.internal.setPending(1); });
  expect(container.querySelector('.today-sum').textContent).toMatch(/^ऑफ़लाइन · 1 बदलाव/);
  expect(findUntranslated(container, [], hidden)).toEqual([]);
  act(() => { h.internal.setNetwork(true); h.internal.setPending(3); });
  expect(findUntranslated(container, [], hidden)).toEqual([]);
});

test.each([
  ['dropped', h => h.internal.addDropped([{ kind: 'x' }, { kind: 'y' }])],
  ['lost', h => h.internal.reportLoss()],
  ['cache error', h => h.internal.setError(new Error('x'))],
  ['paused', h => h.internal.setStuck(true)],
])('notice %s has no English left', (_n, drive) => {
  const h = makeHarness();
  const { container } = render(<h.Provider><StatusNotice /></h.Provider>);
  act(() => drive(h));
  expect(container.querySelector('.today-note-t').textContent).toMatch(/[ऀ-ॿ]/);
  expect(findUntranslated(container, [], hidden)).toEqual([]);
});

test('plural pairs', () => {
  expect(tn(1, '{count} change waiting to sync', '{count} changes waiting to sync')).toBe('1 बदलाव सिंक होने की प्रतीक्षा में');
  expect(tn(2, "{count} change couldn't be saved.", "{count} changes couldn't be saved.")).toBe('2 बदलाव सहेजे नहीं जा सके।');
  expect(tn(1, "{count} change couldn't be saved.", "{count} changes couldn't be saved.")).toBe('1 बदलाव सहेजा नहीं जा सका।');
});

test('DaySheet pending marker reads in Hindi', async () => {
  API.logs.list.mockResolvedValue([{ date: '2026-10-20', mood: 3, pending: true }]);
  const { container } = render(<DaySheet token="t" date="2026-10-20" onClose={jest.fn()} onSaved={jest.fn()} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(container.querySelector('[data-testid="pending-mark"]')).toHaveTextContent('सिंक की प्रतीक्षा में');
  expect(findUntranslated(container, [], hidden)).toEqual([]);
});

test('calendar cell label for a waiting day reads in Hindi', async () => {
  const { localDateString } = require('./localDate');
  const today = localDateString();
  API.periods.prediction.mockResolvedValue(null);
  API.logs.list.mockResolvedValue([{ date: today, mood: 3, pending: true }]);
  const { container } = render(<CalendarScreen token="t" periods={[]} logsVersion={0} onClose={jest.fn()} onOpenDay={jest.fn()} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const labels = [...container.querySelectorAll('button.cal-day')].map(b => b.getAttribute('aria-label')).filter(l => /सिंक की प्रतीक्षा में$/.test(l));
  expect(labels).toHaveLength(1);
  expect(labels[0]).not.toMatch(/waiting/);
  expect(findUntranslated(container, [], hidden)).toEqual([]);
});
