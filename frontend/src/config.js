const fromEnv = process.env.REACT_APP_API_BASE;

if (!fromEnv && process.env.NODE_ENV === 'production') {
  throw new Error('REACT_APP_API_BASE must be set for production builds');
}

export const API_BASE = (fromEnv || 'http://localhost:8000/api/v1').replace(/\/+$/, '');
export const SUPPORT_EMAIL = process.env.REACT_APP_SUPPORT_EMAIL || '';
export const GOOGLE_WEB_CLIENT_ID = process.env.REACT_APP_GOOGLE_WEB_CLIENT_ID || '';
