import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('./platform', () => ({ isNative: jest.fn(() => false) }));

const { JourneyMap } = require('./App');
const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');

const iso = daysAgo => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysAgo);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const PERIODS = [
  { id: 1, start_date: iso(10), end_date: iso(6), flow_intensity: 'heavy', pain_level: 4, symptoms: [], notes: '' },
  { id: 2, start_date: iso(38), end_date: iso(34), flow_intensity: 'light', pain_level: 2, symptoms: [], notes: '' },
];

beforeAll(() => { window.HTMLElement.prototype.scrollTo = jest.fn(); });
beforeEach(() => { localStorage.clear(); act(() => { setLanguage('hi'); }); });
afterEach(() => { act(() => { setLanguage('en'); }); });

const draw = () => render(
  <JourneyMap periods={PERIODS} avgCycle={28} selectedInfo={null} onSelectMarker={jest.fn()} onDismiss={jest.fn()}
    token="t" onPeriodDeleted={jest.fn()} onLogPeriod={jest.fn()} logs={{}} logsReady />,
);

test('fog labels use the Hindi one/other pair', () => {
  draw();
  const labels = [...document.querySelectorAll('.fog-run')].map(n => n.getAttribute('aria-label'));
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.some(l => /^इन \d+ दिनों की धुंध अभी छँटी नहीं है। कोई दिन जोड़ने के लिए टैप करें।$/.test(l))).toBe(true);
  labels.forEach(l => expect(l).not.toMatch(/Mist/));
});

test('a one-day run reads in the singular form', () => {
  render(
    <JourneyMap periods={PERIODS} avgCycle={28} selectedInfo={null} onSelectMarker={jest.fn()} onDismiss={jest.fn()}
      token="t" onPeriodDeleted={jest.fn()} onLogPeriod={jest.fn()} logsReady
      logs={{ [iso(4)]: { date: iso(4) }, [iso(2)]: { date: iso(2) } }} />,
  );
  // days 5, 3 and 1 ago stay foggy as single days
  expect(screen.getAllByRole('button', { name: 'यहाँ की धुंध अभी छँटी नहीं है। कोई दिन जोड़ने के लिए टैप करें।' }).length).toBeGreaterThan(0);
});

test('Luna button and the open bubble have no English left', () => {
  const { container } = draw();
  const btn = screen.getByRole('button', { name: 'Luna, आपकी साथी। टिप सुनने के लिए टैप करें।' });
  fireEvent.click(btn);
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(findUntranslated(container, ['Luna', 'Language'])).toEqual([]);
});
