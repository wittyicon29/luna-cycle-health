// Google OAuth Callback Handler
import React, { useState, useEffect } from 'react';
import { API } from './App';

function GoogleCallback() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const handleCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      if (error) {
        setError('Google authentication was cancelled or failed');
        setLoading(false);
        return;
      }

      if (!code) {
        setError('No authorization code received');
        setLoading(false);
        return;
      }

      try {
        const response = await API.auth.googleCallback({ code });
        
        // Store tokens and redirect to app
        localStorage.setItem('access_token', response.access_token);
        localStorage.setItem('refresh_token', response.refresh_token);
        localStorage.setItem('email', response.user.email);
        
        setSuccess(true);
        setTimeout(() => {
          window.location.href = '/app';
        }, 2000);
        
      } catch (err) {
        setError(err.message || 'Authentication failed');
      } finally {
        setLoading(false);
      }
    };

    handleCallback();
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--cream)',
        flexDirection: 'column',
        gap: '2rem'
      }}>
        <div style={{ fontSize: '3rem', animation: 'moonFloat 4s ease-in-out infinite' }}>◐</div>
        <div>Completing authentication...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--cream)',
        flexDirection: 'column',
        gap: '2rem'
      }}>
        <div style={{ fontSize: '3rem' }}>❌</div>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <h2>Authentication Failed</h2>
          <p>{error}</p>
          <button 
            onClick={() => window.location.href = '/login'}
            style={{
              marginTop: '1rem',
              padding: '0.8rem 1.5rem',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--cream)',
        flexDirection: 'column',
        gap: '2rem'
      }}>
        <div style={{ fontSize: '3rem' }}>✅</div>
        <div style={{ textAlign: 'center' }}>
          <h2>Authentication Successful!</h2>
          <p>Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return null;
}

export default GoogleCallback;
