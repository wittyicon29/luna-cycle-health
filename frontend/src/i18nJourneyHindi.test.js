import React from 'react';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: { status: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn(), create: jest.fn(), remove: jest.fn() },
    chat: { history: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
  },
}));
jest.mock('./platform', () => ({ isNative: jest.fn(() => false) }));

const { API } = require('./api');
const { setLanguage, dateLocale, intlLocale } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const { JourneyApp, LogModal } = require('./App');
const PeriodDelete = require('./PeriodDelete').default;
const { downloadJson } = require('./download');

// Luna is the product name. The sample e-mail address is skipped by the helper.
const ALLOW = ['Language'];
const hindi = () => act(() => { setLanguage('hi'); });
const english = () => act(() => { setLanguage('en'); });
const noEnglish = container => expect(findUntranslated(container, ALLOW)).toEqual([]);

const CONSENTS = { terms_privacy: true, age_18_plus: true, health_data_processing: false, ai_processing: true };
const iso = daysAgo => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysAgo);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const PERIODS = [
  { id: 1, start_date: iso(10), end_date: iso(6), flow_intensity: 'heavy', pain_level: 4, symptoms: ['cramps', 'back pain'], notes: '' },
  { id: 2, start_date: iso(38), end_date: iso(34), flow_intensity: 'light', pain_level: 2, symptoms: [], notes: '' },
];

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
  API.consents.get.mockResolvedValue(CONSENTS);
  API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
  API.periods.list.mockResolvedValue(PERIODS);
  API.periods.create.mockResolvedValue({});
  API.periods.remove.mockResolvedValue({});
  API.chat.history.mockResolvedValue([]);
  API.analysis.list.mockResolvedValue([]);
  API.analysis.latest.mockResolvedValue(null);
  hindi();
});
afterEach(english);

const app = () => render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
const ready = async () => { await screen.findByText('चक्र का दिन'); await waitFor(() => expect(document.querySelector('.j-canvas')).toBeTruthy()); };

describe('dateLocale', () => {
  test('English keeps the explicit en locale, Hindi uses the Hindi tag', () => {
    expect(dateLocale('en')).toBe('en');
    expect(dateLocale('en-XA')).toBe('en');
    expect(dateLocale('hi')).toBe('hi-IN-u-nu-latn');
    expect(dateLocale()).toBe('hi-IN-u-nu-latn');
    english();
    expect(dateLocale()).toBe('en');
  });
});

