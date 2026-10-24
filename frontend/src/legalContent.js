import { API_BASE, SUPPORT_EMAIL } from './config';

const accountDeletionUrl = API_BASE.replace(/\/api\/v1$/, '') + '/account-deletion';
const contact = SUPPORT_EMAIL || 'the support address listed in the app store listing';

export const PRIVACY_POLICY = {
  title: 'Privacy Policy',
  updated: '2026-10-24',
  sections: [
    {
      heading: 'Who this is for',
      body: [
        'Luna Health is for people aged 18 and over. If you are under 18, please do not create an account.',
      ],
    },
    {
      heading: 'What we collect',
      body: [
        'Account details: your email address and a securely hashed password (or your Google email if you sign in with Google).',
        'Cycle logs you enter: period dates, flow, pain level, symptoms and notes.',
        'Your health profile (questionnaire answers) and the analyses Luna generates from them.',
        'Messages you send to the Luna chat and Luna\'s replies.',
        'A record of the consents you give or withdraw, with the date and policy version.',
      ],
    },
    {
      heading: 'Why we use it',
      body: [
        'To show your cycle map and predictions, and to give you insights about your patterns.',
        'To run the chat and insights features, only if you allow AI features (see below).',
        'We do not sell your data and we do not show advertising based on your health data.',
      ],
    },
    {
      heading: 'AI features and third-party processing',
      body: [
        'If you allow AI features, Luna sends your messages, a summary of your recent cycle data and your health profile to third-party AI services — Groq (chat) and Hugging Face (health analysis) — to produce a reply. These providers may process the data on servers outside India.',
        'This is optional and separate from creating an account. You can withdraw your consent at any time in Profile → Privacy & data; chat and insights then stop working until you allow them again.',
      ],
    },
    {
      heading: 'How we protect your data',
      body: [
        'Connections to Luna use encryption in transit. Your notes, chat messages, health profile and analysis text are also encrypted at rest.',
        'No system is perfectly secure. If a breach affects your data we will tell you and the authorities as the law requires.',
      ],
    },
    {
      heading: 'Your choices and rights',
      body: [
        'Download: Profile → Privacy & data → Download my data gives you a copy of everything we hold about you.',
        'Delete: Profile → Privacy & data → Delete my account permanently erases your account and all linked data immediately. You can also request deletion at ' + accountDeletionUrl + '.',
        'Withdraw consent: you can withdraw AI-processing consent in the app at any time.',
        'Questions and grievances: contact ' + contact + '. You may also complain to the Data Protection Board of India.',
      ],
    },
    {
      heading: 'Not medical advice',
      body: [
        'Luna provides general information and pattern tracking. It does not diagnose, treat or prevent any condition. For anything that worries you, speak to a qualified doctor.',
      ],
    },
    {
      heading: 'Changes to this policy',
      body: [
        'If we change this policy in a way that matters, we will ask for your consent again where the law requires it.',
      ],
    },
  ],
};

export const TERMS = {
  title: 'Terms of Service',
  updated: '2026-10-24',
  sections: [
    {
      heading: 'Eligibility',
      body: [
        'You must be 18 years of age or older to use Luna Health. By creating an account you confirm that you are.',
      ],
    },
    {
      heading: 'Not medical advice',
      body: [
        'Luna Health is not medical advice and is not a medical device. Predictions, scores and AI replies are estimates based on what you enter and can be wrong. Do not use Luna to decide on treatment, and seek urgent care in an emergency.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'Keep your login details private. You are responsible for activity under your account. You can delete your account at any time from Profile → Privacy & data.',
      ],
    },
    {
      heading: 'Acceptable use',
      body: [
        'Do not misuse the service: no attempts to break its security, scrape other people\'s data, overload it or use it unlawfully.',
      ],
    },
    {
      heading: 'AI features',
      body: [
        'AI replies are generated automatically and may be inaccurate or incomplete. They are available only if you allow AI features, and daily usage limits may apply.',
      ],
    },
    {
      heading: 'Changes and contact',
      body: [
        'We may update these terms and will tell you about material changes. Questions: ' + contact + '.',
      ],
    },
  ],
};
