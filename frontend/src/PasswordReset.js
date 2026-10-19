// Password Reset Component
import React, { useState } from 'react';
import { API } from './App';

function PasswordReset() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('token');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      setLoading(false);
      return;
    }

    try {
      const response = await API.auth.resetPassword({
        token: resetToken || token,
        new_password: newPassword
      });
      
      setMessage(response.message);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--cream)'
      }}>
        <div style={{
          background: 'var(--s1)',
          padding: '2.5rem',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          maxWidth: '400px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔐</div>
          <h2>Password Reset Successful!</h2>
          <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>{message}</p>
          <button 
            onClick={() => window.location.href = '/login'}
            style={{
              padding: '0.8rem 1.5rem',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Continue to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)'
    }}>
      <div style={{
        background: 'var(--s1)',
        padding: '2.5rem',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        maxWidth: '400px',
        width: '100%'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔐</div>
          <h2>Reset Your Password</h2>
          <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>
            Enter your new password below
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--cream)' }}>
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              required
              style={{
                width: '100%',
                padding: '0.8rem',
                background: 'var(--s2)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--cream)',
                fontSize: '1rem'
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--cream)' }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
              style={{
                width: '100%',
                padding: '0.8rem',
                background: 'var(--s2)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--cream)',
                fontSize: '1rem'
              }}
            />
          </div>

          {error && (
            <div style={{
              color: '#E07070',
              fontSize: '.8rem',
              marginBottom: '1rem',
              padding: '0.5rem',
              background: 'rgba(224, 112, 112, 0.1)',
              borderRadius: '4px'
            }}>
              {error}
            </div>
          )}

          {message && (
            <div style={{
              color: '#5FA87A',
              fontSize: '.8rem',
              marginBottom: '1rem',
              padding: '0.5rem',
              background: 'rgba(95, 168, 122, 0.1)',
              borderRadius: '4px'
            }}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.8rem',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              fontSize: '1rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default PasswordReset;
