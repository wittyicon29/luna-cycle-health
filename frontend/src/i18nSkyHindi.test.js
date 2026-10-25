import React from 'react';
import { render, screen, act } from '@testing-library/react';

jest.mock('./api', () => ({ API: { logs: { list: jest.fn(), put: jest.fn() } } }));

const { API } = require('./api');
const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const SkyCheckIn = require('./playful/SkyCheckIn').default;
const { localDateString } = require('./localDate');

beforeEach(() => { API.logs.put.mockRejectedValue(new Error('x')); act(() => { setLanguage('hi'); }); });
afterEach(() => { act(() => { setLanguage('en'); }); });

const HI = ['बहुत उदास', 'थोड़ा उदास', 'ठीक', 'अच्छा', 'बहुत बढ़िया'];

test('check-in reads in Hindi with no English left', () => {
  const { container } = render(<SkyCheckIn token="t" logs={{ [localDateString()]: { mood: 4 } }} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()} />);
  expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  expect(screen.getByText('आज का आसमान: अच्छा')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'विवरण जोड़ें' })).toBeInTheDocument();
  expect(findUntranslated(container)).toEqual([]);
  const labels = screen.getAllByRole('radio').map(r => r.textContent);
  expect(labels).toEqual(HI);
  // longest label length, for the 320 px browser check in Task 6
  console.info('longest Hindi sky label length:', Math.max(...HI.map(l => [...l].length)));
});

test('title and error are in Hindi', async () => {
  const { container } = render(<SkyCheckIn token="t" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()} />);
  expect(screen.getByText('आज आपका आसमान कैसा है?')).toBeInTheDocument();
  await act(async () => { screen.getAllByRole('radio')[0].click(); });
  expect(await screen.findByRole('alert')).toHaveTextContent('आपका चेक-इन सहेजा नहीं जा सका। फिर कोशिश करें।');
  expect(findUntranslated(container)).toEqual([]);
});

test('layout wraps at 320 px: no fixed widths', () => {
  render(<SkyCheckIn token="t" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()} />);
  expect(screen.getByRole('radiogroup').style.flexWrap).toBe('wrap');
  screen.getAllByRole('radio').forEach(r => { expect(r.style.minWidth).toBe('0'); expect(r.style.width).toBe(''); });
});
