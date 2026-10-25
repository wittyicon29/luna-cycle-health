import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// One pass over every main screen in Hindi. The per-screen suites (i18n*Hindi.test.js) check behaviour in depth;
// this file only asserts that no English is left on screen, so a new unwrapped string fails here too.
const mockLN = {
  checkPermissions: jest.fn(), requestPermissions: jest.fn(), createChannel: jest.fn(),
  getPending: jest.fn(), cancel: jest.fn(), removeAllDeliveredNotifications: jest.fn(), schedule: jest.fn(),
};

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: { status: jest.fn(), login: jest.fn(), register: jest.fn(), getGoogleAuthUrl: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn(), create: jest.fn(), remove: jest.fn(), prediction: jest.fn() },
    chat: { history: jest.fn(), send: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
    questionnaires: { submit: jest.fn() },
    account: { export: jest.fn(), delete: jest.fn() },
    logs: { list: jest.fn(), put: jest.fn(), remove: jest.fn() },
    medications: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
  },
}));
jest.mock('./platform', () => ({ isNative: jest.fn(() => false) }));
jest.mock('./nativeGoogle', () => ({ signInWithGoogleNative: jest.fn() }));
jest.mock('./download', () => ({ downloadJson: jest.fn() }));
jest.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mockLN }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));
jest.mock('./tokenStore', () => ({ ...jest.requireActual('./tokenStore'), getAccessToken: jest.fn(() => 'tok') }));

const { API } = require('./api');
const { isNative } = require('./platform');
const { App: CapApp } = require('@capacitor/app');
const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const { AuthScreen, JourneyApp, JourneyMap, LogModal, ChatDrawer, AnalysisDrawer } = require('./App');
const PrivacyPanel = require('./PrivacyPanel').default;
const RemindersPanel = require('./RemindersPanel').default;
const CalendarScreen = require('./CalendarScreen').default;
const DaySheet = require('./DaySheet').default;
const SkyCheckIn = require('./playful/SkyCheckIn').default;
const TodayCard = require('./home/TodayCard').default;
const PlayfulSettings = require('./playful/PlayfulSettings').default;
const MedicationManager = require('./MedicationManager').default;
const { DEFAULT_PREFS } = require('./reminderPrefs');

// Product and provider names stay in Latin script; the fixtures use English medicine names and AI-provided text.
const ALLOW = ['Luna', 'Health', 'Android', 'Groq', 'Hugging Face', 'MedGemma', 'IST', 'Iron', 'Vitamin'];
const hindi = () => act(() => { setLanguage('hi'); });
const english = () => act(() => { setLanguage('en'); });
const noEnglish = container => expect(findUntranslated(container, ALLOW)).toEqual([]);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

const ANALYSIS = {
  id: 7,
  analysis_type: 'cycle_health',
  created_at: '2026-10-20T10:30:00',
  cycle_health_score: 82,
  avg_cycle_length: 29,
  cycle_std_deviation: 1.5,
  risk_flags: ['Irregular cycle length', 'Low hydration'],
  predictions: {
    predicted_next_period: '2026-11-10',
    prediction_range: { earliest: '2026-11-08', latest: '2026-11-12' },
    ovulation_date: '2026-10-27',
    confidence: { level: 'high', percentage: 85 },
    statistics: { data_quality: 'good' },
  },
  medical_analysis: {
    clinical_findings: ['Cycle length varies by two days.'],
    risk_factors: ['Stress may affect timing.'],
    medical_recommendations: ['Discuss changes with a clinician.'],
    urgency: 'high',
  },
  user_report: {
    simple_summary: 'आपका चक्र काफ़ी नियमित है।',
    key_insights: ['आपका औसत चक्र 29 दिन का है।'],
    why_this_result: ['पिछले चक्र लगभग एक जैसे रहे हैं।'],
    recommendations: ['पर्याप्त पानी पिएँ।'],
    prediction_disclaimer: 'ये अनुमान सांख्यिकीय पैटर्न पर आधारित हैं।',
    what_to_expect: 'अगली माहवारी नवंबर के मध्य में आ सकती है।',
    next_steps: ['अगले चक्र के लक्षण दर्ज करें।'],
    when_to_see_doctor: 'अगर दर्द बहुत बढ़ जाए तो डॉक्टर को दिखाएँ।',
  },
  llm_response: JSON.stringify({ user_report: { simple_summary: 'आपका चक्र काफ़ी नियमित है।' } }),
};

const CONSENTS = { terms_privacy: true, age_18_plus: true, health_data_processing: false, ai_processing: true };

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.scrollTo = jest.fn();
  window.scrollTo = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
  isNative.mockReturnValue(false);
  API.consents.get.mockResolvedValue(CONSENTS);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.periods.prediction.mockResolvedValue({ predicted_next_period: '2026-10-28', earliest: '2026-10-26', latest: '2026-10-30' });
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([ANALYSIS]);
  API.analysis.latest.mockResolvedValue(ANALYSIS);
  API.logs.list.mockResolvedValue([]);
  API.medications.list.mockResolvedValue([]);
  CapApp.addListener.mockImplementation(async () => ({ remove: jest.fn() }));
  mockLN.checkPermissions.mockResolvedValue({ display: 'granted' });
  mockLN.requestPermissions.mockResolvedValue({ display: 'granted' });
  mockLN.createChannel.mockResolvedValue(undefined);
  mockLN.getPending.mockResolvedValue({ notifications: [] });
  mockLN.cancel.mockResolvedValue(undefined);
  mockLN.removeAllDeliveredNotifications.mockResolvedValue(undefined);
  mockLN.schedule.mockResolvedValue(undefined);
  hindi();
});
afterEach(english);

