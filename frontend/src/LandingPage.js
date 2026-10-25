import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUPPORT_EMAIL } from './config';
import { useEnglishDocument } from './i18n/useEnglishDocument';

// ─── PHASE DATA ───────────────────────────────────────────────────────────────
const PHASES = [
  {
    id: 'menstrual', name: 'Menstrual', territory: 'The Valley',
    days: 'Days 1–5', icon: '🩸', wheelAngle: 270,
    color: '#C4554B', glow: 'rgba(196,85,75,0.5)',
    bg: 'rgba(196,85,75,0.11)', border: 'rgba(196,85,75,0.28)',
    desc: 'A time of release and renewal. Honour rest, warmth, and gentle movement as your body sheds and resets.',
    traits: ['Deep rest & recovery', 'Inward reflection', 'Gentle movement', 'Warmth & nourishment'],
  },
  {
    id: 'follicular', name: 'Follicular', territory: 'The Ascent',
    days: 'Days 6–13', icon: '🌱', wheelAngle: 0,
    color: '#4A9E6E', glow: 'rgba(74,158,110,0.5)',
    bg: 'rgba(74,158,110,0.09)', border: 'rgba(74,158,110,0.25)',
    desc: 'Energy and optimism rise. The ideal phase for new projects, bold decisions, and social connection.',
    traits: ['Rising energy', 'Creative spark', 'Social vitality', 'New beginnings'],
  },
  {
    id: 'ovulation', name: 'Ovulation', territory: 'The Summit',
    days: 'Day 14±', icon: '✦', wheelAngle: 90,
    color: '#D4A040', glow: 'rgba(212,160,64,0.5)',
    bg: 'rgba(212,160,64,0.10)', border: 'rgba(212,160,64,0.28)',
    desc: 'Energy and confidence often peak around now. Notice how your body feels.',
    traits: ['Peak confidence', 'Clear thinking', 'Social energy', 'Steady focus'],
  },
  {
    id: 'luteal', name: 'Luteal', territory: 'The Return',
    days: 'Days 15–28', icon: '🌙', wheelAngle: 180,
    color: '#7C66C0', glow: 'rgba(124,102,192,0.5)',
    bg: 'rgba(124,102,192,0.09)', border: 'rgba(124,102,192,0.25)',
    desc: 'A turn inward. Depth, creativity, and completion flourish. Honor your body as it prepares to renew.',
    traits: ['Deep reflection', 'Creative depth', 'Completion mode', 'Emotional wisdom'],
  },
];

const FEATURES = [
  { icon: '🗺', title: 'Journey Map', color: '#C4554B', desc: 'Navigate your entire cycle history on a living scrollable terrain — hover phases, click period markers, and always see exactly where you are today.' },
  { icon: '🧠', title: 'AI Analysis', color: '#4A9E6E', desc: 'AI-assisted insights based on your logged cycles. Estimates, not medical advice.' },
  { icon: '💬', title: 'Luna AI Chat', color: '#7ECECE', desc: 'An AI companion for questions about your cycle. Opt-in, and not a substitute for a doctor.' },
  { icon: '📋', title: 'Health Profile', color: '#D4A040', desc: 'An optional health questionnaire gives Luna context to make your insights more personal. It\'s not a diagnosis.' },
  { icon: '🔮', title: 'Smart Predictions', color: '#7C66C0', desc: 'Luna learns your rhythms to forecast your next period and where you are in your cycle.' },
  { icon: '🔒', title: 'Private by Design', color: '#5FA87A', desc: 'Your notes, chats and health profile are encrypted at rest. We never sell your data, and AI features are opt-in.' },
];

const STEPS = [
  { num: '1', label: 'Sign Up', desc: 'Create your free account in seconds — no credit card needed.', color: '#C4554B', icon: '◐' },
  { num: '2', label: 'Build Your Profile', desc: 'Optionally share a few health details so insights feel more personal.', color: '#4A9E6E', icon: '📋' },
  { num: '3', label: 'Log Your Cycle', desc: 'Add your first period to the journey map and watch it come alive.', color: '#D4A040', icon: '🗺' },
  { num: '4', label: 'Discover Insights', desc: 'Let Luna AI analyse your patterns and guide your wellness journey.', color: '#7C66C0', icon: '✦' },
];

const MARQUEE_ITEMS = [
  { text: 'Journey Map', icon: '🗺' }, { text: 'AI Insights', icon: '🧠' },
  { text: 'Phase Guidance', icon: '🌙' },
  { text: 'Symptom Tracking', icon: '📋' }, { text: 'Luna AI Chat', icon: '💬' },
  { text: 'Cycle Predictions', icon: '🔮' }, { text: 'Privacy First', icon: '🔒' },
];

// ─── INJECT STYLES ────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Outfit:wght@300;400;500;600&family=Fira+Code:wght@300;400;500&display=swap');
.lp*,.lp *{box-sizing:border-box;margin:0;padding:0}
.lp{font-family:'Outfit','Noto Sans Devanagari',sans-serif;background:#07080C;color:#EAE5DC;overflow-x:hidden}
.lp ::-webkit-scrollbar{width:3px;height:3px}
.lp ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.09);border-radius:2px}

