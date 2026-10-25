import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LanguageSwitcher from './LanguageSwitcher';
import { setLanguage, getLanguage } from './index';

jest.mock('./catalogs/hi.json', () => ({ English: 'X', 'हिन्दी': 'Y' }));

beforeEach(() => { localStorage.clear(); setLanguage('en'); });
afterEach(() => { act(() => { setLanguage('en'); }); });

test('renders both language names with lang attributes and the current one checked', () => {
  render(<LanguageSwitcher />);
  expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  const en = screen.getByRole('radio', { name: 'English' });
  const hi = screen.getByRole('radio', { name: 'हिन्दी' });
  expect(en).toHaveAttribute('lang', 'en');
  expect(hi).toHaveAttribute('lang', 'hi');
  expect(en).toHaveAttribute('aria-checked', 'true');
  expect(hi).toHaveAttribute('aria-checked', 'false');
});

test('clicking switches the language and updates aria-checked', () => {
  render(<LanguageSwitcher />);
  userEvent.click(screen.getByRole('radio', { name: 'हिन्दी' }));
  expect(getLanguage()).toBe('hi');
  expect(screen.getByRole('radio', { name: 'हिन्दी' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false');
});

test('keyboard Enter and Space activate a button', () => {
  render(<LanguageSwitcher />);
  const hi = screen.getByRole('radio', { name: 'हिन्दी' });
  hi.focus();
  userEvent.keyboard('{enter}');
  expect(getLanguage()).toBe('hi');
  const en = screen.getByRole('radio', { name: 'English' });
  en.focus();
  userEvent.keyboard(' ');
  expect(getLanguage()).toBe('en');
});

test('only the checked radio is in the tab order', () => {
  render(<LanguageSwitcher />);
  expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('radio', { name: 'हिन्दी' })).toHaveAttribute('tabindex', '-1');
});

test('arrow keys move and select with wrap; Home and End jump', () => {
  render(<LanguageSwitcher />);
  const en = () => screen.getByRole('radio', { name: 'English' });
  const hi = () => screen.getByRole('radio', { name: 'हिन्दी' });
  en().focus();
  fireEvent.keyDown(en(), { key: 'ArrowRight' });
  expect(getLanguage()).toBe('hi');
  expect(hi()).toHaveFocus();
  expect(hi()).toHaveAttribute('tabindex', '0');
  expect(en()).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(hi(), { key: 'ArrowRight' });
  expect(getLanguage()).toBe('en');
  expect(en()).toHaveFocus();
  fireEvent.keyDown(en(), { key: 'ArrowLeft' });
  expect(getLanguage()).toBe('hi');
  fireEvent.keyDown(hi(), { key: 'Home' });
  expect(getLanguage()).toBe('en');
  fireEvent.keyDown(en(), { key: 'End' });
  expect(getLanguage()).toBe('hi');
  fireEvent.keyDown(hi(), { key: 'ArrowUp' });
  expect(getLanguage()).toBe('en');
  fireEvent.keyDown(en(), { key: 'ArrowDown' });
  expect(getLanguage()).toBe('hi');
});

test('buttons are 44px tall and opt out of the translation check', () => {
  render(<LanguageSwitcher />);
  screen.getAllByRole('radio').forEach(b => {
    expect(b.style.minHeight).toBe('44px');
    expect(b).toHaveAttribute('data-i18n-ignore');
  });
});

test('language names are never looked up in the catalog', () => {
  act(() => { setLanguage('hi'); });
  render(<LanguageSwitcher />);
  expect(screen.getByText('English')).toBeInTheDocument();
  expect(screen.getByText('हिन्दी')).toBeInTheDocument();
  expect(screen.queryByText('X')).not.toBeInTheDocument();
});