describe('Hindi audit: no English left on the main screens', () => {
  test('negative control: an unwrapped English string is flagged', () => {
    const Leaky = () => <div><p>सहेजें</p><button type="button">Save changes</button></div>;
    const { container } = render(<Leaky />);
    expect(findUntranslated(container, ALLOW)).toEqual(['Save changes']);
  });

  test('AuthScreen, sign in and register', () => {
    const login = render(<AuthScreen onLogin={jest.fn()} />);
    noEnglish(login.container);
    login.unmount();
    const register = render(<AuthScreen onLogin={jest.fn()} initialMode="register" />);
    noEnglish(register.container);
  });

  test('JourneyApp shell', async () => {
    const { container } = render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
    await waitFor(() => expect(container.querySelector('.today-card')).toBeTruthy());
    noEnglish(container);
    userEvent.click(container.querySelector('.today-chev'));
    await screen.findByText('चक्र का दिन');
    noEnglish(container);
  });

  test('LogModal', async () => {
    const { container } = render(<LogModal token="tok" onClose={jest.fn()} onSave={jest.fn()} />);
    await flush();
    noEnglish(container);
  });

  test('ChatDrawer', async () => {
    const { container } = render(<ChatDrawer token="tok" onClose={jest.fn()} />);
    await screen.findByText(/नमस्ते! 👋 मैं Luna हूँ/);
    noEnglish(container);
  });

  test('AnalysisDrawer with a mocked analysis', async () => {
    const { container } = render(<AnalysisDrawer token="tok" onClose={jest.fn()} />);
    await screen.findByText('एआई विश्लेषण');
    await flush();
    noEnglish(container);
  });

  test('ProfileDrawer (main view)', async () => {
    render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
    await waitFor(() => expect(document.querySelector('.today-card')).toBeTruthy());
    userEvent.click(screen.getByRole('button', { name: 'प्रोफ़ाइल खोलें' }));
    await screen.findByText('Luna Health सदस्य');
    noEnglish(document.querySelector('.drawer'));
  });

  test('SkyCheckIn', async () => {
    const { container } = render(<SkyCheckIn token="tok" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()} />);
    await flush();
    noEnglish(container);
  });

  test('TodayCard, collapsed and expanded with the profile prompt', async () => {
    const { container } = render(<TodayCard token="tok" logs={{}} logsReady onSaved={jest.fn()} onAddDetails={jest.fn()} onShownChange={jest.fn()}
      cycleDay={12} daysToNext={16} avgCycle={28} periodsCount={3} phaseName="ओव्यूलेशन" phaseColor="#aaa"
      profilePrompt={{ onStart: jest.fn(), onLater: jest.fn() }} />);
    await flush();
    noEnglish(container);
    userEvent.click(container.querySelector('.today-chev'));
    noEnglish(container);
    expect(container.querySelector('.today-panel')).not.toBeNull();
  });

  test('JourneyMap with fog and Luna', async () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 10);
    const p = n => String(n).padStart(2, '0');
    const start = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const periods = [{ id: 1, start_date: start, end_date: null, flow_intensity: 'light', pain_level: 1, symptoms: [], notes: '' }];
    const { container } = render(<JourneyMap periods={periods} avgCycle={28} selectedInfo={null} onSelectMarker={jest.fn()} onDismiss={jest.fn()} token="tok" onPeriodDeleted={jest.fn()} onLogPeriod={jest.fn()} logs={{}} logsReady />);
    await flush();
    expect(container.querySelectorAll('.fog-run').length).toBeGreaterThan(0);
    noEnglish(container);
    userEvent.click(screen.getByRole('button', { name: /Luna, आपकी साथी/ }));
    noEnglish(container);
  });

  test('PlayfulSettings', () => {
    const { container } = render(<PlayfulSettings />);
    noEnglish(container);
  });

  test('PrivacyPanel', async () => {
    const { container } = render(<PrivacyPanel token="tok" consents={{ ai_processing: true }} onSetConsent={jest.fn().mockResolvedValue({})} onAccountDeleted={jest.fn()} />);
    await flush();
    noEnglish(container);
  });

  test('RemindersPanel', async () => {
    isNative.mockReturnValue(true);
    const prefs = { ...DEFAULT_PREFS, periodExpected: { ...DEFAULT_PREFS.periodExpected, enabled: true, daysBefore: 1 }, dailyLog: { ...DEFAULT_PREFS.dailyLog, enabled: true } };
    const { container } = render(<RemindersPanel prefs={prefs} onChange={jest.fn()} />);
    await flush();
    noEnglish(container);
  });

  test('CalendarScreen', async () => {
    const { container } = render(<CalendarScreen token="tok" periods={[]} logsVersion={0} onClose={jest.fn()} onOpenDay={jest.fn()} />);
    await flush();
    noEnglish(container);
  });

  test('DaySheet', async () => {
    const { container } = render(<DaySheet token="tok" date="2026-10-20" onClose={jest.fn()} onSaved={jest.fn()} />);
    await flush();
    noEnglish(container);
  });

  test('MedicationManager', async () => {
    const meds = [{ id: '1', name: 'Iron' }, { id: '2', name: 'Vitamin D' }];
    API.medications.list.mockResolvedValue(meds);
    const { container } = render(<MedicationManager token="tok" medications={meds} archivedMedications={[]} onChange={jest.fn()} onBack={jest.fn()} />);
    await flush();
    noEnglish(container);
  });
});
