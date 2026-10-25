import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: {
      register: jest.fn(),
      login: jest.fn(),
      getGoogleAuthUrl: jest.fn(),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
      googleIdToken: jest.fn(),
      googleCallback: jest.fn(),
      status: jest.fn(),
    },
    verify: { resend: jest.fn(), check: jest.fn(), complete: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
  },
}));
jest.mock('./platform', () => ({ isNative: jest.fn(() => false) }));
jest.mock('./nativeGoogle', () => ({ signInWithGoogleNative: jest.fn() }));

const { API, ApiError, messageFromDetail } = require('./api');
const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const { AuthScreen, JourneyApp } = require('./App');
const EmailVerification = require('./EmailVerification').default;
const PasswordReset = require('./PasswordReset').default;
const GoogleCallback = require('./GoogleCallback').default;
const RequiredConsentScreen = require('./RequiredConsentScreen').default;
const AiConsentModal = require('./AiConsentModal').default;
const ConsentCheckboxes = require('./ConsentCheckboxes').default;
const ProfileBanner = require('./ProfileBanner').default;
const { newGoogleState } = require('./googleState');

// The product name and the named AI providers stay in Latin script.
// 'Language' is the switcher's group label (translated in a later task).
const ALLOW = ['Language', 'Luna Health', 'Groq', 'Hugging Face', 'your@gmail.com'];
const hindi = () => act(() => { setLanguage('hi'); });
const english = () => act(() => { setLanguage('en'); });
const noEnglish = container => expect(findUntranslated(container, ALLOW)).toEqual([]);

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.scrollTo = jest.fn();
  window.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  hindi();
});
afterEach(english);

