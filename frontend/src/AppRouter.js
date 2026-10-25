import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './LandingPage';
import App from './App';
import EmailVerification from './EmailVerification';
import GoogleCallback from './GoogleCallback';
import LegalPage from './LegalPage';
import PasswordReset from './PasswordReset';
import { getAccessToken } from './tokenStore';
import { isNative } from './platform';
import { PRIVACY_POLICY, TERMS } from './legalContent';

// A stored session skips the marketing page; an expired one is handled by the app's own
// session-expired flow once /app loads. In the native app the marketing page (English only) is skipped too:
// signed-out users go straight to the sign-in screen, which has the language switcher.
function LandingOrApp() {
  if (getAccessToken()) return <Navigate to="/app" replace />;
  if (isNative()) return <Navigate to="/login" replace />;
  return <LandingPage />;
}

function AppRouter() {
  return (
    <Router>
      <Routes>
        {/* Landing page - marketing site */}
        <Route path="/" element={<LandingOrApp />} />
        <Route path="/landing" element={<LandingOrApp />} />
        
        {/* Email verification */}
        <Route path="/verify-email" element={<EmailVerification />} />

        {/* Password reset link from email */}
        <Route path="/reset-password" element={<PasswordReset />} />

        {/* Legal pages (the Play Store needs a public Privacy Policy URL) */}
        <Route path="/privacy" element={<LegalPage doc={PRIVACY_POLICY} />} />
        <Route path="/terms" element={<LegalPage doc={TERMS} />} />
        
        {/* Google OAuth callback - handles OAuth parameters */}
        <Route path="/auth/google/callback" element={<GoogleCallback />} />
        
        {/* Auth pages - direct access */}
        <Route path="/auth" element={<App />} />
        <Route path="/login" element={<App />} />
        <Route path="/register" element={<App />} />
        
        {/* Main webapp - direct access */}
        <Route path="/app" element={<App />} />
        <Route path="/app/*" element={<App />} />
        
        {/* Redirect any other routes to landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default AppRouter;
