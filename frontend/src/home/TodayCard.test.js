import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({ API: { logs: { list: jest.fn(), put: jest.fn() } } }));
jest.mock('../playful/haptics', () => ({ tick: jest.fn() }));

const { API } = require('../api');
const { savePlayful } = require('../playful/playfulPrefs');
const TodayCard = require('./TodayCard').default;

const base = { token: 't', logs: {}, logsReady: true, onSaved: jest.fn(), onAddDetails: jest.fn(),
  cycleDay: 26, daysToNext: 4, avgCycle: 28, periodsCount: 3, phaseName: 'Luteal', phaseColor: '#aaa', profilePrompt: null };

beforeEach(() => {
  savePlayful('normal');
  base.onSaved.mockClear(); base.onAddDetails.mockClear();
  API.logs.list.mockReset().mockResolvedValue([]);
  API.logs.put.mockReset().mockResolvedValue({});
});

const chevron = () => screen.getByRole('button', { name: /(Show|Hide) today's details/ });
const panelQ = () => screen.queryByRole('region', { name: /Today's details/ });

test('collapsed: summary, five weather radios, no stats panel', () => {
  render(<TodayCard {...base} />);
  expect(screen.getByText(/Day 26 · Luteal/)).toBeInTheDocument();
  expect(screen.getByText(/4d/)).toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(panelQ()).toBeNull();
  const c = screen.getByRole('button', { name: /Show today's details/ });
  expect(c).toHaveAttribute('aria-expanded', 'false');
  expect(c).not.toHaveAttribute('aria-controls');
});

test('expanding shows the five stats; Escape closes and returns focus to the chevron', async () => {
  render(<TodayCard {...base} />);
  const chev = screen.getByRole('button', { name: /Show today's details/ });
  await userEvent.click(chev);
  const panel = screen.getByRole('region', { name: /Today's details/ });
  expect(chev).toHaveAttribute('aria-controls', panel.id);
  for (const l of ['Cycle Day', 'Next in', 'Avg Cycle', 'Logged', 'Phase']) expect(within(panel).getByText(l)).toBeInTheDocument();
  expect(within(panel).getByText('28')).toBeInTheDocument();
  expect(within(panel).getByText('3')).toBeInTheDocument();
  expect(within(panel).getByText('Luteal')).toBeInTheDocument();
  within(panel).getByRole('button', { name: 'Add details' }).focus();
  expect(chev).not.toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(panelQ()).toBeNull();
  expect(chev).toHaveFocus();
});

test('outside pointerdown closes; pointerdown inside the panel does not', async () => {
  render(<TodayCard {...base} />);
  await userEvent.click(chevron());
  fireEvent.pointerDown(screen.getByRole('region', { name: /Today's details/ }));
  expect(panelQ()).not.toBeNull();
  fireEvent.pointerDown(document.body);
  expect(panelQ()).toBeNull();
});

test('a second tap on the chevron closes', async () => {
  render(<TodayCard {...base} />);
  await userEvent.click(chevron());
  expect(chevron()).toHaveAttribute('aria-expanded', 'true');
  expect(chevron()).toHaveAccessibleName(/Hide today's details/);
  await userEvent.click(chevron());
  expect(panelQ()).toBeNull();
  expect(chevron()).toHaveAttribute('aria-expanded', 'false');
});

test('missing data omits parts: no cycleDay/daysToNext -> no "Day", "NaN" or "undefined" text', async () => {
  const { container } = render(<TodayCard {...base} cycleDay={null} daysToNext={undefined} />);
  expect(container.querySelector('.today-sum').textContent).toBe('');
  await userEvent.click(chevron());
  const text = container.textContent;
  expect(text).not.toMatch(/Day \d|NaN|undefined|null/);
  expect(within(panelQ()).getAllByText('—')).toHaveLength(2);
});

test('profile prompt appears in the panel only when profilePrompt is set; Start/Later call the handlers', async () => {
  const { unmount } = render(<TodayCard {...base} />);
  await userEvent.click(chevron());
  expect(screen.queryByRole('region', { name: /Health profile/ })).toBeNull();
  unmount();
  const onStart = jest.fn(); const onLater = jest.fn();
  render(<TodayCard {...base} profilePrompt={{ onStart, onLater }} />);
  expect(screen.queryByRole('region', { name: /Health profile/ })).toBeNull(); // not while collapsed
  await userEvent.click(chevron());
  const banner = screen.getByRole('region', { name: /Health profile/ });
  expect(panelQ()).toContainElement(banner);
  await userEvent.click(within(banner).getByRole('button', { name: 'Start' }));
  await userEvent.click(within(banner).getByRole('button', { name: 'Later' }));
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onLater).toHaveBeenCalledTimes(1);
});

test('Add details calls onAddDetails and closes the panel', async () => {
  render(<TodayCard {...base} />);
  await userEvent.click(chevron());
  await userEvent.click(within(panelQ()).getByRole('button', { name: 'Add details' }));
  expect(base.onAddDetails).toHaveBeenCalledTimes(1);
  expect(panelQ()).toBeNull();
});

test('after a check-in the summary shows "Today\'s sky: Good"', async () => {
  const { container } = render(<TodayCard {...base} />);
  expect(container.querySelector('.today-sum').textContent).not.toMatch(/Today's sky/);
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Good' })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(API.logs.put).toHaveBeenCalledTimes(1);
  expect(container.querySelector('.today-sum').textContent).toContain("Today's sky: Good");
});

test('quiet mode: panel has no animation styles; no inline filter/backdrop-filter anywhere in the card', async () => {
  savePlayful('quiet');
  const { container } = render(<TodayCard {...base} />);
  await userEvent.click(chevron());
  const panel = panelQ();
  [panel, ...panel.querySelectorAll('*')].forEach(el => {
    expect(el.getAttribute('style') || '').not.toMatch(/animation|transition/);
  });
  expect(chevron().querySelector('svg').getAttribute('style') || '').not.toMatch(/transition/);
  container.querySelectorAll('*').forEach(el => {
    expect(el.getAttribute('style') || '').not.toMatch(/filter/);
  });
});

test('a pending profile prompt is flagged on the chevron without changing its name', () => {
  render(<TodayCard {...base} profilePrompt={{ onStart: jest.fn(), onLater: jest.fn() }} />);
  const c = screen.getByRole('button', { name: /Show today's details/ });
  expect(c).toHaveAccessibleDescription('Profile incomplete');
});

test('NaN daysToNext and missing phaseName never print NaN or undefined', async () => {
  const { container } = render(<TodayCard {...base} daysToNext={NaN} phaseName={undefined} />);
  expect(container.querySelector('.today-sum').textContent).toBe('');
  await userEvent.click(chevron());
  expect(container.textContent).not.toMatch(/NaN|undefined/);
});
