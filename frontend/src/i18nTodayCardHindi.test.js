import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({ API: { logs: { list: jest.fn(), put: jest.fn() } } }));

const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const TodayCard = require('./home/TodayCard').default;

beforeEach(() => { act(() => { setLanguage('hi'); }); });
afterEach(() => { act(() => { setLanguage('en'); }); });

test('Today card reads in Hindi with no English left, expanded with a profile prompt', async () => {
  const { container } = render(<TodayCard token="t" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()}
    cycleDay={26} daysToNext={4} avgCycle={28} periodsCount={3} phaseName="ल्यूटियल" phaseColor="#aaa"
    profilePrompt={{ onStart: jest.fn(), onLater: jest.fn() }} />);
  const chev = screen.getByRole('button', { name: 'आज का ब्यौरा दिखाएँ' });
  await userEvent.click(chev);
  expect(screen.getByRole('button', { name: 'आज का ब्यौरा छिपाएँ' })).toBeInTheDocument();
  const panel = screen.getByRole('region', { name: 'आज का ब्यौरा' });
  expect(within(panel).getByRole('button', { name: 'विवरण जोड़ें' })).toBeInTheDocument();
  expect(findUntranslated(container)).toEqual([]);
});