describe('AuthScreen in Hindi', () => {
  test('login tab', () => {
    const { container } = render(<AuthScreen onLogin={jest.fn()} />);
    noEnglish(container);
    expect(screen.getByRole('button', { name: 'साइन इन करें' })).toBeInTheDocument();
    expect(screen.getByText('पासवर्ड भूल गए?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'पासवर्ड दिखाएँ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google के साथ जारी रखें/ })).toBeInTheDocument();
  });

  test('register tab', () => {
    const { container } = render(<AuthScreen onLogin={jest.fn()} initialMode="register" />);
    noEnglish(container);
    expect(screen.getByRole('button', { name: 'खाता बनाएँ' })).toBeDisabled();
    expect(screen.getByText(/पंजीकरण के लिए केवल Gmail पते स्वीकार किए जाते हैं।/)).toBeInTheDocument();
  });

  test('password reset and resend sub-screens', () => {
    const { container } = render(<AuthScreen onLogin={jest.fn()} />);
    userEvent.click(screen.getByText('पासवर्ड भूल गए?'));
    noEnglish(container);
    expect(screen.getByRole('button', { name: 'रीसेट लिंक भेजें' })).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'लॉग इन पर वापस जाएँ' }));
    userEvent.click(screen.getByText('सत्यापन दोबारा भेजें'));
    noEnglish(container);
    expect(screen.getByRole('button', { name: 'सत्यापन ईमेल दोबारा भेजें' })).toBeInTheDocument();
  });

  test('server messages and local errors show in Hindi', async () => {
    API.auth.login.mockRejectedValue(new ApiError(messageFromDetail('Invalid credentials', 401), { status: 401 }));
    const { container } = render(<AuthScreen onLogin={jest.fn()} />);
    userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'a@gmail.com');
    userEvent.type(screen.getByPlaceholderText('•••••••'), 'pw');
    userEvent.click(screen.getByRole('button', { name: 'लॉग इन करें' }));
    expect(await screen.findByText(/ईमेल या पासवर्ड सही नहीं है/)).toBeInTheDocument();
    noEnglish(container);
  });

  test('the response message of a password-reset request is translated when known', async () => {
    API.auth.requestPasswordReset.mockResolvedValue({ message: 'If an account with this email exists, a password reset link has been sent.' });
    render(<AuthScreen onLogin={jest.fn()} />);
    userEvent.click(screen.getByText('पासवर्ड भूल गए?'));
    userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'a@gmail.com');
    userEvent.click(screen.getByRole('button', { name: 'रीसेट लिंक भेजें' }));
    expect(await screen.findByText('यदि इस ईमेल से कोई खाता मौजूद है, तो पासवर्ड रीसेट लिंक भेज दिया गया है।')).toBeInTheDocument();
  });

  test('English text is unchanged', () => {
    english();
    render(<AuthScreen onLogin={jest.fn()} initialMode="register" />);
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByText(/Only Gmail addresses are supported for registration\./)).toBeInTheDocument();
    expect(screen.getByLabelText('I am 18 years of age or older.')).toBeInTheDocument();
  });

  test('the language switcher flips the visible text without remounting', () => {
    english();
    render(<AuthScreen onLogin={jest.fn()} />);
    const email = screen.getByPlaceholderText('your@gmail.com');
    userEvent.type(email, 'keep@gmail.com');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    userEvent.click(screen.getByRole('radio', { name: 'हिन्दी' }));
    expect(screen.getByRole('button', { name: 'साइन इन करें' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('your@gmail.com')).toBe(email);
    expect(email).toHaveValue('keep@gmail.com');
    userEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  test('register payload and consent values are unchanged under Hindi', async () => {
    API.auth.register.mockResolvedValue({ message: 'x' });
    render(<AuthScreen onLogin={jest.fn()} initialMode="register" />);
    userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'new@gmail.com');
    userEvent.click(screen.getByLabelText('मेरी आयु 18 वर्ष या उससे अधिक है।'));
    userEvent.click(screen.getByLabelText(/से सहमत हूँ/));
    const submit = screen.getByRole('button', { name: 'खाता बनाएँ' });
    expect(submit).toBeEnabled();
    userEvent.click(submit);
    await waitFor(() => expect(API.auth.register).toHaveBeenCalled());
    expect(API.auth.register).toHaveBeenCalledWith({ email: 'new@gmail.com', accepted_privacy_policy: true, confirmed_18_plus: true });
    expect(await screen.findByText(/अपना ईमेल देखें/)).toBeInTheDocument();
  });
});

describe('Onboarding tour in Hindi', () => {
  test('every step is translated', async () => {
    const ALL = { terms_privacy: true, age_18_plus: true, health_data_processing: false, ai_processing: true };
    API.consents.get.mockResolvedValue(ALL);
    API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
    API.periods.list.mockResolvedValue([]);
    API.chat.history.mockResolvedValue([]);
    API.analysis.list.mockResolvedValue([]);
    API.analysis.latest.mockResolvedValue(null);
    render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);

    const title = await screen.findByText('अपनी Luna यात्रा को जानें');
    const overlay = title.closest('.modal-ov');
    expect(screen.getByRole('heading', { name: 'अपनी स्वास्थ्य प्रोफ़ाइल बनाएँ' })).toBeInTheDocument();
    for (let i = 0; i < 4; i++) {
      noEnglish(overlay);
      userEvent.click(within(overlay).getByRole('button', { name: 'आगे' }));
    }
    noEnglish(overlay);
    expect(screen.getByRole('heading', { name: 'Luna से चैट करें' })).toBeInTheDocument();
    expect(within(overlay).getByRole('button', { name: 'पीछे' })).toBeInTheDocument();
    expect(within(overlay).getByRole('button', { name: 'हो गया' })).toBeInTheDocument();
    expect(within(overlay).getByText('स्वागत टूर')).toBeInTheDocument();
  });
});

function within(el) { return require('@testing-library/react').within(el); }

describe('EmailVerification in Hindi', () => {
  function page(url) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/verify-email" element={<EmailVerification />} /></Routes>
      </MemoryRouter>
    );
  }

  test('checking, complete form and validation errors', async () => {
    API.verify.check.mockResolvedValue({ email: 'u@gmail.com' });
    const { container } = page('/verify-email?token=t1');
    noEnglish(container);
    expect(screen.getByText('आपका लिंक जाँचा जा रहा है...')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'अपना पासवर्ड चुनें' });
    noEnglish(container);
    userEvent.type(screen.getByLabelText('नया पासवर्ड'), 'abc');
    userEvent.click(screen.getByRole('button', { name: 'मेरा खाता बनाएँ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('कम से कम 8 अक्षर रखें');
  });

  test('dead link from the server', async () => {
    API.verify.check.mockRejectedValue(new ApiError(messageFromDetail('This link is invalid, expired or already used. If you already chose a password, please log in.', 400), { status: 400 }));
    const { container } = page('/verify-email?token=dead');
    await screen.findByText('लिंक में समस्या');
    noEnglish(container);
    expect(screen.getByText(/यह लिंक अमान्य है/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'साइन इन पर वापस जाएँ' })).toBeInTheDocument();
  });

  test('a missing token follows the language switcher', async () => {
    const { container } = page('/verify-email');
    await screen.findByText('सत्यापन लिंक अमान्य है');
    noEnglish(container);
    userEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByText('Invalid verification link')).toBeInTheDocument();
  });
});

