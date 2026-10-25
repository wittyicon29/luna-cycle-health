import React from 'react';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLN = {
  checkPermissions: jest.fn(), requestPermissions: jest.fn(), createChannel: jest.fn(),
  getPending: jest.fn(), cancel: jest.fn(), removeAllDeliveredNotifications: jest.fn(), schedule: jest.fn(),
};

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: { status: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn(), create: jest.fn(), remove: jest.fn(), prediction: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
    questionnaires: { submit: jest.fn() },
    account: { export: jest.fn(), delete: jest.fn() },
    logs: { list: jest.fn(), put: jest.fn(), remove: jest.fn() },
    medications: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
  },
}));
jest.mock('./platform', () => ({ isNative: jest.fn(() => false) }));
jest.mock('./download', () => ({ downloadJson: jest.fn() }));
jest.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mockLN }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));
jest.mock('./tokenStore', () => ({ ...jest.requireActual('./tokenStore'), getAccessToken: jest.fn(() => 'tok') }));

const { API, ApiError, messageFromDetail } = require('./api');
const { isNative } = require('./platform');
const { getAccessToken } = require('./tokenStore');
const { downloadJson } = require('./download');
const { App: CapApp } = require('@capacitor/app');
const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const { JourneyApp } = require('./App');
const PrivacyPanel = require('./PrivacyPanel').default;
const RemindersPanel = require('./RemindersPanel').default;
const AppearancePanel = require('./AppearancePanel').default;
const CalendarScreen = require('./CalendarScreen').default;
const DaySheet = require('./DaySheet').default;
const MedicationManager = require('./MedicationManager').default;
const launcher = require('./launcherAppearance');
const sched = require('./reminderScheduler');
const { useReminders } = require('./useReminders');
const { DEFAULT_PREFS } = require('./reminderPrefs');

// Luna is the product name; "Health" appears in "Luna Health" (kept in Latin script); "Android" is the platform name.
const ALLOW = ['Health', 'Android'];
const hindi = () => act(() => { setLanguage('hi'); });
const english = () => act(() => { setLanguage('en'); });
const noEnglish = (container, extra = []) => expect(findUntranslated(container, [...ALLOW, ...extra])).toEqual([]);

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
  getAccessToken.mockReturnValue('tok');
  API.consents.get.mockResolvedValue(CONSENTS);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue([]);
  API.periods.prediction.mockResolvedValue({ predicted_next_period: '2026-10-28', earliest: '2026-10-26', latest: '2026-10-30' });
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  API.logs.list.mockResolvedValue([]);
  API.logs.put.mockResolvedValue({});
  API.logs.remove.mockResolvedValue({});
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

// ─── Profile (reached through the journey, like a user would) ───────────────────────────────

const app = () => render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
const openProfile = async () => {
  const utils = app();
  await waitFor(() => expect(document.querySelector('.today-card')).toBeTruthy());
  userEvent.click(screen.getByRole('button', { name: 'प्रोफ़ाइल खोलें' }));
  await screen.findByText('Luna Health सदस्य');
  return { ...utils, drawer: document.querySelector('.drawer') };
};

