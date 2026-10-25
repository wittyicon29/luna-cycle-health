// Google OAuth callback page
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from './api';
import { injectStyles } from './App';
import { takeGoogleConsent } from './consentFlags';
import { takeGoogleState } from './googleState';
import { setSession } from './tokenStore';
import { t, useLanguage } from './i18n';

const shell = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg)',
  color: 'var(--cream)',
  flexDirection: 'column',
  gap: '1.5rem',
  textAlign: 'center',
  padding: '1rem',
};

function Screen({ icon, title, children }) {
  return (
    <div style={shell}>
      <div style={{ fontSize: '3rem' }}>{icon}</div>
      <div style={{ maxWidth: 420 }}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

function GoogleCallback() {
  useLanguage();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading' });
  const started = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    injectStyles();
    // The authorization code is single-use and React StrictMode runs effects twice in development.
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      setState({ status: 'error', message: t('Google authentication was cancelled or failed') });
      return;
    }
    const code = params.get('code');
    if (!code) {
      setState({ status: 'error', message: t('No authorization code received') });
      return;
    }

    // Login CSRF check: the returned state must match the one stored before the redirect.
    const expected = takeGoogleState();
    const returned = params.get('state');
    if (!expected || !returned || returned !== expected) {
      setState({ status: 'error', message: t('Sign-in could not be verified. Please try again.') });
      return;
    }

    API.auth
      .googleCallback(code, takeGoogleConsent())
      .then(async response => {
        await setSession({ accessToken: response.access_token, refreshToken: response.refresh_token, email: response.user.email });
        setState({ status: 'success' });
        timer.current = window.setTimeout(() => navigate('/app', { replace: true }), 1500);
      })
      .catch(err => {
        if (err.code === 'consent_required') {
          setState({ status: 'consent' });
        } else {
          setState({ status: 'error', message: err.message || t('Authentication failed') });
        }
      });
  }, [navigate]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (state.status === 'loading') {
    return (
      <Screen icon={<span style={{ animation: 'moonFloat 4s ease-in-out infinite', display: 'inline-block' }}>◐</span>}>
        <div>{t('Completing authentication...')}</div>
      </Screen>
    );
  }

  if (state.status === 'success') {
    return (
      <Screen icon="✅" title={t('Authentication Successful!')}>
        <p>{t('Redirecting to your dashboard...')}</p>
      </Screen>
    );
  }

  if (state.status === 'consent') {
    return (
      <Screen icon="🌙" title={t('Create your account first')}>
        <p>
          {t("We couldn't find a Luna Health account for this Google email. To create one, go to Register, confirm that you are 18 or older and accept the Terms and Privacy Policy, then continue with Google.")}
        </p>
        <button className="btn btn-p" onClick={() => navigate('/register')}>{t('Go to Register')}</button>
      </Screen>
    );
  }

  return (
    <Screen icon="❌" title={t('Authentication Failed')}>
      <p>{state.message}</p>
      <button className="btn btn-p" onClick={() => navigate('/login')}>{t('Back to Login')}</button>
    </Screen>
  );
}

export default GoogleCallback;