describe('PasswordReset in Hindi', () => {
  test('form, mismatch error and success', async () => {
    window.history.pushState({}, '', '/reset-password?token=abc');
    API.auth.resetPassword.mockResolvedValue({ message: 'Password reset successfully! You can now log in.' });
    const { container } = render(<PasswordReset />);
    noEnglish(container);
    expect(screen.getByRole('heading', { name: 'अपना पासवर्ड रीसेट करें' })).toBeInTheDocument();
    userEvent.type(screen.getByPlaceholderText('नया पासवर्ड दर्ज करें'), 'password1');
    userEvent.type(screen.getByPlaceholderText('नए पासवर्ड की पुष्टि करें'), 'password2');
    userEvent.click(screen.getByRole('button', { name: 'पासवर्ड रीसेट करें' }));
    expect(await screen.findByText('पासवर्ड मेल नहीं खाते')).toBeInTheDocument();
    userEvent.clear(screen.getByPlaceholderText('नए पासवर्ड की पुष्टि करें'));
    userEvent.type(screen.getByPlaceholderText('नए पासवर्ड की पुष्टि करें'), 'password1');
    userEvent.click(screen.getByRole('button', { name: 'पासवर्ड रीसेट करें' }));
    expect(await screen.findByRole('heading', { name: 'पासवर्ड सफलतापूर्वक रीसेट हो गया!' })).toBeInTheDocument();
    expect(screen.getByText('पासवर्ड सफलतापूर्वक रीसेट हो गया! अब आप लॉग इन कर सकते हैं।')).toBeInTheDocument();
    noEnglish(container);
  });
});

