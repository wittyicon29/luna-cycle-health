import { newGoogleState, takeGoogleState, buildGoogleRedirect } from './googleState';

beforeEach(() => sessionStorage.clear());

test('newGoogleState returns a random stored value', () => {
  const a = newGoogleState();
  const b = newGoogleState();
  expect(typeof a).toBe('string');
  expect(a.length).toBeGreaterThanOrEqual(16);
  expect(a).not.toBe(b);
  expect(sessionStorage.getItem('luna_google_state')).toBe(b);
});

test('takeGoogleState returns the value once, then null', () => {
  const s = newGoogleState();
  expect(takeGoogleState()).toBe(s);
  expect(takeGoogleState()).toBeNull();
});

test('buildGoogleRedirect adds state and keeps existing params', () => {
  const url = new URL(buildGoogleRedirect('https://accounts.google.com/o/oauth2/auth?client_id=x&scope=a%20b', 'S1'));
  expect(url.searchParams.get('state')).toBe('S1');
  expect(url.searchParams.get('client_id')).toBe('x');
  expect(url.searchParams.get('scope')).toBe('a b');
});
