import React from 'react';
import { render, screen, act } from '@testing-library/react';

const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const PlayfulSettings = require('./playful/PlayfulSettings').default;
const LanguageSwitcher = require('./i18n/LanguageSwitcher').default;

beforeEach(() => { localStorage.clear(); act(() => { setLanguage('hi'); }); });
afterEach(() => { act(() => { setLanguage('en'); }); });

test('title, helper and options are in Hindi with no English left', () => {
  const { container } = render(<PlayfulSettings />);
  expect(screen.getByText('खेल-खेल वाले प्रभाव')).toBeInTheDocument();
  expect(screen.getByText('शांत मोड में Luna का एनिमेशन, चमक और कंपन बंद रहते हैं।')).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: 'खेल-खेल वाले प्रभाव' })).toBeInTheDocument();
  expect(screen.getAllByRole('radio').map(r => r.textContent)).toEqual(['सामान्य', 'शांत']);
  expect(findUntranslated(container, ['Luna'])).toEqual([]);
});

test('language names stay in their own language', () => {
  render(<><PlayfulSettings /><LanguageSwitcher /></>);
  expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'हिन्दी' })).toBeInTheDocument();
});