describe('GoogleCallback in Hindi', () => {
  const renderPage = () => render(<MemoryRouter><GoogleCallback /></MemoryRouter>);

  test('error state', async () => {
    window.history.pushState({}, '', '/auth/google/callback?error=access_denied');
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { name: 'प्रमाणीकरण विफल रहा' })).toBeInTheDocument();
    expect(screen.getByText('Google प्रमाणीकरण रद्द हो गया या विफल रहा')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'लॉग इन पर वापस जाएँ' })).toBeInTheDocument();
    noEnglish(container);
  });

  test('loading, success and no-account states', async () => {
    const state = newGoogleState();
    window.history.pushState({}, '', `/auth/google/callback?code=abc&state=${state}`);
    API.auth.googleCallback.mockRejectedValue(new ApiError('x', { status: 403, detail: { code: 'consent_required', purpose: 'terms_privacy' } }));
    const { container } = renderPage();
    expect(screen.getByText('प्रमाणीकरण पूरा किया जा रहा है...')).toBeInTheDocument();
    noEnglish(container);
    expect(await screen.findByRole('heading', { name: 'पहले अपना खाता बनाएँ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'रजिस्टर पर जाएँ' })).toBeInTheDocument();
    noEnglish(container);
  });
});

describe('consent components in Hindi', () => {
  test('RequiredConsentScreen', () => {
    const { container } = render(<RequiredConsentScreen onSubmit={jest.fn()} onLogout={jest.fn()} />);
    noEnglish(container);
    expect(screen.getByText('आगे बढ़ने से पहले')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'जारी रखें' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'साइन आउट करें' })).toBeInTheDocument();
  });

  test('RequiredConsentScreen shows a Hindi fallback when the error has no text', async () => {
    const onSubmit = jest.fn().mockRejectedValue({});
    render(<RequiredConsentScreen onSubmit={onSubmit} onLogout={jest.fn()} />);
    userEvent.click(screen.getByLabelText('मेरी आयु 18 वर्ष या उससे अधिक है।'));
    userEvent.click(screen.getByLabelText(/से सहमत हूँ/));
    userEvent.click(screen.getByRole('button', { name: 'जारी रखें' }));
    expect(await screen.findByText(/आपका चुनाव सहेजा नहीं जा सका/)).toBeInTheDocument();
  });

  test('AiConsentModal', () => {
    const { container } = render(<AiConsentModal onGrant={jest.fn()} onClose={jest.fn()} />);
    noEnglish(container);
    expect(screen.getByText('एआई सुविधाओं की अनुमति दें?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'अभी नहीं' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'एआई सुविधाओं की अनुमति दें' })).toBeInTheDocument();
  });

  test('ConsentCheckboxes keep their boolean values and link targets', () => {
    const onAdult = jest.fn();
    const onAccepted = jest.fn();
    const { container } = render(<ConsentCheckboxes adult={false} accepted={false} onAdultChange={onAdult} onAcceptedChange={onAccepted} />);
    noEnglish(container);
    userEvent.click(screen.getByLabelText('मेरी आयु 18 वर्ष या उससे अधिक है।'));
    expect(onAdult).toHaveBeenCalledWith(true);
    userEvent.click(screen.getByLabelText(/से सहमत हूँ/));
    expect(onAccepted).toHaveBeenCalledWith(true);
    expect(screen.getByRole('link', { name: 'शर्तें' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'गोपनीयता नीति' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByText(/से सहमत हूँ/).textContent).toBe('मैं शर्तें और गोपनीयता नीति से सहमत हूँ।');
  });

  test('ConsentCheckboxes in English read as before', () => {
    english();
    render(<ConsentCheckboxes adult={false} accepted={false} onAdultChange={jest.fn()} onAcceptedChange={jest.fn()} />);
    expect(screen.getByLabelText(/I agree to the/).closest('label').textContent).toBe('I agree to the Terms and Privacy Policy.');
  });

  test('ProfileBanner', () => {
    const { container } = render(<ProfileBanner onStart={jest.fn()} onLater={jest.fn()} />);
    noEnglish(container);
    expect(screen.getByRole('region', { name: 'स्वास्थ्य प्रोफ़ाइल' })).toBeInTheDocument();
    expect(screen.getByText('बेहतर इनसाइट्स के लिए अपनी स्वास्थ्य प्रोफ़ाइल पूरी करें।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'शुरू करें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'बाद में' })).toBeInTheDocument();
  });
});

describe('messageFromDetail in Hindi', () => {
  test('a known static message is translated', () => {
    expect(messageFromDetail('Email already registered', 400)).toBe('यह ईमेल पहले से पंजीकृत है');
  });
  test('an unknown dynamic message stays English', () => {
    expect(messageFromDetail('Google authentication failed: boom', 400)).toBe('Google authentication failed: boom');
  });
  test('validation arrays: a known message translates after the "Value error, " prefix is stripped', () => {
    expect(messageFromDetail([{ msg: 'Value error, Invalid Gmail address format' }], 422)).toBe('Gmail पते का प्रारूप अमान्य है');
    expect(messageFromDetail([{ msg: 'Value error, Only Gmail addresses are supported for registration' }], 422)).toBe('पंजीकरण के लिए केवल Gmail पते स्वीकार किए जाते हैं');
  });
  test('validation arrays: an unknown message falls back to English', () => {
    expect(messageFromDetail([{ msg: 'String should have at least 8 characters' }], 422)).toBe('String should have at least 8 characters');
    expect(messageFromDetail([{ msg: 'Value error, something new' }], 422)).toBe('something new');
  });
  test('string details with the pydantic prefix are translated too', () => {
    expect(messageFromDetail('Value error, Nothing to update', 422)).toBe('अपडेट करने के लिए कुछ नहीं है');
  });
  test('the consent_required object is translated', () => {
    expect(messageFromDetail({ code: 'consent_required', purpose: 'x' }, 403)).toBe('जारी रखने के लिए कृपया आवश्यक सहमति देखें और स्वीकार करें।');
  });
  test('the generic status text is translated', () => {
    expect(messageFromDetail(undefined, 500)).toBe('त्रुटि 500');
  });
  test('English is unchanged', () => {
    english();
    expect(messageFromDetail('Email already registered', 400)).toBe('Email already registered');
    expect(messageFromDetail(undefined, 500)).toBe('Error 500');
    expect(messageFromDetail({ code: 'consent_required' }, 403)).toBe('Please review and accept the required consent to continue.');
  });
});

describe('busy labels and the Google success state in Hindi', () => {
  const never = () => new Promise(() => {});

  test('Processing… on the sign-in button', () => {
    API.auth.login.mockReturnValue(never());
    const { container } = render(<AuthScreen onLogin={jest.fn()} />);
    userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'a@gmail.com');
    userEvent.type(screen.getByPlaceholderText('•••••••'), 'pw');
    userEvent.click(screen.getByRole('button', { name: 'लॉग इन करें' }));
    expect(screen.getByRole('button', { name: /प्रक्रिया जारी है…/ })).toBeDisabled();
    noEnglish(container);
  });

  test('Sending… on the password-reset request', () => {
    API.auth.requestPasswordReset.mockReturnValue(never());
    const { container } = render(<AuthScreen onLogin={jest.fn()} />);
    userEvent.click(screen.getByText('पासवर्ड भूल गए?'));
    userEvent.type(screen.getByPlaceholderText('your@gmail.com'), 'a@gmail.com');
    userEvent.click(screen.getByRole('button', { name: 'रीसेट लिंक भेजें' }));
    expect(screen.getByRole('button', { name: /भेजा जा रहा है…/ })).toBeDisabled();
    noEnglish(container);
  });

  test('Creating… on the verification form', async () => {
    API.verify.check.mockResolvedValue({ email: 'u@gmail.com' });
    API.verify.complete.mockReturnValue(never());
    const { container } = render(
      <MemoryRouter initialEntries={['/verify-email?token=t1']}>
        <Routes><Route path="/verify-email" element={<EmailVerification />} /></Routes>
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: 'अपना पासवर्ड चुनें' });
    userEvent.type(screen.getByLabelText('नया पासवर्ड'), 'password1');
    userEvent.type(screen.getByLabelText('पासवर्ड की पुष्टि करें'), 'password1');
    userEvent.click(screen.getByLabelText('मेरी आयु 18 वर्ष या उससे अधिक है।'));
    userEvent.click(screen.getByLabelText(/से सहमत हूँ/));
    userEvent.click(screen.getByRole('button', { name: 'मेरा खाता बनाएँ' }));
    expect(await screen.findByRole('button', { name: 'बनाया जा रहा है…' })).toBeDisabled();
    noEnglish(container);
  });

  test('Resetting... on the reset page', () => {
    window.history.pushState({}, '', '/reset-password?token=abc');
    API.auth.resetPassword.mockReturnValue(never());
    const { container } = render(<PasswordReset />);
    userEvent.type(screen.getByPlaceholderText('नया पासवर्ड दर्ज करें'), 'password1');
    userEvent.type(screen.getByPlaceholderText('नए पासवर्ड की पुष्टि करें'), 'password1');
    userEvent.click(screen.getByRole('button', { name: 'पासवर्ड रीसेट करें' }));
    expect(screen.getByRole('button', { name: 'रीसेट हो रहा है...' })).toBeDisabled();
    noEnglish(container);
  });

  test('Saving… on the required-consent screen', () => {
    const { container } = render(<RequiredConsentScreen onSubmit={never} onLogout={jest.fn()} />);
    userEvent.click(screen.getByLabelText('मेरी आयु 18 वर्ष या उससे अधिक है।'));
    userEvent.click(screen.getByLabelText(/से सहमत हूँ/));
    userEvent.click(screen.getByRole('button', { name: 'जारी रखें' }));
    expect(screen.getByRole('button', { name: 'सहेजा जा रहा है…' })).toBeDisabled();
    noEnglish(container);
  });

  test('Google callback success', async () => {
    const state = newGoogleState();
    window.history.pushState({}, '', `/auth/google/callback?code=abc&state=${state}`);
    API.auth.googleCallback.mockResolvedValue({ access_token: 'a', refresh_token: 'r', user: { email: 'u@gmail.com' } });
    const { container } = render(<MemoryRouter><GoogleCallback /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'प्रमाणीकरण सफल रहा!' })).toBeInTheDocument();
    expect(screen.getByText('आपको डैशबोर्ड पर ले जाया जा रहा है...')).toBeInTheDocument();
    noEnglish(container);
  });
});
