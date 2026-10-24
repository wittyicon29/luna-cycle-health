import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { API } from './api';
import ConsentCheckboxes from './ConsentCheckboxes';

const utf8Bytes = value => unescape(encodeURIComponent(value)).length;

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
#root{min-height:100vh;display:flex;align-items:flex-start;justify-content:center}

.verify-wrap{min-height:100vh;width:100%;padding:1rem;box-sizing:border-box;background:var(--bg);display:flex;align-items:flex-start;justify-content:center;position:relative;overflow:hidden}
.verify-orb{position:absolute;border-radius:50%;filter:blur(120px);pointer-events:none;animation:orbIn 1.5s ease both}
.verify-orb-a{width:500px;height:500px;background:radial-gradient(circle,rgba(196,84,74,0.18),transparent 70%);top:-100px;right:-100px;animation-delay:.2s}
.verify-orb-b{width:400px;height:400px;background:radial-gradient(circle,rgba(124,102,192,0.12),transparent 70%);bottom:-80px;left:-80px;animation-delay:.5s}
@keyframes orbIn{from{opacity:0}to{opacity:1}}

.verify-card{margin:auto;position:relative;z-index:1;width:100%;max-width:420px;background:var(--s1);border:1px solid var(--border);padding:2.5rem;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:cardIn .5s cubic-bezier(.4,0,.2,1) both}
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

.vf{margin-bottom:1rem}
.vf label{display:block;font-size:.7rem;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:.35rem}
.vf input{width:100%;padding:.7rem .85rem;background:var(--s2);border:1px solid var(--border);border-radius:var(--r);color:var(--cream);font-family:'Outfit',sans-serif;font-size:.9rem}
.vf input:focus{outline:none;border-color:#FF6B8A}
.vf input[readonly]{opacity:.7}
.vpw-wrap{position:relative}
.vpw-wrap input{padding-right:3rem}
.vpw-toggle{position:absolute;top:50%;right:0;transform:translateY(-50%);width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1rem;border-radius:var(--r)}
.vpw-toggle:hover{color:var(--cream)}
.vpw-toggle:focus-visible{outline:2px solid #FF8A80;outline-offset:-2px}
`;

function injectStyles() {
  if (document.getElementById("verify-styles")) return;
  const s = document.createElement("style"); s.id = "verify-styles"; s.textContent = STYLES;
  document.head.appendChild(s);
}

function Shell({ children }) {
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
        {children}
      </div>
    </div>
  );
}

function EmailVerification() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // The token whose check was last started; re-runs only when the token changes.
  const checkedToken = useRef(undefined);

  useEffect(() => {
    injectStyles();
    // One check per token: StrictMode's double effect repeats the same token and is skipped.
    if (checkedToken.current === token) return;
    checkedToken.current = token;
    setLoading(true);
    setFatal('');
    setEmail('');

    if (!token) {
      setFatal('Invalid verification link');
      setLoading(false);
      return;
    }

    API.verify.check(token)
      .then(res => { if (checkedToken.current === token) setEmail(res.email); })
      .catch(err => { if (checkedToken.current === token) setFatal(err.message); })
      .finally(() => { if (checkedToken.current === token) setLoading(false); });
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (password.length < 8) { setFormError('Use at least 8 characters'); return; }
    if (utf8Bytes(password) > 72) { setFormError('Password must be at most 72 bytes'); return; }
    if (password !== confirm) { setFormError('Passwords do not match'); return; }
    if (!adult || !accepted) { setFormError('Please confirm you are 18 or older and agree to the Terms and Privacy Policy'); return; }
    setSubmitting(true);
    try {
      const res = await API.verify.complete(token, password, { accepted, adult });
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('refresh_token', res.refresh_token);
      localStorage.setItem('email', email);
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="loading">
          <span className="spinner" />
          <span>Checking your link...</span>
        </div>
      </Shell>
    );
  }

  if (fatal) {
    return (
      <Shell>
        <div className="error-icon">❌</div>
        <h2 className="verify-title">Link problem</h2>
        <p className="verify-message">{fatal}</p>
        <button className="btn btn-p btn-full" onClick={() => navigate('/login')}>
          Back to sign in
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="verify-title">Choose your password</h2>
      <form onSubmit={handleSubmit} noValidate>
        <div className="vf">
          <label htmlFor="verify-email-field">Email</label>
          <input id="verify-email-field" type="email" value={email} readOnly />
        </div>
        <div className="vf">
          <label htmlFor="verify-new-password">New password</label>
          <div className="vpw-wrap">
            <input id="verify-new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="button" className="vpw-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? '🙈' : '👁'}</button>
          </div>
        </div>
        <div className="vf">
          <label htmlFor="verify-confirm-password">Confirm password</label>
          <input id="verify-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} required />
        </div>
        <ConsentCheckboxes adult={adult} accepted={accepted} onAdultChange={setAdult} onAcceptedChange={setAccepted} />
        {formError && <div className="err" role="alert">{formError}</div>}
        <button className="btn btn-p btn-full" style={{ marginTop: '1rem' }} type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create my account'}
        </button>
      </form>
    </Shell>
  );
}

export default EmailVerification;