describe('JourneyApp shell in Hindi', () => {
  test('dock, stats tiles, top bar and map have no English left', async () => {
    const { container } = app();
    await ready();
    noEnglish(container);
    const dock = container.querySelector('.dock');
    ['यात्रा', 'कैलेंडर', 'इनसाइट्स', 'चैट', 'प्रोफ़ाइल'].forEach(l => expect(within(dock).getByText(l)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'माहवारी दर्ज करें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'प्रोफ़ाइल खोलें' })).toBeInTheDocument();
    const strip = container.querySelector('.stats-strip');
    ['चक्र का दिन', 'अगली माहवारी', 'औसत चक्र', 'दर्ज', 'चरण'].forEach(l => expect(within(strip).getByText(l)).toBeInTheDocument());
    expect(within(strip).getByText(/^\d+ दिन$/)).toBeInTheDocument();
  });

  test('phase names are translated in the stats tile, top bar and on the map', async () => {
    const { container } = app();
    await ready();
    const phases = ['माहवारी', 'फॉलिक्युलर', 'ओव्यूलेशन', 'ल्यूटियल'];
    const tile = container.querySelector('.st-val-phase').textContent;
    expect(phases).toContain(tile);
    expect(container.querySelector('.cday-badge').textContent).toMatch(new RegExp(`^दिन \\d+ · ${tile}$`));
    expect(container.querySelector('.phase-pill').textContent).toMatch(/घाटी|चढ़ाई|शिखर|वापसी/);
    const labels = [...container.querySelectorAll('.phase-sep-lbl')].map(n => n.textContent);
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach(l => expect(phases.some(p => l.includes(p))).toBe(true));
  });

  test('month labels come from Intl in Hindi and stay English in English', async () => {
    const { container } = app();
    await ready();
    const hi = [...container.querySelectorAll('.month-lbl')].map(n => n.textContent);
    const expectHi = new Intl.DateTimeFormat('hi-IN-u-nu-latn', { month: 'short' }).format(new Date());
    expect(hi).toContain(expectHi);
    expect(hi.every(m => /[^\x00-\x7F]/.test(m))).toBe(true);
    english();
    const en = [...container.querySelectorAll('.month-lbl')].map(n => n.textContent);
    expect(en).toContain(new Date().toLocaleDateString('en', { month: 'short' }));
  });

  test('marker tooltips: logged and predicted', async () => {
    const { container } = app();
    await ready();
    const titles = [...container.querySelectorAll('.p-dot')].map(n => n.getAttribute('title'));
    expect(titles.some(t => /^माहवारी: /.test(t))).toBe(true);
    expect(titles).toContain('अनुमानित माहवारी');
  });

  test('phase hover card and the logged-period card (with delete) are translated', async () => {
    const { container } = app();
    await ready();
    fireEvent.mouseEnter(container.querySelectorAll('.phase-bg')[1], { clientX: 100 });
    const card = container.querySelector('.ph-card');
    expect(card).toBeTruthy();
    noEnglish(card);
    expect(card.querySelector('.ph-card-sub').textContent).toMatch(/^दिन /);

    const dots = [...container.querySelectorAll('.p-dot')].filter(n => !/अनुमानित/.test(n.getAttribute('title')));
    fireEvent.click(dots[0]); // the older entry
    const mk = container.querySelector('.mk-card');
    expect(mk).toBeTruthy();
    expect(within(mk).getByText(/दर्ज की गई माहवारी/)).toBeInTheDocument();
    expect(within(mk).getByText(/^समाप्त: /)).toBeInTheDocument();
    expect(within(mk).getByText(/^दर्द: \d\/10$/)).toBeInTheDocument();
    expect(within(mk).getByText('रक्तस्राव: हल्का')).toBeInTheDocument();
    expect(within(mk).getByRole('button', { name: 'बंद करें' })).toBeInTheDocument();
    noEnglish(mk);
    userEvent.click(within(mk).getByRole('button', { name: 'यह रिकॉर्ड हटाएँ' }));
    noEnglish(mk);
    expect(within(mk).getByRole('button', { name: 'हाँ, हटाएँ' })).toBeInTheDocument();
  });

  test('logged symptoms on the map card show the Hindi label', async () => {
    const { container } = app();
    await ready();
    const dots = [...container.querySelectorAll('.p-dot')].filter(n => !/अनुमानित/.test(n.getAttribute('title')));
    fireEvent.click(dots[dots.length - 1]); // the newest entry
    const mk = container.querySelector('.mk-card');
    expect(within(mk).getByText('ऐंठन')).toBeInTheDocument();
    expect(within(mk).getByText('कमर दर्द')).toBeInTheDocument();
    expect(within(mk).getByText('रक्तस्राव: भारी')).toBeInTheDocument();
  });

  test('empty state', async () => {
    API.periods.list.mockResolvedValue([]);
    const { container } = app();
    await screen.findByText('आपकी यात्रा आपकी पहली माहवारी से शुरू होती है।');
    noEnglish(container);
    expect(screen.getByRole('button', { name: 'माहवारी दर्ज करें' })).toBeInTheDocument();
    expect(container.querySelector('.stats-strip').textContent).toContain('अज्ञात');
  });

  test('profile banner and loading / consent-error states', async () => {
    API.auth.status.mockResolvedValue({ has_completed_questionnaire: false });
    const { container } = app();
    await screen.findByRole('region', { name: 'स्वास्थ्य प्रोफ़ाइल' });
    await ready();
    noEnglish(container);
  });

  test('loading and retry states', async () => {
    API.consents.get.mockRejectedValue(new Error(''));
    const { container, unmount } = app();
    await screen.findByRole('button', { name: 'दोबारा कोशिश करें' });
    expect(screen.getByRole('button', { name: 'साइन आउट करें' })).toBeInTheDocument();
    expect(screen.getByText(/आपकी गोपनीयता सेटिंग लोड नहीं हो सकीं/)).toBeInTheDocument();
    noEnglish(container);
    unmount();
    API.consents.get.mockReturnValue(new Promise(() => {}));
    const second = app();
    expect(screen.getByText('आपकी गोपनीयता सेटिंग लोड हो रही हैं…')).toBeInTheDocument();
    noEnglish(second.container);
  });

  test('English is unchanged', async () => {
    english();
    const { container } = app();
    await screen.findByText('Cycle Day');
    const dock = container.querySelector('.dock');
    ['Journey', 'Calendar', 'Insights', 'Chat', 'Profile'].forEach(l => expect(within(dock).getByText(l)).toBeInTheDocument());
    const strip = container.querySelector('.stats-strip');
    ['Cycle Day', 'Next in', 'Avg Cycle', 'Logged', 'Phase'].forEach(l => expect(within(strip).getByText(l)).toBeInTheDocument());
    expect(within(strip).getByText(/^\d+d$/)).toBeInTheDocument();
    expect(container.querySelector('.cday-badge').textContent).toMatch(/^Day \d+ · (Menstrual|Follicular|Ovulation|Luteal)$/);
    await waitFor(() => expect(container.querySelectorAll('.p-dot').length).toBeGreaterThan(0));
    const titles = [...container.querySelectorAll('.p-dot')].map(n => n.getAttribute('title'));
    expect(titles).toContain('Predicted period');
    expect(titles.some(t => /^Period: /.test(t))).toBe(true);
    expect(screen.getByRole('button', { name: 'Log period' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open profile' })).toBeInTheDocument();
  });

  test('switching language re-renders the shell', async () => {
    const { container } = app();
    await ready();
    english();
    expect(within(container.querySelector('.dock')).getByText('Journey')).toBeInTheDocument();
    hindi();
    expect(within(container.querySelector('.dock')).getByText('यात्रा')).toBeInTheDocument();
  });

  test('pseudo-locale renders every dock label without crashing', async () => {
    act(() => { setLanguage('en-XA'); });
    const { container } = app();
    await screen.findAllByText(/\S/, { selector: '.st-lbl' });
    const dock = container.querySelector('.dock');
    expect(dock.querySelectorAll('.dl')).toHaveLength(5);
    dock.querySelectorAll('.dl').forEach(n => expect(n.textContent.trim().length).toBeGreaterThan(0));
    expect(container.querySelectorAll('.st-lbl')).toHaveLength(5);
  });
});

describe('LogModal in Hindi', () => {
  const modal = () => render(<LogModal token="tok" onClose={jest.fn()} onSave={jest.fn()} />);

  test('form, chips and pattern summary are translated', async () => {
    const { container } = modal();
    await screen.findByText('आपके चक्र आमतौर पर कैसे रहते हैं');
    await screen.findByText('आपके चक्र की आम अवधि');
    noEnglish(container);
    expect(screen.getByText('नई माहवारी दर्ज करें')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'यात्रा में सहेजें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'रद्द करें' })).toBeInTheDocument();
    expect(screen.getByText('आरंभ तिथि *')).toBeInTheDocument();
    expect(screen.getByText('रक्तस्राव की मात्रा')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('कोई और बात जो आपने देखी हो…')).toBeInTheDocument();
    ['ऐंठन', 'पेट फूलना', 'सिरदर्द', 'थकान', 'मूड में बदलाव', 'मुँहासे', 'कमर दर्द', 'जी मिचलाना', 'स्तनों में दर्द', 'नींद न आना']
      .forEach(l => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
    ['हल्का', 'मध्यम', 'भारी'].forEach(l => expect(screen.getByRole('option', { name: l })).toBeInTheDocument());
    expect(screen.getByText(/^आपकी पिछली 2 दर्ज की गई माहवारियों के आधार पर।$/)).toBeInTheDocument();
    expect(screen.getByText('रक्तस्राव के दिन')).toBeInTheDocument();
  });

  test('plural: one logged period uses the singular string', async () => {
    API.periods.list.mockResolvedValue([PERIODS[0]]);
    modal();
    expect(await screen.findByText('आपकी दर्ज की गई 1 माहवारी के आधार पर।')).toBeInTheDocument();
    english();
    expect(screen.getByText('Based on your 1 logged period.')).toBeInTheDocument();
  });

  test('plural: English two periods', async () => {
    english();
    modal();
    expect(await screen.findByText('Based on your last 2 logged periods.')).toBeInTheDocument();
  });

  test('clicking Hindi chips still sends the English keys and flow value', async () => {
    modal();
    await screen.findByText('आपके चक्र की आम अवधि');
    userEvent.click(screen.getByRole('button', { name: 'ऐंठन' }));
    userEvent.click(screen.getByRole('button', { name: 'मूड में बदलाव' }));
    userEvent.click(screen.getByRole('button', { name: 'कमर दर्द' }));
    userEvent.click(screen.getByRole('button', { name: 'कमर दर्द' })); // toggled off
    userEvent.selectOptions(screen.getByRole('combobox'), 'heavy');
    userEvent.type(screen.getByPlaceholderText('कोई और बात जो आपने देखी हो…'), 'ठीक है');
    userEvent.click(screen.getByRole('button', { name: 'यात्रा में सहेजें' }));
    await waitFor(() => expect(API.periods.create).toHaveBeenCalled());
    const [body] = API.periods.create.mock.calls[0];
    expect(body.symptoms).toEqual(['cramps', 'mood swings']);
    expect(body.flow_intensity).toBe('heavy');
    expect(body.notes).toBe('ठीक है');
    expect(body.pain_level).toBe(3);
  });

  test('default flow is still medium', async () => {
    modal();
    await screen.findByText('आपके चक्र की आम अवधि');
    userEvent.click(screen.getByRole('button', { name: 'यात्रा में सहेजें' }));
    await waitFor(() => expect(API.periods.create).toHaveBeenCalled());
    expect(API.periods.create.mock.calls[0][0].flow_intensity).toBe('medium');
  });

  test('validation messages are in Hindi', async () => {
    modal();
    await screen.findByText('आपके चक्र की आम अवधि');
    const [start, end] = document.querySelectorAll('input[type=date]');
    fireEvent.change(start, { target: { value: '2026-01-10' } });
    fireEvent.change(end, { target: { value: '2026-01-05' } });
    // the end input has min=start, so change event still fires in jsdom
    userEvent.click(screen.getByRole('button', { name: 'यात्रा में सहेजें' }));
    expect(await screen.findByText(/समाप्ति तिथि आरंभ तिथि से पहले की नहीं हो सकती।/)).toBeInTheDocument();
    fireEvent.change(start, { target: { value: '' } });
    userEvent.click(screen.getByRole('button', { name: 'यात्रा में सहेजें' }));
    expect(await screen.findByText(/आरंभ तिथि आवश्यक है/)).toBeInTheDocument();
  });

  test('a server error is translated when known', async () => {
    const { ApiError, messageFromDetail } = require('./api');
    API.periods.create.mockRejectedValue(new ApiError(messageFromDetail('Date is out of range', 422), { status: 422, rawMessage: 'Date is out of range' }));
    modal();
    await screen.findByText('आपके चक्र की आम अवधि');
    userEvent.click(screen.getByRole('button', { name: 'यात्रा में सहेजें' }));
    expect(await screen.findByText(/तारीख सीमा से बाहर है/)).toBeInTheDocument();
  });

  test('empty-history and load-failure copy', async () => {
    API.periods.list.mockResolvedValue([]);
    const first = modal();
    await screen.findByText(/कुछ माहवारी दर्ज करने के बाद/);
    noEnglish(first.container);
    first.unmount();
    API.periods.list.mockRejectedValue(new Error('boom'));
    modal();
    expect(await screen.findByText(/पिछला डेटा लोड नहीं हो सका \(boom\)/)).toBeInTheDocument();
  });

  test('switching language while open keeps what was typed and chosen', async () => {
    modal();
    await screen.findByText('आपके चक्र की आम अवधि');
    userEvent.click(screen.getByRole('button', { name: 'ऐंठन' }));
    userEvent.selectOptions(screen.getByRole('combobox'), 'heavy');
    userEvent.type(screen.getByPlaceholderText('कोई और बात जो आपने देखी हो…'), 'abc');
    fireEvent.change(document.querySelector('input[type=range]'), { target: { value: '7' } });
    english();
    expect(screen.getByRole('button', { name: 'Save to Journey' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cramps' })).toHaveClass('on');
    expect(screen.getByRole('combobox')).toHaveValue('heavy');
    expect(screen.getByPlaceholderText('Any additional observations…')).toHaveValue('abc');
    expect(document.querySelector('input[type=range]')).toHaveValue('7');
    hindi();
    expect(screen.getByRole('button', { name: 'ऐंठन' })).toHaveClass('on');
    expect(screen.getByPlaceholderText('कोई और बात जो आपने देखी हो…')).toHaveValue('abc');
  });

  test('pseudo-locale renders', async () => {
    act(() => { setLanguage('en-XA'); });
    modal();
    await waitFor(() => expect(document.querySelectorAll('.chip')).toHaveLength(10));
    expect(document.querySelectorAll('.modal-foot button')).toHaveLength(2);
  });
});

describe('PeriodDelete in Hindi', () => {
  test('both steps, busy state and a failed delete', async () => {
    let reject;
    API.periods.remove.mockReturnValue(new Promise((_, r) => { reject = r; }));
    const { container } = render(<PeriodDelete period={{ id: 7 }} token="tok" onDeleted={jest.fn()} />);
    noEnglish(container);
    userEvent.click(screen.getByRole('button', { name: 'यह रिकॉर्ड हटाएँ' }));
    expect(screen.getByText('यह रिकॉर्ड आपकी यात्रा से हटा दिया जाएगा। इसे वापस नहीं लाया जा सकता।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'रद्द करें' })).toBeInTheDocument();
    noEnglish(container);
    userEvent.click(screen.getByRole('button', { name: 'हाँ, हटाएँ' }));
    expect(screen.getByRole('button', { name: 'हटाया जा रहा है…' })).toBeDisabled();
    await act(async () => { reject(new Error('')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('यह रिकॉर्ड हटाया नहीं जा सका');
  });

  test('English is unchanged', () => {
    english();
    render(<PeriodDelete period={{ id: 7 }} token="tok" onDeleted={jest.fn()} />);
    userEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    expect(screen.getByText("This entry will be removed from your journey. This can't be undone.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
  });
});

describe('symptom and flow labels', () => {
  test('unknown values fall back to the stored text', () => {
    const { symptomLabel, flowLabel } = require('./symptoms');
    expect(symptomLabel('something else')).toBe('something else');
    expect(flowLabel('spotting')).toBe('रक्तस्राव: spotting');
    english();
    expect(flowLabel('medium')).toBe('medium flow');
    expect(flowLabel('spotting')).toBe('spotting flow');
    expect(intlLocale()).toBeUndefined();
  });
});

describe('download errors', () => {
  test('the native error messages are translated', async () => {
    const platform = require('./platform');
    platform.isNative.mockReturnValue(true);
    jest.doMock('@capacitor/filesystem', () => ({
      Filesystem: { deleteFile: jest.fn().mockResolvedValue(), writeFile: jest.fn().mockRejectedValue(new Error('x')) },
      Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
    }), { virtual: true });
    jest.doMock('@capacitor/share', () => ({ Share: { share: jest.fn() } }), { virtual: true });
    await expect(downloadJson('a.json', {})).rejects.toThrow('आपका डेटा इस डिवाइस पर सहेजा नहीं जा सका।');
    platform.isNative.mockReturnValue(false);
  });
});

describe('Task 5 gaps: predicted marker, unknown phase card, singular days', () => {
  test('the predicted-period marker card is in Hindi', async () => {
    const { container } = app();
    await ready();
    const predicted = [...container.querySelectorAll('.p-dot')].find(n => n.getAttribute('title') === 'अनुमानित माहवारी');
    expect(predicted).toBeTruthy();
    fireEvent.click(predicted);
    const mk = container.querySelector('.mk-card');
    expect(within(mk).getByText('अनुमानित माहवारी की शुरुआत')).toBeInTheDocument();
    noEnglish(mk);
    english();
    expect(within(container.querySelector('.mk-card')).getByText('Predicted period start')).toBeInTheDocument();
  });

  test('the unknown phase is shown as "अज्ञात" and has no hover card without periods', async () => {
    // With periods every timeline day has a known phase, and with none the card is deliberately suppressed, so the
    // card itself cannot be reached from the UI; the strip label and the suppression are what a user can see.
    API.periods.list.mockResolvedValue([]);
    const { container } = app();
    await screen.findByText('आपकी यात्रा आपकी पहली माहवारी से शुरू होती है।');
    container.querySelectorAll('.phase-bg').forEach(bg => fireEvent.mouseEnter(bg));
    expect(container.querySelector('.ph-card')).toBeNull();
    expect(container.querySelector('.stats-strip').textContent).toContain('अज्ञात');
  });

  test('singular {count} day in Hindi and English', async () => {
    API.periods.list.mockResolvedValue([
      { id: 1, start_date: iso(11), end_date: iso(11), flow_intensity: 'light', pain_level: 1, symptoms: [], notes: '' },
      { id: 2, start_date: iso(10), end_date: iso(10), flow_intensity: 'light', pain_level: 1, symptoms: [], notes: '' },
    ]);
    const { container } = render(<LogModal token="tok" onClose={jest.fn()} onSave={jest.fn()} />);
    await screen.findByText('आपके चक्र की आम अवधि');
    expect(screen.getAllByText('1 दिन')).toHaveLength(2);
    noEnglish(container);
    english();
    expect(screen.getAllByText('1 day')).toHaveLength(2);
  });
});
