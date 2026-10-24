import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './LandingPage';
import App from './App';
import EmailVerification from './EmailVerification';
import GoogleCallback from './GoogleCallback';
import LegalPage from './LegalPage';
import PasswordReset from './PasswordReset';
import { PRIVACY_POLICY, TERMS } from './legalContent';

function AppRouter() {
  return (
    <Router>
      <Routes>
        {/* Landing page - marketing site */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/landing" element={<LandingPage />} />
        
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
