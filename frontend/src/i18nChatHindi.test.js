import React from 'react';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: {
    auth: { status: jest.fn() },
    consents: { get: jest.fn(), set: jest.fn() },
    periods: { list: jest.fn() },
    chat: { history: jest.fn(), send: jest.fn() },
    analysis: { list: jest.fn(), latest: jest.fn(), generate: jest.fn() },
  },
}));

const { API, ApiError, messageFromDetail } = require('./api');
const { setLanguage } = require('./i18n');
const { findUntranslated } = require('./i18n/testUtils');
const { ChatDrawer, AnalysisDrawer, JourneyApp } = require('./App');

const ALLOW = ['MedGemma', 'IST'];
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
  API.chat.history.mockResolvedValue([]);
  hindi();
});
afterEach(english);

const WELCOME = /नमस्ते! 👋 मैं Luna हूँ/;
const chat = () => render(<ChatDrawer token="tok" onClose={jest.fn()} />);

const HISTORY = [
  { id: '1', session_id: 'a', role: 'user', content: 'my first question', created_at: '2026-10-01T10:00:00' },
  { id: '2', session_id: 'a', role: 'assistant', content: 'आपका चक्र सामान्य दिखता है।', created_at: '2026-10-01T10:00:05' },
  { id: '3', session_id: 'b', role: 'user', content: 'second question', created_at: '2026-10-02T10:00:00' },
];