describe('ProfileDrawer in Hindi', () => {
  test('main view, including the Language block, has no English left', async () => {
    const { drawer } = await openProfile();
    expect(within(drawer).getByText('भाषा')).toBeInTheDocument();
    expect(within(drawer).getByRole('radiogroup', { name: 'भाषा' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'स्वास्थ्य प्रोफ़ाइल अपडेट करें' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'साइन आउट करें' })).toBeInTheDocument();
    // the language names themselves stay in their own language
    expect(within(drawer).getByRole('radio', { name: 'English' })).toBeInTheDocument();
    expect(within(drawer).getByRole('radio', { name: 'हिन्दी' })).toBeInTheDocument();
    noEnglish(drawer);
  });

  test('the Language block switches the whole app, both ways', async () => {
    const { drawer } = await openProfile();
    userEvent.click(within(drawer).getByRole('radio', { name: 'English' }));
    expect(within(drawer).getByText('Language')).toBeInTheDocument();
    expect(within(drawer).getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(within(drawer).getByText('Update Health Profile')).toBeInTheDocument();
    expect(within(drawer).getByText('Privacy & data')).toBeInTheDocument();
    userEvent.click(within(drawer).getByRole('radio', { name: 'हिन्दी' }));
    expect(within(drawer).getByText('गोपनीयता और डेटा')).toBeInTheDocument();
    expect(localStorage.getItem('luna_language')).toBe('hi');
  });

  test('the questionnaire form is fully translated and still posts English values', async () => {
    const { drawer } = await openProfile();
    userEvent.click(within(drawer).getByRole('button', { name: 'स्वास्थ्य प्रोफ़ाइल अपडेट करें' }));
    await within(drawer).findByText('बुनियादी जानकारी');
    ['बुनियादी जानकारी', 'मासिक चक्र का पैटर्न', 'दर्द और लक्षण', 'पीएमएस के लक्षण (0–3)', 'आयु', 'जैविक लिंग', 'आखिरी माहवारी की तारीख *',
      'अतिरिक्त नोट', 'डेटा विश्लेषण के लिए मेरी सहमति है', 'स्वास्थ्य प्रोफ़ाइल सहेजें']
      .forEach(label => expect(within(drawer).getAllByText(label).length).toBeGreaterThan(0));
    expect(within(drawer).getByPlaceholderText('स्वास्थ्य से जुड़ी कोई और जानकारी…')).toBeInTheDocument();
    ['महिला', 'पुरुष', 'अन्य', 'हल्का', 'मध्यम', 'भारी', 'माहवारी से पहले', 'माहवारी के दौरान', 'आंशिक', 'पूरा'].forEach(o =>
      expect(within(drawer).getAllByRole('option', { name: o }).length).toBeGreaterThan(0));
    noEnglish(drawer);

    // stored values are English whatever the language is
    userEvent.selectOptions(within(drawer).getByDisplayValue('मध्यम'), 'heavy');
    fireEvent.change(drawer.querySelector('input[type=date]'), { target: { value: '2026-10-01' } });
    userEvent.click(within(drawer).getByLabelText('डेटा विश्लेषण के लिए मेरी सहमति है'));
    API.questionnaires.submit.mockResolvedValue({
      analysis: { urgency_level: 'routine', next_steps: ['Discuss these findings at your next routine appointment'] },
    });
    fireEvent.submit(drawer.querySelector('form'));
    await within(drawer).findByText('प्रोफ़ाइल सहेजी गई');
    const payload = API.questionnaires.submit.mock.calls[0][0];
    expect(payload.basic_demographic.biological_sex).toBe('female');
    expect(payload.cycle_pattern.bleeding_volume).toBe('heavy');
    expect(payload.pain_symptoms.pain_timing).toBe('during_menses');
    expect(payload.pain_symptoms.painkiller_effectiveness).toBe('partial');
    expect(payload.optional_data.data_consent_given).toBe(true);

    // success view: the rule-based next steps come from the server and are shown as returned
    expect(within(drawer).getByText('आपकी स्वास्थ्य प्रोफ़ाइल अपडेट हो गई है।')).toBeInTheDocument();
    expect(within(drawer).getByText('शुरुआती विश्लेषण')).toBeInTheDocument();
    expect(within(drawer).getByText('Discuss these findings at your next routine appointment')).toBeInTheDocument();
    expect(within(drawer).getByText('Discuss these findings at your next routine appointment')).toHaveAttribute('lang', 'en');
    expect(within(drawer).getByRole('button', { name: 'फिर से अपडेट करें' })).toBeInTheDocument();
    noEnglish(drawer);
  });

  test('the questionnaire intro names the profile path in bold', async () => {
    const { drawer } = await openProfile();
    userEvent.click(within(drawer).getByRole('button', { name: 'स्वास्थ्य प्रोफ़ाइल अपडेट करें' }));
    await within(drawer).findByText('बुनियादी जानकारी');
    expect(drawer.querySelector('form strong')).toHaveTextContent('प्रोफ़ाइल → स्वास्थ्य प्रोफ़ाइल');
    english();
    expect(drawer.querySelector('form strong')).toHaveTextContent('Profile → Health Profile');
  });

  test('form errors follow a language switch', async () => {
    const { drawer } = await openProfile();
    userEvent.click(within(drawer).getByRole('button', { name: 'स्वास्थ्य प्रोफ़ाइल अपडेट करें' }));
    await within(drawer).findByText('बुनियादी जानकारी');
    fireEvent.submit(drawer.querySelector('form'));
    expect(within(drawer).getByText(/आखिरी माहवारी की तारीख आवश्यक है/)).toBeInTheDocument();
    fireEvent.change(drawer.querySelector('input[type=date]'), { target: { value: '2026-10-01' } });
    fireEvent.submit(drawer.querySelector('form'));
    expect(within(drawer).getByText(/सहमति वाले बॉक्स पर निशान लगाएँ/)).toBeInTheDocument();
    english();
    expect(within(drawer).getByText(/Please tick the consent box/)).toBeInTheDocument();
    expect(API.questionnaires.submit).not.toHaveBeenCalled();
  });
});

// ─── PrivacyPanel ────────────────────────────────────────────────────────────────────────────────

describe('PrivacyPanel in Hindi', () => {
  const panel = (props = {}) => render(<PrivacyPanel token="tok" consents={{ ai_processing: true }} onSetConsent={jest.fn().mockResolvedValue({})} onAccountDeleted={jest.fn()} {...props} />);

  test('default state with AI consent on', () => {
    const { container } = panel();
    expect(screen.getByText('गोपनीयता और डेटा')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'एआई सहमति वापस लें' })).toBeInTheDocument();
    expect(screen.getByText('चैट और इनसाइट्स अभी आपका डेटा तीसरे पक्ष की एआई सेवाओं को भेजते हैं।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'मेरा डेटा डाउनलोड करें' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'गोपनीयता नीति' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'शर्तें' })).toHaveAttribute('href', '/terms');
    noEnglish(container);
  });

  test('AI consent off', () => {
    const { container } = panel({ consents: { ai_processing: false } });
    expect(screen.getByRole('button', { name: 'एआई सुविधाओं की अनुमति दें' })).toBeInTheDocument();
    expect(screen.getByText('जब तक आप एआई सुविधाओं की अनुमति नहीं देते, चैट और इनसाइट्स बंद रहेंगे।')).toBeInTheDocument();
    noEnglish(container);
  });

  test('export success message, then it follows a language switch', async () => {
    API.account.export.mockResolvedValue({ ok: 1 });
    downloadJson.mockResolvedValue(true);
    const { container } = panel();
    userEvent.click(screen.getByRole('button', { name: 'मेरा डेटा डाउनलोड करें' }));
    expect(await screen.findByText('आपका डेटा डाउनलोड हो गया।')).toBeInTheDocument();
    noEnglish(container);
    english();
    expect(screen.getByText('Your data was downloaded.')).toBeInTheDocument();
  });

  test('a failure without a message shows the generic Hindi text', async () => {
    API.account.export.mockRejectedValue({});
    const { container } = panel();
    userEvent.click(screen.getByRole('button', { name: 'मेरा डेटा डाउनलोड करें' }));
    expect(await screen.findByText(/कुछ गड़बड़ हो गई/)).toBeInTheDocument();
    noEnglish(container);
  });

  test('delete confirmation: DELETE stays Latin and is still what enables the button', async () => {
    const onAccountDeleted = jest.fn();
    API.account.delete.mockResolvedValue({});
    const { container } = panel({ onAccountDeleted });
    userEvent.click(screen.getByRole('button', { name: 'मेरा खाता हटाएँ' }));
    expect(screen.getByText('इससे आपका खाता और आपका सारा डेटा हमेशा के लिए हट जाएगा। इसे पहले जैसा नहीं किया जा सकता।')).toBeInTheDocument();
    noEnglish(container);
    const confirm = screen.getByRole('button', { name: 'हमेशा के लिए हटाएँ' });
    expect(confirm).toBeDisabled();
    userEvent.type(screen.getByLabelText('पुष्टि के लिए अंग्रेज़ी अक्षरों में DELETE टाइप करें'), 'DELETE');
    expect(confirm).toBeEnabled();
    userEvent.click(confirm);
    await waitFor(() => expect(onAccountDeleted).toHaveBeenCalled());
    expect(API.account.delete).toHaveBeenCalledWith('tok');
  });
});

// ─── RemindersPanel ──────────────────────────────────────────────────────────────────────────────

describe('RemindersPanel in Hindi', () => {
  const ON = { ...DEFAULT_PREFS, periodExpected: { ...DEFAULT_PREFS.periodExpected, enabled: true, daysBefore: 1 }, dailyLog: { ...DEFAULT_PREFS.dailyLog, enabled: true } };
  async function panel(prefs = ON) {
    isNative.mockReturnValue(true);
    const onChange = jest.fn();
    const utils = render(<RemindersPanel prefs={prefs} onChange={onChange} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return { onChange, ...utils };
  }

  test('labels, aria labels and the day options (with a plural form) are Hindi', async () => {
    const { container } = await panel();
    expect(screen.getByText('रिमाइंडर')).toBeInTheDocument();
    expect(screen.getByLabelText('माहवारी जल्द आने वाली है')).toBeChecked();
    expect(screen.getByLabelText('रोज़ का चेक-इन रिमाइंडर')).toBeChecked();
    expect(screen.getByLabelText('माहवारी में देरी पर चेक-इन')).not.toBeChecked();
    expect(screen.getByLabelText('नोटिफ़िकेशन में विवरण दिखाएँ')).toBeInTheDocument();
    expect(screen.getByLabelText('कितने दिन पहले')).toHaveDisplayValue('1 दिन पहले');
    expect(screen.getByRole('option', { name: '7 दिन पहले' })).toBeInTheDocument();
    expect(screen.getByLabelText('माहवारी रिमाइंडर का समय')).toBeInTheDocument();
    expect(screen.getByLabelText('रोज़ के चेक-इन रिमाइंडर का समय')).toBeInTheDocument();
    expect(screen.getByText('रिमाइंडर तय समय के कुछ मिनट के भीतर आते हैं।')).toBeInTheDocument();
    noEnglish(container);
    english();
    expect(screen.getByLabelText('Days before')).toHaveDisplayValue('1 day before');
    expect(screen.getByRole('option', { name: '2 days before' })).toBeInTheDocument();
  });

  test('the permission-denied message is Hindi and follows a language switch', async () => {
    mockLN.checkPermissions.mockResolvedValue({ display: 'denied' });
    mockLN.requestPermissions.mockResolvedValue({ display: 'denied' });
    const { container } = await panel(DEFAULT_PREFS);
    userEvent.click(screen.getByLabelText('माहवारी जल्द आने वाली है'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('फिर दोबारा कोशिश करें');
    noEnglish(container);
    english();
    expect(screen.getByRole('alert')).toHaveTextContent('then try again');
  });

  test('the "notifications are off" warning is Hindi', async () => {
    mockLN.checkPermissions.mockResolvedValue({ display: 'denied' });
    const { container } = await panel(ON);
    expect(await screen.findByText(/ये रिमाइंडर दिखाई नहीं देंगे/)).toBeInTheDocument();
    noEnglish(container);
  });
});

// ─── AppearancePanel ─────────────────────────────────────────────────────────────────────────────

describe('AppearancePanel in Hindi', () => {
  const TILES = [['default', 'Luna Health'], ['notes', 'नोट'], ['planner', 'दैनिक प्लानर'], ['journal', 'जर्नल'], ['checklist', 'चेकलिस्ट'], ['organizer', 'ऑर्गनाइज़र']];

  test('tile labels and hints are Hindi while the English data and stored keys are unchanged', () => {
    isNative.mockReturnValue(true);
    const { container } = render(<AppearancePanel appearance="default" onChange={jest.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    TILES.forEach(([, label], i) => expect(radios[i]).toHaveTextContent(label));
    expect(radios[1]).toHaveTextContent('सादा नोटपैड आइकन');
    expect(launcher.APPEARANCES.map(a => a.label)).toEqual(['Luna Health', 'Notes', 'Daily Planner', 'Journal', 'Checklist', 'Organizer']);
    expect(launcher.appearanceLabel('planner')).toBe('दैनिक प्लानर');
    expect(launcher.appearanceHint('organizer')).toBe('सादा फ़ोल्डर आइकन');
    noEnglish(container);
  });

  test('choosing a tile still applies the English key, and the confirmation names the English launcher label', async () => {
    isNative.mockReturnValue(true);
    const setAppearance = jest.spyOn(launcher, 'setAppearance').mockResolvedValue('notes');
    const onChange = jest.fn();
    const { container } = render(<AppearancePanel appearance="default" onChange={onChange} />);
    userEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByRole('group', { name: 'ऐप का रूप बदलने की पुष्टि' })).toBeInTheDocument();
    // Android's launcher label is English, so that is the name the user must look for
    expect(screen.getByText(/अंग्रेज़ी नाम “Notes” से दिखेगा/)).toBeInTheDocument();
    noEnglish(container, ['Notes']);
    userEvent.click(screen.getByRole('button', { name: 'बदलें' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('notes'));
    expect(setAppearance).toHaveBeenCalledWith('notes');
    expect(await screen.findByText(/हो गया। अपनी ऐप सूची में अंग्रेज़ी नाम “Notes” खोजें/)).toBeInTheDocument();
    noEnglish(container, ['Notes']);
    english();
    expect(screen.getByText(/Done\. Look for “Notes” in your app list/)).toBeInTheDocument();
    setAppearance.mockRestore();
  });
});

// ─── CalendarScreen ──────────────────────────────────────────────────────────────────────────────

describe('CalendarScreen in Hindi', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(2026, 9, 25, 12)); });
  afterEach(() => { jest.useRealTimers(); });
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  test('legend, buttons and day aria labels use the Hindi month and word order', async () => {
    API.logs.list.mockResolvedValue([{ date: '2026-10-24', flow: 'light' }]);
    const onOpenDay = jest.fn();
    const { container } = render(<CalendarScreen token="tok" periods={[]} logsVersion={0} onClose={jest.fn()} onOpenDay={onOpenDay} />);
    await flush();
    expect(screen.getByText('अक्टूबर 2026')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'कैलेंडर' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'पिछला महीना' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'अगला महीना' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'आज दर्ज करें' })).toBeInTheDocument();
    const legend = container.querySelector('.cal-legend');
    ['माहवारी', 'अनुमानित माहवारी', 'दर्ज', 'रक्तस्राव'].forEach(w => expect(legend).toHaveTextContent(w));
    // Hindi order is "day month year", not the English "month day, year"
    expect(screen.getByRole('button', { name: '25 अक्टूबर 2026, आज' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24 अक्टूबर 2026, दर्ज किया गया, रक्तस्राव: हल्का' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^27 अक्टूबर 2026, अनुमानित माहवारी$/ })).toBeInTheDocument();
    noEnglish(container);
    fireEvent.click(screen.getByRole('button', { name: '24 अक्टूबर 2026, दर्ज किया गया, रक्तस्राव: हल्का' }));
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-24');
    english();
    expect(screen.getByRole('button', { name: 'October 24, 2026, logged, flow light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'October 25, 2026, today' })).toBeInTheDocument();
  });

  test('spotting reads naturally in the day label', async () => {
    API.logs.list.mockResolvedValue([{ date: '2026-10-24', flow: 'spotting' }]);
    render(<CalendarScreen token="tok" periods={[]} logsVersion={0} onClose={jest.fn()} onOpenDay={jest.fn()} />);
    await flush();
    expect(screen.getByRole('button', { name: '24 अक्टूबर 2026, दर्ज किया गया, रक्तस्राव: हल्के धब्बे' })).toBeInTheDocument();
    english();
    expect(screen.getByRole('button', { name: 'October 24, 2026, logged, flow spotting' })).toBeInTheDocument();
  });

  test('the load error is Hindi', async () => {
    API.logs.list.mockRejectedValue(new Error('x'));
    const { container } = render(<CalendarScreen token="tok" periods={[]} logsVersion={0} onClose={jest.fn()} onOpenDay={jest.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('आपके रिकॉर्ड लोड नहीं हो सके');
    expect(screen.getByRole('button', { name: 'दोबारा कोशिश करें' })).toBeInTheDocument();
    noEnglish(container);
  });
});

// ─── DaySheet ────────────────────────────────────────────────────────────────────────────────────

describe('DaySheet in Hindi', () => {
  const DATE = '2026-10-24';
  const MEDS = [{ id: 'm1', name: 'Iron', archived: false }, { id: 'm2', name: 'OldPill', archived: true }];
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 25, 12));
    API.medications.list.mockResolvedValue(MEDS);
  });
  afterEach(() => { jest.useRealTimers(); });
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
  async function sheet(date = DATE) {
    const onClose = jest.fn(); const onSaved = jest.fn();
    const utils = render(<DaySheet token="tok" date={date} onClose={onClose} onSaved={onSaved} />);
    await flush();
    return { onClose, onSaved, ...utils };
  }

  test('mood faces, chips, steppers and sections are Hindi', async () => {
    const { container } = await sheet();
    expect(screen.getByRole('dialog', { name: '24 अक्टूबर 2026 का रिकॉर्ड' })).toBeInTheDocument();
    ['बहुत उदास', 'थोड़ा उदास', 'ठीक', 'अच्छा', 'बहुत बढ़िया'].forEach(m => expect(screen.getByRole('radio', { name: m })).toBeInTheDocument());
    ['ऐंठन', 'पेट फूलना', 'सिरदर्द', 'थकान', 'मूड में बदलाव', 'मुँहासे', 'कमर दर्द', 'जी मिचलाना', 'स्तनों में दर्द', 'नींद न आना']
      .forEach(s => expect(screen.getByRole('button', { name: s })).toBeInTheDocument());
    ['स्पॉटिंग (हल्के धब्बे)', 'हल्का', 'मध्यम', 'भारी'].forEach(f => expect(screen.getByRole('button', { name: f })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'नींद के घंटे बढ़ाएँ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'पानी के गिलास घटाएँ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'मेरी सूची प्रबंधित करें' })).toBeInTheDocument();
    expect(screen.getByLabelText('नोट')).toBeInTheDocument();
    expect(screen.getByText('सहेजने के लिए अभी कुछ नहीं है।')).toBeInTheDocument();
    noEnglish(container);
  });

  test('the saved payload keeps English keys and values', async () => {
    const { container, onSaved } = await sheet();
    fireEvent.click(screen.getByRole('button', { name: 'ऐंठन' }));
    fireEvent.click(screen.getByRole('button', { name: 'स्पॉटिंग (हल्के धब्बे)' }));
    fireEvent.click(screen.getByRole('radio', { name: 'अच्छा' }));
    fireEvent.click(screen.getByRole('button', { name: 'नींद के घंटे बढ़ाएँ' }));
    expect(screen.getByLabelText('नींद के घंटे: मान')).toHaveTextContent('7 घंटे');
    fireEvent.click(screen.getByLabelText('Iron'));
    fireEvent.change(screen.getByLabelText('नोट'), { target: { value: 'मेरा नोट' } });
    noEnglish(container, ['Iron']);
    fireEvent.click(screen.getByRole('button', { name: 'सहेजें' }));
    await flush();
    expect(API.logs.put).toHaveBeenCalledWith(DATE, {
      mood: 4, symptoms: ['cramps'], flow: 'spotting', sleep_hours: 7, medications_taken: ['m1'], note: 'मेरा नोट',
    }, 'tok');
    expect(onSaved).toHaveBeenCalled();
  });

  test('switching language while open keeps every field value and the saved message follows', async () => {
    const { container } = await sheet();
    fireEvent.click(screen.getByRole('button', { name: 'सिरदर्द' }));
    fireEvent.click(screen.getByRole('button', { name: 'भारी' }));
    fireEvent.click(screen.getByRole('button', { name: 'पानी के गिलास बढ़ाएँ' }));
    fireEvent.change(screen.getByLabelText('नोट'), { target: { value: 'draft text' } });
    english();
    expect(screen.getByRole('button', { name: 'headache' })).toHaveClass('on');
    expect(screen.getByRole('button', { name: 'heavy' })).toHaveClass('on');
    expect(screen.getByLabelText('glasses of water value')).toHaveTextContent('1');
    expect(screen.getByLabelText('Note')).toHaveValue('draft text');
    hindi();
    expect(screen.getByRole('button', { name: 'सिरदर्द' })).toHaveClass('on');
    expect(screen.getByLabelText('नोट')).toHaveValue('draft text');
    noEnglish(container, ['Iron']);
  });

  test('loaded values, the archived suffix, the discard prompt and the clear prompt are Hindi', async () => {
    API.logs.list.mockResolvedValue([{ date: DATE, mood: 5, symptoms: ['nausea'], flow: 'heavy', sleep_hours: 7.5, water_glasses: 3, medications_taken: ['m1', 'm2'], note: 'x' }]);
    const { container } = await sheet();
    expect(screen.getByRole('radio', { name: 'बहुत बढ़िया' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('नींद के घंटे: मान')).toHaveTextContent('7.5 घंटे');
    expect(container.textContent).toContain('(संग्रहीत)');
    fireEvent.click(screen.getByRole('button', { name: 'दिन मिटाएँ' }));
    expect(screen.getByText('इस दिन के लिए दर्ज सब कुछ मिटा दें?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'हाँ, मिटाएँ' })).toBeInTheDocument();
    noEnglish(container, ['Iron', 'OldPill']);
    fireEvent.click(screen.getByRole('button', { name: 'रहने दें' }));
    fireEvent.change(screen.getByLabelText('नोट'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'बंद करें' }));
    const prompt = screen.getByRole('alertdialog', { name: 'बदलाव छोड़ दें?' });
    expect(within(prompt).getByRole('button', { name: 'संपादन जारी रखें' })).toBeInTheDocument();
    expect(within(prompt).getByRole('button', { name: 'छोड़ दें' })).toBeInTheDocument();
  });

  test('save errors and out-of-range days are Hindi and follow a language switch', async () => {
    // api.js translates the message but keeps the server's own text in rawMessage, which the day sheet branches on
    API.logs.put.mockRejectedValue(new ApiError(messageFromDetail('Date is out of range', 422), { status: 422, rawMessage: 'Date is out of range' }));
    const { container } = await sheet();
    fireEvent.click(screen.getByRole('button', { name: 'ऐंठन' }));
    fireEvent.click(screen.getByRole('button', { name: 'सहेजें' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('इस तारीख का रिकॉर्ड अभी सहेजा नहीं जा सकता');
    noEnglish(container, ['Iron']);
    english();
    expect(screen.getByRole('alert')).toHaveTextContent("That date can't be saved yet");
    hindi();
    const far = render(<DaySheet token="tok" date="2026-12-31" onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(within(far.container).getByRole('alert')).toHaveTextContent('यह दिन अभी दर्ज करने के लिए बहुत आगे है');
    noEnglish(far.container);
  });
});

// ─── MedicationManager ──────────────────────────────────────────────────────────────────────────

describe('MedicationManager in Hindi', () => {
  const MEDS = [{ id: '1', name: 'Iron' }, { id: '2', name: 'Vitamin D' }];
  const ALLOW_NAMES = ['Iron', 'Vitamin'];
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  const manager = (props = {}) => render(<MedicationManager token="tok" medications={MEDS} archivedMedications={[{ id: '3', name: 'OldPill' }]} onChange={jest.fn()} onBack={jest.fn()} {...props} />);

  test('list, buttons and aria labels are Hindi; names are shown as typed', () => {
    const { container } = manager();
    expect(screen.getByText('मेरी दवाएँ')).toBeInTheDocument();
    expect(screen.getByLabelText('दवा जोड़ें')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iron का नाम बदलें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iron को संग्रहीत करें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iron को हटाएँ' })).toBeInTheDocument();
    expect(screen.getByText('संग्रहीत (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OldPill को वापस लाएँ' })).toBeInTheDocument();
    expect(screen.getByText('Iron')).toBeInTheDocument();
    noEnglish(container, [...ALLOW_NAMES, 'OldPill']);
  });

  test('validation, delete confirmation and rename are Hindi, and messages follow a language switch', async () => {
    const { container } = manager();
    fireEvent.click(screen.getByRole('button', { name: 'जोड़ें' }));
    expect(screen.getByRole('alert')).toHaveTextContent('दवा का नाम लिखें।');
    english();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a medication name.');
    hindi();
    fireEvent.change(screen.getByLabelText('दवा जोड़ें'), { target: { value: 'x'.repeat(61) } });
    fireEvent.click(screen.getByRole('button', { name: 'जोड़ें' }));
    expect(screen.getByRole('alert')).toHaveTextContent('नाम अधिकतम 60 अक्षरों का हो सकता है।');
    fireEvent.click(screen.getByRole('button', { name: 'Iron को हटाएँ' }));
    expect(screen.getByText('Iron को हटाएँ? पिछले दिनों के रिकॉर्ड में इसका नाम नहीं दिखेगा।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'हाँ, हटाएँ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'रहने दें' }));
    fireEvent.click(screen.getByRole('button', { name: 'Iron का नाम बदलें' }));
    expect(screen.getByLabelText('Iron का नया नाम')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'नाम सहेजें' })).toBeInTheDocument();
    noEnglish(container, [...ALLOW_NAMES, 'OldPill']);
  });

  test('the 30-medications 422 shows the limit explanation in Hindi', async () => {
    const raw = 'You can keep up to 30 medications. Remove or archive one first.';
    API.medications.create.mockRejectedValueOnce(new ApiError(messageFromDetail(raw, 422), { status: 422, rawMessage: raw }));
    manager();
    fireEvent.change(screen.getByLabelText('दवा जोड़ें'), { target: { value: 'Zinc' } });
    fireEvent.click(screen.getByRole('button', { name: 'जोड़ें' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('आप अधिकतम 30 दवाएँ रख सकते हैं।');
  });

  test('a server failure shows the Hindi generic text; a 409 shows the (already translated) server text', async () => {
    API.medications.create.mockRejectedValueOnce(new Error('boom'));
    manager();
    fireEvent.change(screen.getByLabelText('दवा जोड़ें'), { target: { value: 'Zinc' } });
    fireEvent.click(screen.getByRole('button', { name: 'जोड़ें' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('आपकी दवाओं की सूची अपडेट नहीं हो सकी।');
    API.medications.create.mockRejectedValueOnce(new ApiError(messageFromDetail('You already have a medication with that name', 409), { status: 409, rawMessage: 'You already have a medication with that name' }));
    fireEvent.click(screen.getByRole('button', { name: 'जोड़ें' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('इस नाम की दवा आपकी सूची में पहले से है');
  });
});

// ─── reminder notifications ────────────────────────────────────────────────────────────────────

describe('reminderText in Hindi', () => {
  const explicit = n => ({ ...DEFAULT_PREFS, explicit: true, periodExpected: { ...DEFAULT_PREFS.periodExpected, daysBefore: n } });

  test('neutral wording: the title stays Luna, the body is Hindi', () => {
    expect(sched.reminderText('dailyLog', DEFAULT_PREFS)).toEqual({ title: 'Luna', body: 'आपके चेक-इन का समय हो गया है।' });
    expect(sched.reminderText('periodExpected', null, 'default')).toEqual({ title: 'Luna', body: 'आपके चेक-इन का समय हो गया है।' });
  });

  test('discreet appearance: the generic title is Hindi too', () => {
    expect(sched.reminderText('dailyLog', DEFAULT_PREFS, 'notes')).toEqual({ title: 'रिमाइंडर', body: 'आपके चेक-इन का समय हो गया है।' });
    expect(sched.reminderText('dailyLog', explicit(1), 'journal').title).toBe('रिमाइंडर');
  });

  test('explicit wording per kind, with the day count through tn (0, 1, 2 and 5 days)', () => {
    [0, 1, 2, 5].forEach(n =>
      expect(sched.reminderText('periodExpected', explicit(n))).toEqual({ title: 'Luna', body: `आपकी माहवारी ${n} दिन में आने की उम्मीद है।` }));
    expect(sched.reminderText('lateCheckIn', explicit(2)).body).toBe('आपकी माहवारी में थोड़ी देरी हो सकती है। दर्ज करने या चेक-इन के लिए टैप करें।');
    expect(sched.reminderText('dailyLog', explicit(2)).body).toBe('क्या आपने आज का रिकॉर्ड दर्ज किया?');
  });

  test('English is unchanged', () => {
    english();
    expect(sched.reminderText('dailyLog', DEFAULT_PREFS)).toEqual({ title: 'Luna', body: 'Time for your check-in.' });
    expect(sched.reminderText('dailyLog', DEFAULT_PREFS, 'notes').title).toBe('Reminder');
    expect(sched.reminderText('periodExpected', explicit(1)).body).toBe('Your period is expected in 1 day.');
    expect(sched.reminderText('periodExpected', explicit(0)).body).toBe('Your period is expected in 0 days.');
    expect(sched.reminderText('periodExpected', explicit(5)).body).toBe('Your period is expected in 5 days.');
    expect(sched.reminderText('lateCheckIn', explicit(2)).body).toBe('Your period may be a little late. Tap to log or check in.');
    expect(sched.reminderText('dailyLog', explicit(2)).body).toBe('Have you logged today?');
  });
});

describe('scheduling follows the language', () => {
  const NOW = new Date(2026, 9, 25, 8, 0);
  const prefs = { ...DEFAULT_PREFS, dailyLog: { enabled: true, time: '21:00' } };
  const lastScheduled = () => mockLN.schedule.mock.calls[mockLN.schedule.mock.calls.length - 1][0].notifications;
  const settle = async () => { await act(async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); }); };

  beforeEach(() => { isNative.mockReturnValue(true); jest.useFakeTimers().setSystemTime(NOW); });
  afterEach(async () => { jest.useRealTimers(); await sched.teardownReminders(); });

  test('a rebuild schedules the Hindi text; the channel names stay English', async () => {
    await sched.rebuildReminders({ prefs, now: NOW });
    expect(lastScheduled().length).toBeGreaterThan(0);
    lastScheduled().forEach(n => { expect(n.title).toBe('Luna'); expect(n.body).toBe('आपके चेक-इन का समय हो गया है।'); });
    expect(mockLN.createChannel).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reminders' }));
  });

  test('the appearance replay uses the language that is current when it runs', async () => {
    english();
    await sched.rebuildReminders({ prefs, now: NOW });
    expect(lastScheduled()[0].body).toBe('Time for your check-in.');
    hindi();
    await sched.rebuildRemindersForAppearance('notes');
    expect(lastScheduled()[0]).toEqual(expect.objectContaining({ title: 'रिमाइंडर', body: 'आपके चेक-इन का समय हो गया है।' }));
  });

  test('useReminders: changing the language triggers exactly one debounced rebuild', async () => {
    english();
    const rebuild = mockLN.schedule;
    function Probe(props) { useReminders(props); return null; }
    const periods = [];
    render(<Probe token="tok" periods={periods} prefs={prefs} appearance="default" logsVersion={0} />);
    await act(async () => { jest.advanceTimersByTime(500); });
    await settle();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(lastScheduled()[0].body).toBe('Time for your check-in.');

    hindi();
    await act(async () => { jest.advanceTimersByTime(499); });
    expect(rebuild).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    await settle();
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(lastScheduled()[0].body).toBe('आपके चेक-इन का समय हो गया है।');

    // nothing else is pending
    await act(async () => { jest.advanceTimersByTime(5000); });
    await settle();
    expect(rebuild).toHaveBeenCalledTimes(2);
  });
});
