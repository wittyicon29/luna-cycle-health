import { saveGoogleConsent, takeGoogleConsent } from './consentFlags';

beforeEach(() => sessionStorage.clear());

test('flags survive the redirect and are cleared once read', () => {
  saveGoogleConsent({ accepted: true, adult: true });

  expect(takeGoogleConsent()).toEqual({ accepted: true, adult: true });
  expect(takeGoogleConsent()).toEqual({ accepted: false, adult: false });
});

test('missing or corrupt storage means no consent', () => {
  expect(takeGoogleConsent()).toEqual({ accepted: false, adult: false });

  sessionStorage.setItem('luna_google_consent', '{not json');
  expect(takeGoogleConsent()).toEqual({ accepted: false, adult: false });
});

test('only an explicit true counts', () => {
  sessionStorage.setItem('luna_google_consent', JSON.stringify({ accepted: 'yes', adult: 1 }));

  expect(takeGoogleConsent()).toEqual({ accepted: false, adult: false });
});