describe('ChatDrawer in Hindi', () => {
  test('welcome message, quick actions, placeholder, send button and disclaimer', async () => {
    const { container } = chat();
    expect(await screen.findByText(WELCOME)).toBeInTheDocument();
    expect(screen.getByText(/आज आपके मन में क्या है\? 💜/)).toBeInTheDocument();
    ['मेरे स्वास्थ्य स्कोर का क्या मतलब है?', 'क्या मेरा चक्र नियमित है?', 'ऐंठन से राहत के लिए सुझाव']
      .forEach(l => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'भेजें' })).toBeInTheDocument();
    expect(screen.getByText(/Luna एक एआई साथी है, डॉक्टर नहीं/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'बातचीत का इतिहास' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'बंद करें' })).toBeInTheDocument();
    noEnglish(container);
  });

  test('empty history and history list states', async () => {
    const empty = chat();
    await screen.findByText(WELCOME);
    expect(empty.container.querySelector('.ch-empty').textContent).toBe('अभी कोई संदेश नहीं।बातचीत शुरू करें।');
    expect(screen.getByRole('button', { name: 'चैट पर वापस जाएँ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'नई चैट' })).toBeInTheDocument();
    noEnglish(empty.container);
    empty.unmount();

    API.chat.history.mockResolvedValue(HISTORY);
    const full = chat();
    expect((await screen.findAllByText('second question')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('my first question').length).toBeGreaterThan(0);
    // the user's own text is not UI, the rest of the drawer has no English left
    noEnglish(full.container);
  });

  test('sending a message posts the typed question and shows AI text as returned', async () => {
    API.chat.send.mockResolvedValue({ session_id: 's1', answer: 'Drink water and rest.' });
    const { container } = chat();
    await screen.findByText(WELCOME);
    userEvent.type(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…'), 'क्या करूँ?');
    userEvent.click(screen.getByRole('button', { name: 'भेजें' }));
    expect(await screen.findByText('Drink water and rest.')).toBeInTheDocument();
    expect(API.chat.send).toHaveBeenCalledWith({ question: 'क्या करूँ?', include_context: true }, 'tok');
    noEnglish(container);
  });

  test('a quick action fills the box with the Hindi text', async () => {
    chat();
    await screen.findByText(WELCOME);
    userEvent.click(screen.getByRole('button', { name: 'क्या मेरा चक्र नियमित है?' }));
    expect(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…')).toHaveValue('क्या मेरा चक्र नियमित है?');
  });

  test('thinking text is chrome, the thought lines are AI content', async () => {
    API.chat.history.mockResolvedValue([
      { id: '1', session_id: 'a', role: 'user', content: 'q', created_at: '2026-10-01T10:00:00' },
      { id: '2', session_id: 'a', role: 'assistant', content: '<think>step one\nstep two</think>Final answer', created_at: '2026-10-01T10:00:05' },
    ]);
    const { container } = chat();
    expect(await screen.findByText('सोच रही हूँ…')).toBeInTheDocument();
    noEnglish(container);
    expect(await screen.findByText('सोचने की प्रक्रिया', {}, { timeout: 4000 })).toBeInTheDocument();
    userEvent.click(screen.getByText('सोचने की प्रक्रिया'));
    expect(screen.getByText('step one')).toBeInTheDocument();
    noEnglish(container);
    english();
    expect(screen.getByText('Thought process')).toBeInTheDocument();
  }, 10000);

  test.each([
    ['429 daily limit', 429, "You've reached today's chat limit. It resets at midnight IST.", /आज की चैट सीमा/],
    ['502 unavailable', 502, 'Luna is unavailable right now. Please try again in a moment.', /Luna अभी उपलब्ध नहीं है/],
  ])('%s error is shown in Hindi', async (_n, status, detail, pattern) => {
    API.chat.send.mockRejectedValue(new ApiError(messageFromDetail(detail, status), { status, detail }));
    const { container } = chat();
    await screen.findByText(WELCOME);
    userEvent.type(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…'), 'hello');
    userEvent.click(screen.getByRole('button', { name: 'भेजें' }));
    await waitFor(() => expect(screen.getAllByText(pattern).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/^⚠ त्रुटि: /).length).toBe(1);
    noEnglish(container);
  });

  test('a consent_required error is shown in Hindi', async () => {
    const detail = { code: 'consent_required', purpose: 'ai_processing' };
    API.chat.send.mockRejectedValue(new ApiError(messageFromDetail(detail, 403), { status: 403, detail }));
    const { container } = chat();
    await screen.findByText(WELCOME);
    userEvent.type(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…'), 'hello');
    userEvent.click(screen.getByRole('button', { name: 'भेजें' }));
    await waitFor(() => expect(screen.getAllByText(/आवश्यक सहमति देखें और स्वीकार करें/).length).toBeGreaterThan(0));
    noEnglish(container);
  });

  test('the stored error row follows a language switch', async () => {
    API.chat.send.mockRejectedValue(new Error('boom'));
    chat();
    await screen.findByText(WELCOME);
    userEvent.type(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…'), 'hello');
    userEvent.click(screen.getByRole('button', { name: 'भेजें' }));
    await waitFor(() => expect(screen.getAllByText('⚠ त्रुटि: boom').length).toBeGreaterThan(0));
    english();
    expect(screen.getAllByText('⚠ Error: boom').length).toBeGreaterThan(0);
  });

  test('a rejection that is not an Error still renders an error row instead of crashing', async () => {
    API.chat.send.mockRejectedValue('nope');
    const { container } = chat();
    await screen.findByText(WELCOME);
    userEvent.type(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…'), 'hello');
    userEvent.click(screen.getByRole('button', { name: 'भेजें' }));
    await waitFor(() => expect(screen.getAllByText(/^⚠ त्रुटि:/).length).toBe(1));
    noEnglish(container);
  });

  test('switching language while open keeps the typed draft and re-renders the welcome', async () => {
    chat();
    await screen.findByText(WELCOME);
    userEvent.type(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…'), 'my draft');
    english();
    expect(screen.getByPlaceholderText('Ask Luna about your cycle…')).toHaveValue('my draft');
    expect(screen.getByText(/Hey there! 👋 I'm Luna/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Is my cycle regular?' })).toBeInTheDocument();
    hindi();
    expect(screen.getByPlaceholderText('Luna से अपने चक्र के बारे में पूछें…')).toHaveValue('my draft');
  });

  test('English is unchanged', async () => {
    english();
    chat();
    expect(await screen.findByText(/What's on your mind today/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask Luna about your cycle…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByText('Luna is an AI companion, not a doctor. For medical concerns, please see a clinician.')).toBeInTheDocument();
    expect(document.querySelector('.ch-empty').textContent).toBe('No messages yet.Start a conversation.');
  });

  test('pseudo-locale renders the drawer', async () => {
    act(() => { setLanguage('en-XA'); });
    chat();
    expect(await screen.findByRole('button', { name: /^S.nd~+$/ })).toBeInTheDocument();
  });
});

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

const analysis = () => render(<AnalysisDrawer token="tok" onClose={jest.fn()} />);

describe('AnalysisDrawer and Insights in Hindi', () => {
  beforeEach(() => {
    API.analysis.list.mockResolvedValue([ANALYSIS]);
    API.analysis.latest.mockResolvedValue(ANALYSIS);
  });

  test('overview: score labels, tiles, headings and disclaimers; AI text as returned', async () => {
    const { container } = analysis();
    expect(await screen.findByText('आपका चक्र काफ़ी नियमित है।', { selector: '.ins-quote' })).toBeInTheDocument();
    expect(screen.getByText('एआई विश्लेषण')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /विश्लेषण चलाएँ/ })).toBeInTheDocument();
    ['औसत चक्र', 'नियमितता'].forEach(l => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText('29 दिन')).toBeInTheDocument();
    ['अगली माहवारी', 'डेटा की गुणवत्ता', 'विश्वसनीयता'].forEach(l => expect(screen.getAllByText(new RegExp(l)).length).toBeGreaterThan(0));
    expect(screen.getByText('उच्च (85%)')).toBeInTheDocument();
    expect(screen.getByText('अच्छी')).toBeInTheDocument();
    ['मुख्य इनसाइट्स', 'यह नतीजा क्यों', 'सुझाव', 'अनुमान संबंधी सूचना', 'आगे क्या हो सकता है', 'अगले कदम', 'डॉक्टर को कब दिखाएँ',
      'चिकित्सीय निष्कर्ष:', 'जोखिम कारक:', 'चिकित्सीय सुझाव:'].forEach(l => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText('चिकित्सीय विश्लेषण (MedGemma)')).toBeInTheDocument();
    expect(screen.getByText(/ध्यान देने की ज़रूरत: उच्च/)).toBeInTheDocument();
    expect(screen.getByText('जल्द ही किसी डॉक्टर या स्वास्थ्य विशेषज्ञ से सलाह लेने पर विचार करें।')).toBeInTheDocument();
    // AI-provided English clinical text is rendered as returned
    expect(screen.getByText('Cycle length varies by two days.')).toBeInTheDocument();
    expect(screen.getByText('आपका औसत चक्र 29 दिन का है।')).toBeInTheDocument();
    noEnglish(container);
    // ...and it is excluded from the check only because it sits in marked containers
    expect(findUntranslated(container, ALLOW, { includeHidden: true })).toEqual([]);
    expect(container.querySelectorAll('[data-i18n-ignore]').length).toBeGreaterThan(8);
  });

  test('no analysis yet: empty state with the action in the sentence', async () => {
    API.analysis.latest.mockResolvedValue(null);
    API.analysis.list.mockResolvedValue([]);
    const { container } = analysis();
    await waitFor(() => expect(container.querySelector('.empty p')).toBeTruthy());
    expect(container.querySelector('.empty p').textContent).toContain('अभी कोई इनसाइट नहीं।');
    expect(container.querySelector('.empty p').textContent).toContain('फिर विश्लेषण चलाएँ पर टैप करें।');
    expect(container.querySelector('.empty strong').textContent).toBe('विश्लेषण चलाएँ');
    noEnglish(container);
  });

  test('history tab: rows, risk flags heading, empty state', async () => {
    const { container } = analysis();
    await screen.findByText('आपका चक्र काफ़ी नियमित है।', { selector: '.ins-quote' });
    userEvent.click(screen.getByRole('button', { name: 'इतिहास' }));
    expect(screen.getByText('चक्र स्वास्थ्य विश्लेषण')).toBeInTheDocument();
    expect(screen.getByText('स्कोर 82/100')).toBeInTheDocument();
    expect(screen.getByText(/^अगली माहवारी: /)).toBeInTheDocument();
    expect(screen.getByText(/जोखिम संकेत:/)).toBeInTheDocument();
    expect(screen.getByText(/Irregular cycle length, Low hydration/)).toBeInTheDocument();
    noEnglish(container);
    expect(container.querySelector('.badge.b-g').textContent).toBe('स्कोर 82/100');
  });

  test('history empty state and the analysis_type value is never translated', async () => {
    API.analysis.list.mockResolvedValue([{ ...ANALYSIS, id: 9, analysis_type: 'custom_type', risk_flags: [], llm_response: null }]);
    const { container } = analysis();
    await screen.findByText('आपका चक्र काफ़ी नियमित है।', { selector: '.ins-quote' });
    userEvent.click(screen.getByRole('button', { name: 'इतिहास' }));
    expect(screen.getByText('custom_type')).toBeInTheDocument();
    API.analysis.list.mockResolvedValue([]);
    const second = analysis();
    await screen.findAllByText('आपका चक्र काफ़ी नियमित है।', { selector: '.ins-quote' });
    userEvent.click(within(second.container).getByRole('button', { name: 'इतिहास' }));
    expect(second.container.querySelector('.empty p').textContent).toContain('अभी तक कोई पिछला विश्लेषण नहीं।');
    noEnglish(second.container);
  });

  test('loading, generating and error states; generate posts the English analysis_type', async () => {
    API.analysis.latest.mockReturnValue(new Promise(() => {}));
    API.analysis.list.mockReturnValue(new Promise(() => {}));
    const first = analysis();
    expect(screen.getByText('विश्लेषण लोड हो रहे हैं…')).toBeInTheDocument();
    noEnglish(first.container);
    first.unmount();

    API.analysis.list.mockResolvedValue([]);
    API.analysis.latest.mockResolvedValue(null);
    let reject;
    API.analysis.generate.mockReturnValue(new Promise((_, r) => { reject = r; }));
    const { container } = analysis();
    await waitFor(() => expect(container.querySelector('.empty p')).toBeTruthy());
    userEvent.click(screen.getByRole('button', { name: /विश्लेषण चलाएँ/ }));
    expect(await screen.findByText('MedGemma चल रहा है…')).toBeInTheDocument();
    expect(screen.getByText('5–15 सेकंड')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /विश्लेषण हो रहा है…/ })).toBeDisabled();
    noEnglish(container);
    expect(API.analysis.generate).toHaveBeenCalledWith({ analysis_type: 'cycle_health' }, 'tok');
    const detail = 'Log at least two periods (about a month apart) so Luna can find your pattern.';
    await act(async () => { reject(new ApiError(messageFromDetail(detail, 400), { status: 400, detail })); });
    expect(await screen.findByText(/कम से कम दो माहवारी दर्ज करें \(लगभग एक महीने के अंतर पर\), ताकि/)).toBeInTheDocument();
    noEnglish(container);
  });

  test('score ring shows the needs-cycles hint when there is no score; dates follow the language', async () => {
    API.analysis.latest.mockResolvedValue({ ...ANALYSIS, cycle_health_score: null });
    const { container } = analysis();
    expect(await screen.findByText('स्कोर के लिए 3+ चक्र ज़रूरी हैं')).toBeInTheDocument();
    noEnglish(container);
    english();
    expect(screen.getByText('Needs 3+ cycles for a score')).toBeInTheDocument();
    expect(screen.getByText('high (85%)', { exact: false })).toBeInTheDocument();
  });

  test('English is unchanged', async () => {
    english();
    analysis();
    await screen.findByText('आपका चक्र काफ़ी नियमित है।', { selector: '.ins-quote' });
    ['AI Analysis', 'Key Insights', 'When to See a Doctor', 'Medical Analysis (MedGemma)', 'Avg Cycle', 'Regularity'].forEach(l => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText('29d')).toBeInTheDocument();
    expect(screen.getByText(/Urgency Level: high/)).toBeInTheDocument();
  });
});

describe('AI consent path still works with the chat in Hindi', () => {
  test('tapping Chat without AI consent asks in Hindi, then opens the Hindi drawer', async () => {
    const consents = { terms_privacy: true, age_18_plus: true, health_data_processing: false, ai_processing: false };
    localStorage.setItem('luna_onboarding_done_u@gmail.com', '1');
    API.consents.get.mockResolvedValue(consents);
    API.consents.set.mockResolvedValue({ ...consents, ai_processing: true });
    API.auth.status.mockResolvedValue({ has_completed_questionnaire: true });
    API.periods.list.mockResolvedValue([]);
    API.analysis.list.mockResolvedValue([]);
    API.analysis.latest.mockResolvedValue(null);
    render(<JourneyApp token="tok" email="u@gmail.com" onLogout={jest.fn()} />);
    userEvent.click(await screen.findByRole('button', { name: /चैट/ }));
    expect(await screen.findByText('अभी नहीं')).toBeInTheDocument();
    expect(findUntranslated(document.querySelector('.modal'), ['Groq', 'Hugging Face'])).toEqual([]);
    userEvent.click(screen.getByRole('button', { name: 'एआई सुविधाओं की अनुमति दें' }));
    expect(await screen.findByText(WELCOME)).toBeInTheDocument();
    expect(API.consents.set).toHaveBeenCalledWith('ai_processing', true, 'tok');
  });
});
