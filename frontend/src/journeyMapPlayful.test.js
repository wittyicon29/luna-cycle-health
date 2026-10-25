import React from 'react';
import { render, screen, waitFor, act, fireEvent, createEvent } from '@testing-library/react';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: { status: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn(), create: jest.fn(), remove: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
    logs: { list: jest.fn(), put: jest.fn(), remove: jest.fn() },
    medications: { list: jest.fn() },
  },
}));
jest.mock('./platform', () => ({ isNative: jest.fn(() => false) }));

const { API } = require('./api');
const { JourneyApp, JourneyMap } = require('./App');
const { setLanguage } = require('./i18n');
const { savePlayful } = require('./playful/playfulPrefs');

const DAY_W = 34;
const BACK = 90;
const iso = daysAgo => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysAgo);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const PERIODS = [
  { id: 1, start_date: iso(10), end_date: iso(6), flow_intensity: 'heavy', pain_level: 4, symptoms: [], notes: '' },
  { id: 2, start_date: iso(38), end_date: iso(34), flow_intensity: 'light', pain_level: 2, symptoms: [], notes: '' },
];
const MENSTRUAL_NOW = [{ id: 3, start_date: iso(1), end_date: null, flow_intensity: 'light', pain_level: 1, symptoms: [], notes: '' }];

const tipFor = () => document.querySelector('.ph-card-tip');
const mapProps = (over = {}) => ({
  periods: PERIODS, avgCycle: 28, selectedInfo: null, onSelectMarker: jest.fn(), onDismiss: jest.fn(),
  token: 'tok', onPeriodDeleted: jest.fn(), onLogPeriod: jest.fn(), logs: {}, logsReady: true, ...over,
});
const map = over => render(<JourneyMap {...mapProps(over)} />);
const runs = () => [...document.querySelectorAll('.fog-run')];
const span = el => { const l = parseFloat(el.style.left); return [l, l + parseFloat(el.style.width)]; };
const idxOf = daysAgo => BACK - daysAgo;

beforeAll(() => { window.HTMLElement.prototype.scrollTo = jest.fn(); });
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); savePlayful('normal'); setLanguage('en'); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); setLanguage('en'); });

describe('JourneyMap fog', () => {
  test('fog only in the last 30 days and after the first start', () => {
    map();
    const r = runs();
    expect(r.length).toBeGreaterThan(0);
    r.forEach(el => {
      const [a, b] = span(el);
      expect(a).toBeGreaterThanOrEqual(idxOf(30) * DAY_W);
      expect(b).toBeLessThanOrEqual(idxOf(0) * DAY_W);
    });
    // period days (10..6 ago) are clear
    r.forEach(el => {
      const [a, b] = span(el);
      for (let d = 6; d <= 10; d++) expect(idxOf(d) * DAY_W >= a && idxOf(d) * DAY_W < b).toBe(false);
    });
  });
  test('a recent log clears its day', () => {
    map({ logs: { [iso(20)]: { date: iso(20) } } });
    runs().forEach(el => {
      const [a, b] = span(el);
      const x = idxOf(20) * DAY_W;
      expect(x >= a && x < b).toBe(false);
    });
    expect(runs().length).toBe(3);
  });
  test('nothing is fogged while logs are unknown', () => {
    map({ logsReady: false });
    expect(runs()).toHaveLength(0);
  });
  test('fog sits after the road and before the markers and the beacon', () => {
    const { container } = map();
    const kids = [...container.querySelector('.terrain').children];
    const at = sel => kids.findIndex(k => k.matches(sel));
    expect(at('.road')).toBeLessThan(at('.fog'));
    expect(at('.fog')).toBeLessThan(at('.p-dot'));
    expect(at('.fog')).toBeLessThan(at('.beacon'));
    expect(parseInt(container.querySelector('.fog').style.zIndex, 10)).toBeLessThan(10);
  });
  test('tapping fog opens the tapped ISO date, first and last day of a run', () => {
    const onOpenDay = jest.fn();
    map({ onOpenDay });
    const r = runs();
    const run = r[0];
    const [a, b] = span(run);
    fireEvent.click(run, { clientX: 0 });
    fireEvent.click(run, { clientX: b - a - 1 });
    const days = (b - a) / DAY_W;
    expect(onOpenDay).toHaveBeenNthCalledWith(1, iso(BACK - a / DAY_W));
    expect(onOpenDay).toHaveBeenNthCalledWith(2, iso(BACK - a / DAY_W - days + 1));
  });
  test('Enter on fog opens the first day of the run', () => {
    const onOpenDay = jest.fn();
    map({ onOpenDay });
    const run = runs()[1];
    fireEvent.keyDown(run, { key: 'Enter' });
    expect(onOpenDay).toHaveBeenCalledWith(iso(BACK - span(run)[0] / DAY_W));
  });
  test('period markers still render and stay clickable', () => {
    const onSelectMarker = jest.fn();
    const { container } = map({ onSelectMarker });
    const dots = container.querySelectorAll('.p-dot');
    expect(dots.length).toBeGreaterThan(0);
    fireEvent.click(dots[0]);
    expect(onSelectMarker).toHaveBeenCalled();
  });
  test('the hover card still opens', () => {
    const { container } = map();
    fireEvent.mouseEnter(container.querySelectorAll('.phase-bg')[1], { clientX: 100 });
    expect(container.querySelector('.ph-card')).toBeTruthy();
  });
});