/* NAV */
.lp-nav{position:fixed;top:0;left:0;right:0;z-index:100;height:58px;padding:0 2rem;display:flex;align-items:center;justify-content:space-between;transition:background .35s,border .35s}
.lp-nav.stuck{background:rgba(7,8,12,.93);backdrop-filter:blur(14px);border-bottom:1px solid rgba(255,255,255,.06)}
.lp-logo{font-family:'Cormorant Garamond','Noto Sans Devanagari',serif;font-size:1.3rem;font-weight:500;display:flex;align-items:center;gap:.4rem;cursor:default;letter-spacing:.02em}
.lp-logo-moon{display:inline-block;animation:moonBob 4s ease-in-out infinite}
.lp-nav-links{display:flex;align-items:center;gap:.4rem}
.lp-nav-link{background:none;border:1px solid rgba(255,255,255,.08);color:rgba(234,229,220,.65);font-family:'Outfit','Noto Sans Devanagari',sans-serif;font-size:.77rem;padding:.42rem .85rem;border-radius:100px;cursor:pointer;transition:all .2s}
.lp-nav-link:hover{border-color:rgba(255,255,255,.18);color:#EAE5DC}
.lp-nav-cta{background:#C4554B;border:none;color:#fff;font-family:'Outfit','Noto Sans Devanagari',sans-serif;font-size:.77rem;font-weight:500;padding:.42rem 1rem;border-radius:100px;cursor:pointer;transition:all .2s}
.lp-nav-cta:hover{filter:brightness(1.14);box-shadow:0 4px 18px rgba(196,85,75,.42);transform:translateY(-1px)}

/* HERO */
.lp-hero{min-height:100vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:80px 2rem 4rem}
.lp-hero-inner{position:relative;z-index:2;display:flex;align-items:center;gap:4rem;max-width:1100px;width:100%;flex-wrap:wrap;justify-content:center}
.lp-hero-text{flex:1;min-width:280px;max-width:500px}
.lp-badge{display:inline-flex;align-items:center;gap:.45rem;padding:.28rem .75rem;border:1px solid rgba(196,85,75,.32);border-radius:100px;font-size:.67rem;color:#C4554B;font-family:'Fira Code','Noto Sans Devanagari',monospace;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1.6rem;background:rgba(196,85,75,.07)}
.lp-badge-dot{width:5px;height:5px;border-radius:50%;background:#C4554B;animation:pulse 2.5s ease-in-out infinite}
.lp-h1{font-family:'Cormorant Garamond','Noto Sans Devanagari',serif;font-size:clamp(2.8rem,5.5vw,4.4rem);font-weight:500;line-height:1.08;letter-spacing:.01em;margin-bottom:.9rem}
.lp-shimmer{background:linear-gradient(120deg,#F28BA0,#C4554B 30%,#D4A040 60%,#7C66C0);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;background-size:250% auto;animation:shimmer 7s linear infinite}
@keyframes shimmer{from{background-position:200% center}to{background-position:-200% center}}
.lp-tagline{font-family:'Fira Code','Noto Sans Devanagari',monospace;font-size:clamp(.85rem,1.8vw,1rem);color:rgba(234,229,220,.5);letter-spacing:.07em;margin-bottom:1.6rem;min-height:1.5em}
.lp-cursor{animation:blink .7s step-end infinite}
@keyframes blink{50%{opacity:0}}
.lp-desc{font-size:clamp(.88rem,1.4vw,1rem);color:rgba(234,229,220,.6);line-height:1.8;margin-bottom:2rem;max-width:420px}
.lp-ctas{display:flex;gap:.9rem;flex-wrap:wrap;margin-bottom:2.4rem}
.lp-btn-primary{display:inline-flex;align-items:center;gap:.5rem;padding:.85rem 2rem;background:#C4554B;border:none;border-radius:100px;color:#fff;font-family:'Outfit','Noto Sans Devanagari',sans-serif;font-size:.92rem;font-weight:600;cursor:pointer;transition:all .25s;box-shadow:0 6px 22px rgba(196,85,75,.35)}
.lp-btn-primary:hover{filter:brightness(1.12);transform:translateY(-2px);box-shadow:0 10px 30px rgba(196,85,75,.5)}
.lp-btn-secondary{display:inline-flex;align-items:center;gap:.5rem;padding:.85rem 2rem;background:transparent;border:1.5px solid rgba(255,255,255,.13);border-radius:100px;color:rgba(234,229,220,.75);font-family:'Outfit','Noto Sans Devanagari',sans-serif;font-size:.92rem;cursor:pointer;transition:all .25s}
.lp-btn-secondary:hover{border-color:#7ECECE;color:#7ECECE;transform:translateY(-1px)}
.lp-phase-tag{display:inline-flex;align-items:center;gap:.4rem;padding:.22rem .65rem;border-radius:100px;font-size:.68rem;font-weight:500;border:1px solid;transition:all .5s ease;font-family:'Fira Code','Noto Sans Devanagari',monospace}

/* CYCLE WHEEL */
.lp-wheel-wrap{position:relative;flex-shrink:0}
.lp-wheel{position:relative;width:320px;height:320px}
.lp-wheel-ring{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(255,255,255,.04);pointer-events:none;animation:spinSlow 70s linear infinite}
.lp-wheel-ring2{position:absolute;inset:18px;border-radius:50%;border:1px dashed rgba(255,255,255,.03);pointer-events:none;animation:spinSlow 50s linear infinite reverse}
@keyframes spinSlow{to{transform:rotate(360deg)}}
.lp-wheel-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:3;pointer-events:none}
.lp-wheel-moon{font-size:2.6rem;animation:moonBob 4s ease-in-out infinite}
.lp-wheel-sub{font-family:'Fira Code','Noto Sans Devanagari',monospace;font-size:.55rem;color:rgba(234,229,220,.3);letter-spacing:.15em;text-transform:uppercase;margin-top:.3rem}
.lp-spoke{position:absolute;top:50%;left:50%;width:1px;transform-origin:left center;pointer-events:none;z-index:1}
.lp-segment{position:absolute;width:76px;height:76px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);border:2px solid;z-index:5}
.lp-segment:hover{transform:translate(-50%,-50%) scale(1.18) !important;z-index:10}
.lp-seg-icon{font-size:1.35rem;line-height:1}
.lp-seg-name{font-size:.5rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;margin-top:2px;font-family:'Fira Code','Noto Sans Devanagari',monospace}

/* PHASE DETAIL POPOVER */
.lp-phase-pop{position:absolute;right:-10px;top:50%;transform:translateY(-50%) translateX(100%);width:210px;padding:1rem 1.1rem;border-radius:12px;border:1px solid;background:rgba(10,11,18,.97);box-shadow:0 10px 40px rgba(0,0,0,.6);animation:popIn .22s cubic-bezier(.4,0,.2,1);pointer-events:none;z-index:20}
@keyframes popIn{from{opacity:0;transform:translateY(-50%) translateX(calc(100% + 8px))}to{opacity:1;transform:translateY(-50%) translateX(100%)}}
.lp-pop-territory{font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;font-weight:500;opacity:.7;margin-bottom:.22rem}
.lp-pop-name{font-family:'Cormorant Garamond','Noto Sans Devanagari',serif;font-size:1.1rem;margin-bottom:.45rem}
.lp-pop-desc{font-size:.74rem;color:rgba(234,229,220,.72);line-height:1.6;margin-bottom:.65rem}
.lp-pop-trait{display:flex;align-items:center;gap:.4rem;font-size:.67rem;color:rgba(234,229,220,.5);margin-bottom:.2rem}
.lp-pop-dot{width:4px;height:4px;border-radius:50%;flex-shrink:0}

/* MARQUEE */
.lp-marquee-wrap{overflow:hidden;padding:1.1rem 0;background:rgba(13,14,22,.6);border-top:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04)}
.lp-marquee-track{display:flex;animation:marquee 28s linear infinite;white-space:nowrap}
.lp-marquee-track:hover{animation-play-state:paused}
.lp-marquee-item{display:inline-flex;align-items:center;gap:.5rem;padding:0 2.2rem;font-size:.7rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:rgba(234,229,220,.28);font-family:'Fira Code','Noto Sans Devanagari',monospace;flex-shrink:0}
@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}

/* REVEAL */
.lp-reveal{opacity:0;transform:translateY(26px);transition:opacity .65s cubic-bezier(.4,0,.2,1),transform .65s cubic-bezier(.4,0,.2,1)}
.lp-reveal.in{opacity:1;transform:none}
.lp-reveal-l{opacity:0;transform:translateX(-26px);transition:opacity .65s cubic-bezier(.4,0,.2,1),transform .65s cubic-bezier(.4,0,.2,1)}
.lp-reveal-l.in{opacity:1;transform:none}
.lp-reveal-r{opacity:0;transform:translateX(26px);transition:opacity .65s cubic-bezier(.4,0,.2,1),transform .65s cubic-bezier(.4,0,.2,1)}
.lp-reveal-r.in{opacity:1;transform:none}

/* FEATURE CARDS */
.lp-feat-card{background:rgba(255,255,255,.022);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:1.55rem;transition:all .3s cubic-bezier(.4,0,.2,1);cursor:default;position:relative;overflow:hidden}
.lp-feat-card:hover{transform:translateY(-5px)}
.lp-feat-card::after{content:'';position:absolute;inset:0;border-radius:14px;opacity:0;transition:opacity .3s;pointer-events:none}
.lp-feat-card:hover::after{opacity:1}

/* MINI MAP */
.lp-map-frame{border-radius:14px;border:1px solid rgba(255,255,255,.08);overflow:hidden;background:#0A0B12}
.lp-map-scroll{overflow-x:auto;overflow-y:hidden;cursor:grab;scrollbar-width:none}
.lp-map-scroll::-webkit-scrollbar{display:none}
.lp-map-scroll:active{cursor:grabbing}

/* STATS */
.lp-stat-block{flex:1;min-width:150px;text-align:center;padding:2.2rem 1rem;background:#0D0E16;border-right:1px solid rgba(255,255,255,.05)}
.lp-stat-block:last-child{border-right:none}
.lp-stat-num{font-family:'Cormorant Garamond','Noto Sans Devanagari',serif;font-size:2.8rem;line-height:1;font-weight:500}
.lp-stat-lbl{font-size:.67rem;color:rgba(234,229,220,.42);text-transform:uppercase;letter-spacing:.12em;margin-top:.3rem;font-weight:500}

/* STEPS */
.lp-step{text-align:center;transition:all .3s;cursor:default;padding:1.4rem 1rem;border-radius:14px;border:1px solid transparent}
.lp-step.active{background:rgba(255,255,255,.025);border-color:rgba(255,255,255,.07)}
.lp-step-num{width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond','Noto Sans Devanagari',serif;font-size:1.75rem;font-weight:500;margin:0 auto 1.1rem;transition:all .4s cubic-bezier(.4,0,.2,1)}

/* PHASE EXPLORER */
.lp-phase-card{border-radius:14px;padding:1.5rem;cursor:pointer;transition:all .35s cubic-bezier(.4,0,.2,1);border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02)}
.lp-phase-card:hover,.lp-phase-card.active{transform:translateY(-4px)}
.lp-phase-traits{overflow:hidden;transition:max-height .4s cubic-bezier(.4,0,.2,1),opacity .3s ease}

/* SCROLL HINT */
.lp-scroll-hint{position:absolute;bottom:2rem;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.4rem;opacity:.35;cursor:pointer;transition:opacity .2s}
.lp-scroll-hint:hover{opacity:.65}
.lp-scroll-line{width:1px;height:36px;background:linear-gradient(to bottom,rgba(255,255,255,.4),transparent);animation:scrollPulse 2s ease-in-out infinite}
@keyframes scrollPulse{0%,100%{transform:scaleY(1);opacity:.4}50%{transform:scaleY(1.3);opacity:.8}}

/* MISC ANIMATIONS */
@keyframes moonBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes orbDrift{0%,100%{transform:translate(0,0)}33%{transform:translate(18px,-14px)}66%{transform:translate(-14px,18px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes beaconPulse{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes float{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(-50%,calc(-50% - 5px))}}

@media(max-width:800px){.lp-wheel{width:260px;height:260px}.lp-phase-pop{display:none}}
@media(max-width:500px){.lp-nav-links .lp-nav-link{display:none}}
`;

function injectCSS() {
  if (document.getElementById('luna-lp-css')) return;
  const s = document.createElement('style');
  s.id = 'luna-lp-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ─── HOOKS ────────────────────────────────────────────────────────────────────
function useMousePos() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const fn = e => setPos({ x: (e.clientX / window.innerWidth - 0.5) * 2, y: (e.clientY / window.innerHeight - 0.5) * 2 });
    window.addEventListener('mousemove', fn, { passive: true });
    return () => window.removeEventListener('mousemove', fn);
  }, []);
  return pos;
}

function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}

function useCountUp(target, dur = 1600, active = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start = null;
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(e * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [active, target, dur]);
  return val;
}

// ─── CYCLE WHEEL ─────────────────────────────────────────────────────────────
function CycleWheel({ activePhase, onHover }) {
  const R = 122; // radius for segment centers
  return (
    <div className="lp-wheel">
      <div className="lp-wheel-ring" />
      <div className="lp-wheel-ring2" />

      {/* Spokes */}
      {PHASES.map(ph => {
        const rad = (ph.wheelAngle - 90) * Math.PI / 180;
        const x = Math.cos(rad) * R;
        const y = Math.sin(rad) * R;
        const len = Math.sqrt(x * x + y * y) - 32;
        const angle = Math.atan2(y, x) * 180 / Math.PI;
        return (
          <div key={ph.id} className="lp-spoke" style={{
            width: len, height: 1,
            background: `linear-gradient(90deg, transparent, ${ph.color}50)`,
            transform: `translateY(-50%) rotate(${angle}deg)`,
          }} />
        );
      })}

      {/* Segments */}
      {PHASES.map(ph => {
        const rad = (ph.wheelAngle - 90) * Math.PI / 180;
        const x = Math.cos(rad) * R;
        const y = Math.sin(rad) * R;
        const isActive = activePhase === ph.id;
        return (
          <div key={ph.id} className="lp-segment"
            style={{
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: `translate(-50%, -50%) scale(${isActive ? 1.12 : 1})`,
              background: isActive ? ph.bg : 'rgba(10,11,18,.92)',
              borderColor: isActive ? ph.color : 'rgba(255,255,255,.07)',
              boxShadow: isActive ? `0 0 22px ${ph.glow}` : 'none',
            }}
            onMouseEnter={() => onHover(ph.id)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="lp-seg-icon">{ph.icon}</div>
            <div className="lp-seg-name" style={{ color: ph.color }}>{ph.name}</div>
          </div>
        );
      })}

      {/* Center */}
      <div className="lp-wheel-center">
        <div className="lp-wheel-moon">◐</div>
        <div className="lp-wheel-sub">Your Cycle</div>
      </div>
    </div>
  );
}

// ─── MINI JOURNEY MAP ─────────────────────────────────────────────────────────
const MAP_PATTERN = [
  { phase: 'menstrual', days: 5, color: '#C4554B', bg: 'rgba(196,85,75,.09)' },
  { phase: 'follicular', days: 8, color: '#4A9E6E', bg: 'rgba(74,158,110,.08)' },
  { phase: 'ovulation', days: 3, color: '#D4A040', bg: 'rgba(212,160,64,.09)' },
  { phase: 'luteal', days: 12, color: '#7C66C0', bg: 'rgba(124,102,192,.08)' },
];
const CELL = 30;

function MiniMap() {
  const scrollRef = useRef(null);
  const drag = useRef({ on: false, x: 0, sl: 0 });

  // Build 3 cycles
  const cells = [];
  for (let c = 0; c < 3; c++) {
    MAP_PATTERN.forEach(ph => {
      for (let d = 0; d < ph.days; d++) cells.push({ ...ph, ci: cells.length });
    });
  }
  const totalW = cells.length * CELL;
  const todayX = Math.round(cells.length * 0.55);
  const periodStarts = [0, 28, 56];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = todayX * CELL - scrollRef.current.clientWidth / 2;
    }
  }, []);

  const onMD = e => { drag.current = { on: true, x: e.pageX, sl: scrollRef.current.scrollLeft }; };
  const onMM = e => { if (!drag.current.on) return; scrollRef.current.scrollLeft = drag.current.sl - (e.pageX - drag.current.x); };
  const onMU = () => { drag.current.on = false; };

  // Phase transition labels
  const labels = [];
  let lastPh = null;
  cells.forEach((c, i) => {
    if (c.phase !== lastPh) {
      const ph = PHASES.find(p => p.id === c.phase);
      labels.push({ x: i * CELL, ph, color: c.color, bg: c.bg });
      lastPh = c.phase;
    }
  });

  return (
    <div className="lp-map-frame">
      {/* Header bar */}
      <div style={{ padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5FA87A', animation: 'beaconPulse 2.5s ease-in-out infinite' }} />
          <span style={{ fontSize: '.6rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", color: 'rgba(234,229,220,.4)', letterSpacing: '.08em' }}>JOURNEY MAP · LIVE PREVIEW</span>
        </div>
        <span style={{ fontSize: '.58rem', color: 'rgba(234,229,220,.25)', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace" }}>← drag to explore →</span>
      </div>
      <div ref={scrollRef} className="lp-map-scroll"
        onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}>
        <div style={{ position: 'relative', width: totalW, height: 148 }}>
          {/* Phase bgs */}
          {cells.map((c, i) => <div key={i} style={{ position: 'absolute', left: i * CELL, width: CELL, top: 0, bottom: 0, background: c.bg }} />)}
          {/* Phase labels */}
          {labels.map((l, i) => (
            <div key={i} style={{ position: 'absolute', top: 8, left: l.x + 3, fontSize: '.55rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", color: l.color, background: l.bg, padding: '2px 6px', borderRadius: 3, borderLeft: `2px solid ${l.color}`, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', zIndex: 4, pointerEvents: 'none' }}>
              {l.ph?.icon} {l.ph?.name}
            </div>
          ))}
          {/* Week separators */}
          {cells.map((c, i) => i % 7 === 0 && i > 0 ? <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: i * CELL, width: 1, background: 'rgba(255,255,255,.03)', zIndex: 1 }} /> : null)}
          {/* Road */}
          <div style={{ position: 'absolute', left: 0, right: 0, height: 2, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.05)', zIndex: 2 }} />
          {/* Period markers */}
          {periodStarts.map(s => (
            <div key={s} style={{ position: 'absolute', left: s * CELL + CELL / 2, top: '50%', transform: 'translate(-50%,-50%)', width: 11, height: 11, borderRadius: '50%', background: '#C4554B', border: '2px solid #C4554B', boxShadow: '0 0 0 3px rgba(196,85,75,.18),0 0 10px rgba(196,85,75,.4)', zIndex: 8, cursor: 'pointer', transition: 'transform .2s' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translate(-50%,-50%) scale(1.7)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translate(-50%,-50%)'}
            />
          ))}
          {/* Today beacon */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: todayX * CELL, width: 2, background: '#D4A040', animation: 'beaconPulse 2.5s ease-in-out infinite', zIndex: 9 }} />
          <div style={{ position: 'absolute', top: '50%', left: todayX * CELL, width: 12, height: 12, borderRadius: '50%', background: '#D4A040', boxShadow: '0 0 14px rgba(212,160,64,.65)', animation: 'float 3s ease-in-out infinite', zIndex: 10 }} />
          <div style={{ position: 'absolute', bottom: 'calc(50% + 13px)', left: todayX * CELL, transform: 'translateX(-50%)', fontSize: '.54rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", color: '#D4A040', background: 'rgba(212,160,64,.14)', padding: '1px 5px', borderRadius: 2, whiteSpace: 'nowrap', zIndex: 11, pointerEvents: 'none', letterSpacing: '.06em' }}>NOW</div>
        </div>
      </div>
    </div>
  );
}

// ─── MARQUEE ──────────────────────────────────────────────────────────────────
function Marquee() {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="lp-marquee-wrap">
      <div className="lp-marquee-track">
        {items.map((item, i) => (
          <div key={i} className="lp-marquee-item">
            <span style={{ fontSize: '.85rem' }}>{item.icon}</span>
            {item.text}
            <span style={{ color: 'rgba(255,255,255,.1)', marginLeft: '.8rem' }}>·</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN LANDING PAGE ────────────────────────────────────────────────────────
function LandingPage({ onShowAuth } = {}) {
  useEnglishDocument();
  useEffect(() => { injectCSS(); }, []);

  const navigate = useNavigate();
  const mouse = useMousePos();
  const [navStuck, setNavStuck] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [activePhase, setActivePhase] = useState('ovulation');
  const [activeStep, setActiveStep] = useState(0);
  const [expandedPhase, setExpandedPhase] = useState('ovulation');

  // Section visibility
  const [featRef, featIn] = useInView();
  const [mapRef, mapIn] = useInView();
  const [stepsRef, stepsIn] = useInView();
  const [phaseRef, phaseIn] = useInView();
  const [ctaRef, ctaIn] = useInView(0.25);


  // Nav scroll detection
  useEffect(() => {
    const fn = () => setNavStuck(window.scrollY > 30);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  // Typewriter
  const fullText = 'Your Cycle. Your Journey.';
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      setTypeText(fullText.slice(0, i + 1));
      i++;
      if (i >= fullText.length) clearInterval(t);
    }, 52);
    return () => clearInterval(t);
  }, []);

  // Auto-rotate wheel phase
  useEffect(() => {
    const ids = PHASES.map(p => p.id);
    let i = ids.indexOf('ovulation');
    const t = setInterval(() => {
      i = (i + 1) % ids.length;
      setActivePhase(ids[i]);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  // Auto-advance steps
  useEffect(() => {
    const t = setInterval(() => setActiveStep(s => (s + 1) % 4), 2400);
    return () => clearInterval(t);
  }, []);

  const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const activePh = PHASES.find(p => p.id === activePhase) || PHASES[0];

  // Inside App (signed out) the parent owns the auth screen; routing alone would leave App mounted.
  const go = (mode, path) => (onShowAuth ? onShowAuth(mode) : navigate(path));
  const handleGetStarted = () => go('register', '/register');
  const handleSignIn = () => go('login', '/login');
  const handleSignUp = () => go('register', '/register');

  return (
    <div className="lp">

      {/* ── NAV ── */}
      <nav className={`lp-nav ${navStuck ? 'stuck' : ''}`}>
        <div className="lp-logo">
          <span className="lp-logo-moon">◐</span>
          Luna Health
        </div>
        <div className="lp-nav-links">
          <button className="lp-nav-link" onClick={() => scrollTo('lp-features')}>Features</button>
          <button className="lp-nav-link" onClick={() => scrollTo('lp-how')}>How it works</button>
          <button className="lp-nav-link" onClick={handleSignIn}>Sign in</button>
          <button className="lp-nav-cta" onClick={handleGetStarted}>Get Started →</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        {/* Parallax orbs */}
        {[
          { w: 650, h: 650, color: 'rgba(196,85,75,.11)', top: -220, right: -220, mx: 16, my: 12, delay: '0s' },
          { w: 520, h: 520, color: 'rgba(124,102,192,.09)', bottom: -160, left: -160, mx: -12, my: -9, delay: '5s' },
          { w: 280, h: 280, color: activePh.glow.replace('.5', '.07'), top: '35%', left: '8%', mx: 8, my: 8, delay: '2s', transition: 'background 1.4s ease' },
        ].map((orb, i) => (
          <div key={i} style={{
            position: 'absolute', width: orb.w, height: orb.h, borderRadius: '50%',
            background: `radial-gradient(circle, ${orb.color}, transparent 70%)`,
            top: orb.top, bottom: orb.bottom, left: orb.left, right: orb.right,
            filter: 'blur(110px)', pointerEvents: 'none',
            transform: `translate(${mouse.x * orb.mx}px, ${mouse.y * orb.my}px)`,
            transition: `transform .12s ease-out${orb.transition ? ', ' + orb.transition : ''}`,
            animation: `orbDrift ${14 + i * 4}s ease-in-out infinite`,
            animationDelay: orb.delay,
          }} />
        ))}

        <div className="lp-hero-inner">
          {/* ─ Text ─ */}
          <div className="lp-hero-text">
            <div className="lp-badge">
              <div className="lp-badge-dot" />
              AI-Powered Cycle Intelligence
            </div>

            <h1 className="lp-h1">
              <span className="lp-shimmer">Luna Health</span>
            </h1>

            <p className="lp-tagline">
              {typeText}<span className="lp-cursor">|</span>
            </p>

            <p className="lp-desc">
              Navigate your menstrual cycle as a living journey map. Four territories, 
              real-time phase tracking, and AI insights that learn your unique rhythm.
            </p>

            <div className="lp-ctas">
              <button className="lp-btn-primary" onClick={handleGetStarted}>
                Begin Your Journey <span style={{ opacity: .7, fontSize: '.8rem' }}>→</span>
              </button>
              <button className="lp-btn-secondary" onClick={() => scrollTo('lp-map')}>
                See the Map
              </button>
            </div>

            {/* Live phase indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span style={{ fontSize: '.6rem', color: 'rgba(234,229,220,.3)', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.08em', textTransform: 'uppercase' }}>Demo phase:</span>
              <div className="lp-phase-tag" style={{ color: activePh.color, background: activePh.bg, borderColor: activePh.border }}>
                {activePh.icon} {activePh.territory}
              </div>
            </div>
          </div>

          {/* ─ Wheel ─ */}
          <div className="lp-wheel-wrap">
            <CycleWheel activePhase={activePhase} onHover={ph => ph && setActivePhase(ph)} />

            {/* Phase popover */}
            {(() => {
              const ph = PHASES.find(p => p.id === activePhase);
              if (!ph) return null;
              return (
                <div className="lp-phase-pop" key={activePhase} style={{ borderColor: ph.border, boxShadow: `0 10px 40px rgba(0,0,0,.6), 0 0 35px ${ph.glow.replace('.5', '.09')}` }}>
                  <div className="lp-pop-territory" style={{ color: ph.color }}>{ph.territory}</div>
                  <div className="lp-pop-name" style={{ color: ph.color }}>{ph.icon} {ph.name} · {ph.days}</div>
                  <div className="lp-pop-desc">{ph.desc}</div>
                  {ph.traits.map(t => (
                    <div key={t} className="lp-pop-trait">
                      <div className="lp-pop-dot" style={{ background: ph.color }} />
                      {t}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Scroll hint */}
        <div className="lp-scroll-hint" onClick={() => scrollTo('lp-features')}>
          <span style={{ fontSize: '.58rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.1em', textTransform: 'uppercase' }}>Explore</span>
          <div className="lp-scroll-line" />
        </div>
      </section>

      {/* ── MARQUEE ── */}
      <Marquee />

      {/* ── FEATURES ── */}
      <section id="lp-features" style={{ padding: '6rem 2rem', background: '#0D0E16' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div ref={featRef} className={`lp-reveal ${featIn ? 'in' : ''}`} style={{ textAlign: 'center', marginBottom: '3.2rem' }}>
            <div style={{ fontSize: '.63rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(234,229,220,.3)', marginBottom: '.9rem' }}>What Luna Offers</div>
            <h2 style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: 'clamp(1.8rem,3.5vw,2.8rem)', fontWeight: 500, marginBottom: '.7rem' }}>
              Every Phase, Every Need
            </h2>
            <p style={{ fontSize: '.92rem', color: 'rgba(234,229,220,.48)', maxWidth: 480, margin: '0 auto', lineHeight: 1.75 }}>
              Luna Health is built around the four territories of your cycle — each feature designed to meet your body exactly where it is.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: '1.1rem' }}>
            {FEATURES.map((f, i) => (
              <div key={f.title}
                className={`lp-feat-card lp-reveal ${featIn ? 'in' : ''}`}
                style={{ transitionDelay: `${i * 0.07}s` }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = `${f.color}44`;
                  e.currentTarget.style.boxShadow = `0 12px 36px rgba(0,0,0,.28), 0 0 28px ${f.color}12`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,.07)';
                  e.currentTarget.style.boxShadow = 'none';
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.9rem' }}>
                  <span style={{ fontSize: '1.9rem' }}>{f.icon}</span>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: f.color, opacity: .5 }} />
                </div>
                <div style={{ fontSize: '.98rem', fontWeight: 600, color: f.color, marginBottom: '.5rem' }}>{f.title}</div>
                <div style={{ fontSize: '.8rem', color: 'rgba(234,229,220,.55)', lineHeight: 1.7 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MINI MAP SECTION ── */}
      <section id="lp-map" style={{ padding: '6rem 2rem', background: '#07080C', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 55% 45% at 50% 55%, rgba(212,160,64,.04), transparent)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: '4rem', alignItems: 'center', flexWrap: 'wrap' }}>

            <div ref={mapRef} className={`lp-reveal-l ${mapIn ? 'in' : ''}`} style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: '.63rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(234,229,220,.3)', marginBottom: '.9rem' }}>The Journey Map</div>
              <h2 style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', fontWeight: 500, lineHeight: 1.18, marginBottom: '1.1rem' }}>
                Navigate Your Cycle<br /><em style={{ fontStyle: 'italic', color: 'rgba(234,229,220,.55)' }}>Like a Map</em>
              </h2>
              <p style={{ fontSize: '.88rem', color: 'rgba(234,229,220,.52)', lineHeight: 1.8, marginBottom: '1.8rem' }}>
                Your entire cycle history unfolds as a scrollable terrain — colour-coded by phase, dotted with period markers, and anchored by a live beacon showing exactly where you are <em>today</em>.
              </p>
              {/* Phase legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {PHASES.map(ph => (
                  <div key={ph.id} style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: ph.color, flexShrink: 0, boxShadow: `0 0 7px ${ph.glow}` }} />
                    <span style={{ fontSize: '.76rem', color: ph.color, fontWeight: 500 }}>{ph.territory}</span>
                    <span style={{ fontSize: '.7rem', color: 'rgba(234,229,220,.38)', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace" }}>— {ph.name} · {ph.days}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`lp-reveal-r ${mapIn ? 'in' : ''}`} style={{ flex: 2, minWidth: 300 }}>
              <MiniMap />
              <div style={{ textAlign: 'center', marginTop: '.6rem', fontSize: '.6rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", color: 'rgba(234,229,220,.25)', letterSpacing: '.07em' }}>
                ← DRAG · CLICK MARKERS FOR DETAILS →
              </div>
            </div>
          </div>
        </div>
      </section>

      
      {/* ── HOW IT WORKS ── */}
      <section id="lp-how" style={{ padding: '6rem 2rem', background: '#07080C' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div className={`lp-reveal ${stepsIn ? 'in' : ''}`} style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <div style={{ fontSize: '.63rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(234,229,220,.3)', marginBottom: '.9rem' }}>Getting Started</div>
            <h2 style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: 'clamp(1.8rem,3.5vw,2.8rem)', fontWeight: 500 }}>Four Steps to Your Journey</h2>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', gap: '.4rem', marginBottom: '2.5rem', maxWidth: 400, margin: '0 auto 2.5rem' }}>
            {STEPS.map((s, i) => (
              <div key={i} onClick={() => setActiveStep(i)} style={{ flex: 1, height: 3, borderRadius: 2, background: activeStep === i ? s.color : 'rgba(255,255,255,.08)', transition: 'background .4s', cursor: 'pointer' }} />
            ))}
          </div>

          <div ref={stepsRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '1.2rem' }}>
            {STEPS.map((step, i) => {
              const isActive = activeStep === i;
              return (
                <div key={i} className={`lp-step ${isActive ? 'active' : ''} lp-reveal ${stepsIn ? 'in' : ''}`}
                  style={{ transitionDelay: `${i * 0.08}s` }}
                  onMouseEnter={() => setActiveStep(i)}>
                  <div className="lp-step-num" style={{
                    background: isActive ? step.color : 'rgba(255,255,255,.04)',
                    border: `2px solid ${isActive ? step.color : 'rgba(255,255,255,.09)'}`,
                    color: isActive ? '#fff' : 'rgba(234,229,220,.4)',
                    boxShadow: isActive ? `0 8px 26px ${step.color}44` : 'none',
                    fontSize: isActive ? '1.35rem' : '1.75rem',
                  }}>
                    {isActive ? step.icon : step.num}
                  </div>
                  <h3 style={{ fontSize: '.95rem', fontWeight: 600, color: isActive ? step.color : 'rgba(234,229,220,.75)', marginBottom: '.4rem', transition: 'color .3s' }}>{step.label}</h3>
                  <p style={{ fontSize: '.78rem', color: 'rgba(234,229,220,.45)', lineHeight: 1.65 }}>{step.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PHASE EXPLORER ── */}
      <section style={{ padding: '6rem 2rem', background: '#0D0E16' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div ref={phaseRef} className={`lp-reveal ${phaseIn ? 'in' : ''}`} style={{ textAlign: 'center', marginBottom: '3.2rem' }}>
            <div style={{ fontSize: '.63rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(234,229,220,.3)', marginBottom: '.9rem' }}>The Four Territories</div>
            <h2 style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: 'clamp(1.8rem,3.5vw,2.8rem)', fontWeight: 500 }}>Explore Your Cycle Phases</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(235px,1fr))', gap: '1rem' }}>
            {PHASES.map((ph, i) => {
              const isExp = expandedPhase === ph.id;
              return (
                <div key={ph.id}
                  className={`lp-phase-card lp-reveal ${phaseIn ? 'in' : ''} ${isExp ? 'active' : ''}`}
                  style={{
                    transitionDelay: `${i * 0.08}s`,
                    background: isExp ? ph.bg : 'rgba(255,255,255,.02)',
                    borderColor: isExp ? ph.border : 'rgba(255,255,255,.06)',
                    boxShadow: isExp ? `0 12px 36px rgba(0,0,0,.28), 0 0 35px ${ph.glow.replace('.5', '.1')}` : 'none',
                  }}
                  onMouseEnter={() => setExpandedPhase(ph.id)}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '.9rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem' }}>
                      <span style={{ fontSize: '1.4rem' }}>{ph.icon}</span>
                      <div>
                        <div style={{ fontSize: '.58rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.08em', textTransform: 'uppercase', color: ph.color, opacity: .75 }}>{ph.territory}</div>
                        <div style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: '1.08rem', color: ph.color, lineHeight: 1.2 }}>{ph.name}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '.58rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", color: 'rgba(234,229,220,.32)', background: 'rgba(255,255,255,.04)', padding: '2px 6px', borderRadius: 3, marginTop: 2 }}>{ph.days}</div>
                  </div>

                  <p style={{ fontSize: '.78rem', color: isExp ? 'rgba(234,229,220,.72)' : 'rgba(234,229,220,.42)', lineHeight: 1.68, marginBottom: '.85rem', transition: 'color .3s' }}>{ph.desc}</p>

                  <div className="lp-phase-traits" style={{ maxHeight: isExp ? 120 : 0, opacity: isExp ? 1 : 0 }}>
                    <div style={{ paddingTop: '.6rem', borderTop: `1px solid ${ph.border}`, display: 'flex', flexDirection: 'column', gap: '.28rem' }}>
                      {ph.traits.map(t => (
                        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '.7rem', color: 'rgba(234,229,220,.52)' }}>
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: ph.color, flexShrink: 0 }} />
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '7rem 2rem', background: '#07080C', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 50% 55% at 50% 100%, rgba(196,85,75,.09), transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 40% 45% at 50% 0%, rgba(124,102,192,.06), transparent)', pointerEvents: 'none' }} />

        <div ref={ctaRef} className={`lp-reveal ${ctaIn ? 'in' : ''}`} style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '2.4rem', animation: 'moonBob 4s ease-in-out infinite', display: 'inline-block', marginBottom: '1.4rem' }}>◐</div>
          <h2 style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: 'clamp(2rem,4vw,3.2rem)', fontWeight: 500, lineHeight: 1.2, marginBottom: '1.1rem' }}>
            Ready to Map<br />
            <em style={{ fontStyle: 'italic' }} className="lp-shimmer">Your Journey?</em>
          </h2>
          <p style={{ fontSize: '.95rem', color: 'rgba(234,229,220,.5)', lineHeight: 1.8, maxWidth: 440, margin: '0 auto 2.4rem' }}>
            Start mapping your cycle today — it takes a minute to set up.
          </p>
          <div style={{ display: 'flex', gap: '.9rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="lp-btn-primary" onClick={handleSignUp} style={{ padding: '.95rem 2.4rem', fontSize: '.97rem' }}>
              Begin Your Journey →
            </button>
            <button className="lp-btn-secondary" onClick={handleSignIn} style={{ padding: '.95rem 2.4rem', fontSize: '.97rem' }}>
              Sign In
            </button>
          </div>
          <p style={{ marginTop: '1.5rem', fontSize: '.65rem', color: 'rgba(234,229,220,.25)', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.07em' }}>
            Free · No credit card · Private by design
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ padding: '3rem 2rem', background: '#0D0E16', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '2rem', marginBottom: '2rem' }}>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond','Noto Sans Devanagari',serif", fontSize: '1.15rem', color: '#EAE5DC', marginBottom: '.65rem' }}>◐ Luna Health</div>
            <p style={{ fontSize: '.78rem', color: 'rgba(234,229,220,.38)', lineHeight: 1.7 }}>Your intelligent companion for menstrual health, cycle awareness, and holistic wellness.</p>
          </div>
          {[
            { title: 'Features', items: ['Journey Map', 'AI Analysis', 'Luna Chat', 'Health Profile', 'Predictions'] },
            { title: 'Privacy', items: [{ label: 'Privacy Policy', href: '/privacy' }, { label: 'Terms of Service', href: '/terms' }] },
            ...(SUPPORT_EMAIL ? [{ title: 'Support', items: [{ label: 'Contact', href: `mailto:${SUPPORT_EMAIL}` }] }] : []),
          ].map(col => (
            <div key={col.title}>
              <div style={{ fontSize: '.6rem', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(234,229,220,.28)', marginBottom: '.85rem', fontWeight: 500 }}>{col.title}</div>
              <ul style={{ listStyle: 'none' }}>
                {col.items.map(entry => {
                  const item = typeof entry === 'string' ? entry : entry.label;
                  const Tag = typeof entry === 'string' ? 'span' : 'a';
                  return (
                  <li key={item} style={{ marginBottom: '.38rem' }}>
                    <Tag {...(typeof entry === 'string' ? {} : { href: entry.href })} style={{ fontSize: '.8rem', color: 'rgba(234,229,220,.42)', cursor: 'pointer', transition: 'color .2s', textDecoration: 'none' }}
                      onMouseEnter={e => e.target.style.color = '#EAE5DC'}
                      onMouseLeave={e => e.target.style.color = 'rgba(234,229,220,.42)'}>
                      {item}
                    </Tag>
                  </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ paddingTop: '1.4rem', borderTop: '1px solid rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <p style={{ fontSize: '.68rem', color: 'rgba(234,229,220,.22)', fontFamily: "'Fira Code','Noto Sans Devanagari',monospace" }}>
            © {new Date().getFullYear()} Luna Health · Made with care for women's wellness
          </p>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            {PHASES.map(ph => <div key={ph.id} style={{ width: 6, height: 6, borderRadius: '50%', background: ph.color, opacity: .4 }} />)}
          </div>
        </div>
      </footer>

    </div>
  );
}

export default LandingPage;