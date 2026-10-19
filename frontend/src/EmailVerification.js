import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

// API
const API_BASE = "http://localhost:8000/api/v1";
async function req(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts
  });
  if (!res.ok) { 
    const err = await res.json().catch(() => ({})); 
    throw new Error(err.detail || `Error ${res.status}`); 
  }
  return res.json();
}

// Styles
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Outfit:wght@300;400;500;600&family=Fira+Code:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1A0F2E;--s1:#241539;--s2:#2E1D45;--s3:#3D2860;
  --border:#3D2860;--border-h:#4A3575;
  --cream:#F5EEF8;--muted:#A889C0;--muted-h:#7A5C90;--r:8px;
  --cta:#FF6B8A;--cta-hover:#FF4D70;
}
body{font-family:'Outfit',sans-serif;background:var(--bg);color:var(--cream);height:100vh;-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.6}
#root{height:100vh;display:flex;align-items:center;justify-content:center}

.verify-wrap{min-height:100vh;background:var(--bg);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.verify-orb{position:absolute;border-radius:50%;filter:blur(120px);pointer-events:none;animation:orbIn 1.5s ease both}
.verify-orb-a{width:500px;height:500px;background:radial-gradient(circle,rgba(196,84,74,0.18),transparent 70%);top:-100px;right:-100px;animation-delay:.2s}
.verify-orb-b{width:400px;height:400px;background:radial-gradient(circle,rgba(124,102,192,0.12),transparent 70%);bottom:-80px;left:-80px;animation-delay:.5s}
@keyframes orbIn{from{opacity:0}to{opacity:1}}

.verify-card{position:relative;z-index:1;width:100%;max-width:420px;background:var(--s1);border:1px solid var(--border);padding:2.5rem;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:cardIn .5s cubic-bezier(.4,0,.2,1) both}
@keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(.98)}to{opacity:1;transform:none}}

.verify-logo{text-align:center;margin-bottom:2rem}
.verify-moon{display:block;font-size:2.2rem;margin-bottom:.5rem;animation:moonFloat 4s ease-in-out infinite}
@keyframes moonFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.verify-logo h1{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:500;color:var(--cream);letter-spacing:.02em}
.verify-logo p{font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-top:.3rem}

.success-icon{width:80px;height:80px;border-radius:50%;background:rgba(74,158,110,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;font-size:2.5rem}
.error-icon{width:80px;height:80px;border-radius:50%;background:rgba(196,84,74,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;font-size:2.5rem}

.verify-title{font-family:'Cormorant Garamond',serif;font-size:1.5rem;color:var(--cream);text-align:center;margin-bottom:1rem}
.verify-message{text-align:center;color:var(--muted);line-height:1.6;margin-bottom:2rem}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.62rem 1.2rem;font-family:'Outfit',sans-serif;font-size:.78rem;font-weight:500;cursor:pointer;border:none;border-radius:var(--r);transition:all .2s cubic-bezier(.4,0,.2,1);user-select:none}
.btn:active:not(:disabled){transform:scale(.97)}
.btn-p{background:#FF6B8A;color:#fff;box-shadow:0 0 20px rgba(255, 107, 138, 0.45)}
.btn-p:hover:not(:disabled){background:#FF4D70;transform:translateY(-1px)}
.btn-g{background:transparent;border:1px solid var(--border);color:var(--muted)}
.btn-g:hover:not(:disabled){border-color:var(--border-h);color:var(--cream);background:var(--s2)}
.btn-full{width:100%}

.loading{display:flex;align-items:center;justify-content:center;gap:.75rem;padding:3rem;color:var(--muted);font-size:.78rem}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,107,138,0.3);border-top-color:#FF6B8A;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.err{font-size:.75rem;color:#FF6B8A;padding:.55rem .8rem;background:rgba(255,107,138,0.1);border:1px solid rgba(255,107,138,0.3);border-radius:6px;margin-top:.5rem;animation:feedIn .2s ease}
@keyframes feedIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
`;

function injectStyles() {
  if (document.getElementById("verify-styles")) return;
  const s = document.createElement("style"); s.id = "verify-styles"; s.textContent = STYLES;
  document.head.appendChild(s);
}

function EmailVerification() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    injectStyles();
    
    const token = searchParams.get('token');
    if (!token) {
      setError('Invalid verification link');
      setLoading(false);
      return;
    }

    verifyEmail(token);
  }, [searchParams]);

  const verifyEmail = async (token) => {
    try {
      const response = await req('/verify/verify', {
        method: 'POST',
        body: JSON.stringify({ token })
      });

      setSuccess(true);
      setLoading(false);
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);

    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="verify-wrap">
        <div className="verify-orb verify-orb-a" />
        <div className="verify-orb verify-orb-b" />
        
        <div className="verify-card">
          <div className="verify-logo">
            <span className="verify-moon">◐</span>
            <h1>Luna Health</h1>
            <p>Email Verification</p>
          </div>
          
          <div className="loading">
            <span className="spinner" />
            <span>Verifying your email...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="verify-wrap">
        <div className="verify-orb verify-orb-a" />
        <div className="verify-orb verify-orb-b" />
        
        <div className="verify-card">
          <div className="verify-logo">
            <span className="verify-moon">◐</span>
            <h1>Luna Health</h1>
            <p>Email Verification</p>
          </div>
          
          <div className="error-icon">❌</div>
          <h2 className="verify-title">Verification Failed</h2>
          <p className="verify-message">{error}</p>
          
          <button className="btn btn-p btn-full" onClick={handleGoToLogin}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="verify-wrap">
      <div className="verify-orb verify-orb-a" />
      <div className="verify-orb verify-orb-b" />
      
      <div className="verify-card">
        <div className="verify-logo">
          <span className="verify-moon">◐</span>
          <h1>Luna Health</h1>
          <p>Email Verification</p>
        </div>
        
        <div className="success-icon">✓</div>
        <h2 className="verify-title">Email Verified!</h2>
        <p className="verify-message">
          Your email has been successfully verified. You can now log in to your Luna Health account.
        </p>
        
        <p style={{ textAlign: 'center', fontSize: '.75rem', color: 'var(--muted)' }}>
          Redirecting to login page...
        </p>
      </div>
    </div>
  );
}

export default EmailVerification;