const mouse = (el, type, x) => { const ev = createEvent[type](el); Object.defineProperty(ev, 'pageX', { value: x }); fireEvent(el, ev); };

describe('JourneyMap drag and quiet', () => {
  test('a drag-to-scroll does not open a day, a plain click does', async () => {
    const onOpenDay = jest.fn();
    const { container } = map({ onOpenDay });
    const scroll = container.querySelector('.j-scroll');
    const run = runs()[0];
    mouse(scroll, 'mouseDown', 100);
    mouse(scroll, 'mouseMove', 130);
    mouse(scroll, 'mouseUp', 130);
    fireEvent.click(run, { clientX: 0 });
    expect(onOpenDay).not.toHaveBeenCalled();
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    mouse(scroll, 'mouseDown', 100);
    mouse(scroll, 'mouseMove', 103);
    mouse(scroll, 'mouseUp', 103);
    fireEvent.click(run, { clientX: 0 });
    expect(onOpenDay).toHaveBeenCalledTimes(1);
  });
  test('Quiet mode removes lifted fog immediately, with no fog-lift class', () => {
    const props = mapProps({ playfulMode: 'quiet' });
    const { rerender } = render(<JourneyMap {...props} />);
    const before = runs().length;
    rerender(<JourneyMap {...props} logs={{ [iso(20)]: { date: iso(20) } }} />);
    expect(document.querySelector('.fog-lift')).toBeNull();
    expect(runs().length).toBe(before + 1);
  });
  test('fog going away because logs are unknown does not play a lift', () => {
    const props = mapProps();
    const { rerender } = render(<JourneyMap {...props} />);
    rerender(<JourneyMap {...props} logsReady={false} />);
    expect(runs()).toHaveLength(0);
    expect(document.querySelector('.fog-lift')).toBeNull();
  });
});

