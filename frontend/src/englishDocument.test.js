import React from 'react';
import { render, act } from '@testing-library/react';
import { useEnglishDocument } from './i18n/useEnglishDocument';
import { setLanguage } from './i18n';

function Page() { useEnglishDocument(); return <div>page</div>; }

afterEach(() => act(() => { setLanguage('en'); }));

test('the document is English while an English-only page is mounted, and the app language returns after', () => {
  act(() => { setLanguage('hi'); });
  expect(document.documentElement.lang).toBe('hi');
  const { unmount } = render(<Page />);
  expect(document.documentElement.lang).toBe('en');
  unmount();
  expect(document.documentElement.lang).toBe('hi');
});

test('a language change while mounted keeps the page English and restores the new language afterwards', () => {
  const { unmount } = render(<Page />);
  act(() => { setLanguage('hi'); });
  expect(document.documentElement.lang).toBe('en');
  unmount();
  expect(document.documentElement.lang).toBe('hi');
});
