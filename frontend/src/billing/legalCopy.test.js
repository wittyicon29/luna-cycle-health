import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'fs';
import path from 'path';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  API: { account: { export: jest.fn(), delete: jest.fn() } },
}));
jest.mock('../download', () => ({ downloadJson: jest.fn() }));
jest.mock('../platform', () => ({ isNative: jest.fn(() => true) }));

const { PRIVACY_POLICY, TERMS } = require('./../legalContent');
const { BillingContext, BILLING_OFF } = require('./useBilling');
const PrivacyPanel = require('../PrivacyPanel').default;
const { isNative } = require('../platform');
const { setLanguage } = require('../i18n');
const { findUntranslated } = require('../i18n/testUtils');

const NOTICE = 'Deleting your account does not cancel your Google Play subscription. Cancel it in Google Play first.';

const policyText = JSON.stringify(PRIVACY_POLICY);
const termsText = JSON.stringify(TERMS);

describe('legal copy for the Luna AI plan', () => {
  test('the privacy policy explains how purchases are handled', () => {
    expect(policyText).toContain('Luna AI plan');
    expect(policyText).toMatch(/processed by Google Play/);
    expect(policyText).toMatch(/purchase token/);
    expect(policyText).toMatch(/encrypted/);
    expect(policyText).toMatch(/do not receive your card or UPI details/);
    expect(policyText).toMatch(/Deleting your account does not cancel your Google Play subscription/);
    expect(policyText).toMatch(/refunds follow Google Play/i);
  });

  test('the terms describe the plan without health claims', () => {
    expect(termsText).toContain('Luna AI plan');
    expect(termsText).toMatch(/Insights and Chat/);
    expect(termsText).toMatch(/Cycle tracking stays free/);
    expect(termsText).toMatch(/price .* shown in Google Play/i);
    expect(termsText).toMatch(/cancel .* Google Play/i);
    expect(termsText).toMatch(/not .* medical advice/i);
  });

  test('the policy version is untouched (an owner decision)', () => {
    const backend = fs.readFileSync(path.join(__dirname, '../../../backend/app/core/config.py'), 'utf8');
    expect(backend).toMatch(/PRIVACY_POLICY_VERSION: str = "1\.0"/);
  });
});

describe('delete-account subscription notice', () => {
  const ACTIVE = { enabled: true, active: true, product_id: 'luna_ai_monthly', state: 'active', expires_at: '2027-01-01T00:00:00' };
  const FREE = { enabled: true, active: false };

  function setup(value) {
    const manage = jest.fn().mockResolvedValue(null);
    const ui = (
      <BillingContext.Provider value={value ? { ...BILLING_OFF, ...value, manage } : null}>
        <PrivacyPanel token="tok" consents={{ ai_processing: true }} onSetConsent={jest.fn()} onAccountDeleted={jest.fn()} />
      </BillingContext.Provider>
    );
    const utils = render(ui);
    return { manage, ...utils };
  }

  beforeEach(() => { isNative.mockReturnValue(true); act(() => { setLanguage('en'); }); });
  afterEach(() => { act(() => { setLanguage('en'); }); });

  test('shown with an active plan, and the button calls manage', async () => {
    const { manage } = setup({ enabled: true, status: ACTIVE, hasPlan: true });

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
    await waitFor(() => expect(manage).toHaveBeenCalledTimes(1));
  });

  test('a failed manage shows its message', async () => {
    const { manage } = setup({ enabled: true, status: ACTIVE, hasPlan: true });
    manage.mockResolvedValue({ kind: 'error', text: 'Google Play could not be opened.' });

    userEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Play could not be opened.');
  });

  test.each([
    ['no billing provider', null],
    ['billing switched off', { enabled: false, status: null }],
    ['a free plan', { enabled: true, status: FREE, hasPlan: false }],
  ])('hidden with %s', (name, value) => {
    setup(value);

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).not.toBeInTheDocument();
  });

  // A plan that can still bill or resume (on hold, paused, cancelled but paid through) gets the notice too.
  test.each([
    ['on hold', 'SUBSCRIPTION_STATE_ON_HOLD'],
    ['paused', 'SUBSCRIPTION_STATE_PAUSED'],
    ['cancelled but paid through', 'SUBSCRIPTION_STATE_CANCELED'],
    ['in grace period', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'],
  ])('shown for a plan %s, even when not active', (name, state) => {
    setup({ enabled: true, status: { ...FREE, product_id: 'luna_ai_monthly', state }, hasPlan: true });

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeInTheDocument();
  });

  test('hidden for an expired plan', () => {
    setup({ enabled: true, status: { ...FREE, product_id: 'luna_ai_monthly', state: 'SUBSCRIPTION_STATE_EXPIRED' }, hasPlan: true });

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  test('on the web the notice shows but there is no Play button', () => {
    isNative.mockReturnValue(false);
    setup({ enabled: true, status: ACTIVE, hasPlan: true });

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).not.toBeInTheDocument();
  });

  test('is fully translated in Hindi', () => {
    act(() => { setLanguage('hi'); });
    const { container } = setup({ enabled: true, status: ACTIVE, hasPlan: true });

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'सदस्यता प्रबंधित करें' })).toBeInTheDocument();
    expect(findUntranslated(container)).toEqual([]);
  });
});

describe('owner checklist', () => {
  const file = path.join(__dirname, '../../../docs/superpowers/billing-owner-checklist.md');

  test('documents what the paywall really shows for a trial, and the first-offer rule', () => {
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('Free-trial length and the price after the trial are shown');
    expect(text).toContain('"Free trial available"');
    expect(text).toMatch(/first Play offer/i);
    expect(text).toMatch(/paid introductory offer .*not offered|dropped/i);
  });

  test('makes stripping the plugin\'s token logs a required release step', () => {
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/REQUIRED/);
    expect(text).toContain('minifyEnabled true');
    expect(text).toContain("proguard-android-optimize.txt");
    expect(text).toContain('-assumenosideeffects class android.util.Log');
    expect(text).toContain('public static int d(...);');
    expect(text).toContain('public static int i(...);');
    expect(text).toContain('public static int v(...);');
    expect(text).toContain('-keep public class * extends com.getcapacitor.Plugin');
    expect(text).toContain('ee.forgr.nativepurchases');
  });

  test('exists and covers the required sections', () => {
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    ['BILLING_MODE=google', 'GOOGLE_PLAY_PACKAGE_NAME', 'BILLING_PRODUCT_IDS', 'GOOGLE_PLAY_SERVICE_ACCOUNT_FILE',
      'BILLING_ACCOUNT_SECRET', 'APP_ENV', 'IN_GRACE_PERIOD', 'BILLING_MODE=off', 'PRIVACY_POLICY_VERSION',
      'minSdk', 'Data safety', 'license tester', 'monthly', 'yearly', 'p1m', '/billing/refresh'].forEach(needle => {
      expect(text).toContain(needle);
    });
  });

  test('contains no secrets or real addresses', () => {
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toMatch(/-----BEGIN/);
    expect(text).not.toMatch(/AIza/);
    expect(text).not.toMatch(/ya29/);
    expect(text).not.toMatch(/@gmail/i);
    const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    expect(emails.filter(e => !/example\.(com|org)$/.test(e))).toEqual([]);
  });
});