describe('JourneyMap Luna', () => {
  const LABEL = 'Luna, your companion. Tap to hear a tip.';
  test('stands at today with the accessible label', () => {
    map();
    const btn = screen.getByRole('button', { name: LABEL });
    const wrap = btn.closest('.lc-wrap');
    expect(parseFloat(wrap.style.left)).toBe(BACK * DAY_W - 56 / 2);
    expect(parseInt(wrap.style.zIndex, 10)).toBe(17);
    expect(document.querySelector('.beacon-dot').firstChild).toBeNull();
  });
  test('tap shows the phase tip in a status bubble; Escape and outside click close it', () => {
    map();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(status.querySelector('.lc-bubble')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    expect(screen.getByRole('status')).toBe(status);
    expect(status.querySelector('.lc-bubble')).toBeTruthy();
    expect(status.textContent).toMatch(/\S{3,}/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(status.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    expect(status.querySelector('.lc-bubble')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(status.textContent).toBe('');
  });
  test('the bubble carries the current phase name and tip', () => {
    map({ periods: MENSTRUAL_NOW });
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    const b = screen.getByRole('status');
    expect(b.textContent).toContain('Menstrual');
    expect(b.textContent).toContain('Rest, warmth & gentle movement.');
  });
  test('pointerdown inside the bubble or on Luna does not close it', () => {
    map();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    fireEvent.pointerDown(screen.getByRole('status'));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  const face = () => document.querySelector('[data-face]').getAttribute('data-face');
  test('moods: cozy in menstrual, sleepy at night, happy when just logged', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);
    const { unmount } = map({ periods: MENSTRUAL_NOW });
    expect(face()).toBe('cozy');
    unmount();
    Date.prototype.getHours.mockReturnValue(23);
    const u2 = map({ periods: MENSTRUAL_NOW });
    expect(face()).toBe('sleepy');
    u2.unmount();
    map({ periods: MENSTRUAL_NOW, justLogged: true });
    expect(face()).toBe('happy');
  });
  test('just logged: sparkles in normal mode, none in quiet', () => {
    const { unmount } = map({ justLogged: true });
    expect(document.querySelectorAll('.lc-spark')).toHaveLength(3);
    unmount();
    savePlayful('quiet');
    map({ justLogged: true, playfulMode: 'quiet' });
    expect(document.querySelectorAll('.lc-spark')).toHaveLength(0);
    expect(face()).toBe('happy');
  });
});

describe('JourneyApp logs', () => {
  beforeEach(() => {
    localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
    API.consents.get.mockResolvedValue({ terms_privacy: true, age_18_plus: true, health_data_processing: false, ai_processing: true });
    API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
    API.periods.list.mockResolvedValue(PERIODS);
    API.chat.history.mockResolvedValue([]);
    API.analysis.list.mockResolvedValue([]);
    API.analysis.latest.mockResolvedValue(null);
    API.logs.list.mockResolvedValue([]);
  });
  const app = () => render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
  const ready = () => waitFor(() => expect(document.querySelector('.j-canvas')).toBeTruthy());
  const mapCalls = () => API.logs.list.mock.calls.filter(c => c[0] === iso(90));

  test('loads the 90-day window and sets the journey root playful attribute', async () => {
    const { container } = app();
    await ready();
    await waitFor(() => expect(mapCalls()).toHaveLength(1));
    expect(mapCalls()[0]).toEqual([iso(90), iso(0), 'tok']);
    expect(container.querySelector('[data-playful="normal"]')).toBeTruthy();
    await waitFor(() => expect(runs().length).toBeGreaterThan(0));
  });
  test('a rejected request leaves no fog and no crash', async () => {
    API.logs.list.mockRejectedValue(new Error('down'));
    app();
    await ready();
    await waitFor(() => expect(mapCalls()).toHaveLength(1));
    expect(runs()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Luna, your companion. Tap to hear a tip.' })).toBeInTheDocument();
  });
  const saveFirstFoggedDay = async () => {
    fireEvent.click(runs()[0], { clientX: 0 });
    fireEvent.click(await screen.findByRole('radio', { name: 'Good' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(API.logs.put).toHaveBeenCalled());
  };
  const luna = () => document.querySelector('[data-face]').getAttribute('data-face');

  test('a failed refetch keeps the fog and plays no lift', async () => {
    API.logs.put.mockResolvedValue({});
    API.medications.list.mockResolvedValue([]);
    app();
    await ready();
    await waitFor(() => expect(runs().length).toBe(2));
    API.logs.list.mockImplementation(from => (from === iso(90) ? Promise.reject(new Error('down')) : Promise.resolve([])));
    await saveFirstFoggedDay();
    await waitFor(() => expect(mapCalls()).toHaveLength(2));
    await act(async () => { await Promise.resolve(); });
    expect(runs().length).toBe(2);
    expect(document.querySelector('.fog-lift')).toBeNull();
  });

  test('reloads on a logsVersion change, ignores a stale response, and Luna is happy for 3 seconds', async () => {
    API.logs.put.mockResolvedValue({});
    API.medications.list.mockResolvedValue([]);
    app();
    await ready();
    await waitFor(() => expect(runs().length).toBe(2));

    let resolveSecond;
    API.logs.list.mockImplementation((from) => (from === iso(90) && mapCalls().length === 2
      ? new Promise(r => { resolveSecond = r; })
      : Promise.resolve([])));
    jest.useFakeTimers({ advanceTimers: true });
    await saveFirstFoggedDay();
    await waitFor(() => expect(mapCalls()).toHaveLength(2));
    expect(luna()).toBe('happy');
    expect(document.querySelectorAll('.lc-spark').length).toBe(3);

    // a second save starts a newer request which answers right away with no logs
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await saveFirstFoggedDay();
    await waitFor(() => expect(mapCalls()).toHaveLength(3));
    // the first (older) request now answers with a log: it must be dropped
    await act(async () => { resolveSecond([{ date: iso(20) }]); });
    expect(runs().length).toBe(2);

    act(() => { jest.advanceTimersByTime(3100); });
    expect(luna()).not.toBe('happy');
  });
});
