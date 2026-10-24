import { useState, useEffect, useCallback, useRef } from "react";
import LandingPage from "./LandingPage";
import { API } from "./api";
import ConsentCheckboxes from "./ConsentCheckboxes";
import { saveGoogleConsent } from "./consentFlags";
import useConsents from "./useConsents";
import RequiredConsentScreen from "./RequiredConsentScreen";
import AiConsentModal from "./AiConsentModal";
import PrivacyPanel from "./PrivacyPanel";
import PeriodDelete from "./PeriodDelete";
import ProfileBanner from "./ProfileBanner";
import { localDateString } from "./localDate";

// ─── PHASE CONFIG ─────────────────────────────────────────────────────────────
const PHASES = {
  menstrual: { name: "Menstrual", territory: "The Valley", days: "Days 1–5", color: "#F28BA0", bg: "#2A1020", glow: "rgba(242, 130, 160, 0.12)", border: "#FF5C7A", muted: "#FFAFC0", icon: "🩸", tip: "Rest, warmth & gentle movement. Your body is releasing and renewing." },
  follicular: { name: "Follicular", territory: "The Ascent", days: "Days 6–13", color: "#64DCB4", bg: "#0E2420", glow: "rgba(100, 220, 180, 0.10)", border: "#2EC4A0", muted: "#A0F0D8", icon: "🌱", tip: "Energy rises. Perfect for new projects, social activities and bold decisions." },
  ovulation: { name: "Ovulation", territory: "The Summit", days: "Day 14±", color: "#FFC84A", bg: "#221800", glow: "rgba(255, 200, 80, 0.10)", border: "#FFAA00", muted: "#FFE0A0", icon: "✨", tip: "Peak energy & confidence. Magnetic, communicative, most fertile window." },
  luteal: { name: "Luteal", territory: "The Return", days: "Days 15–28", color: "#AA8CF0", bg: "#180F30", glow: "rgba(170, 140, 240, 0.12)", border: "#8860E0", muted: "#D0C0FF", icon: "🌙", tip: "Turn inward. Good for reflection, creative depth, and completing things." },
  unknown: { name: "Uncharted", territory: "Uncharted", days: "—", color: "#A889C0", bg: "#241539", glow: "rgba(168, 137, 192, 0.15)", border: "#3D2860", muted: "#7A5C90", icon: "·", tip: "Log a period to calibrate your journey map." },
};

function getPhaseForCycleDay(day, len = 28) {
  if (day <= 0) return "unknown";
  const d = ((day - 1) % len) + 1;
  if (d <= 5) return "menstrual";
  if (d <= Math.round(len * 0.46)) return "follicular";
  if (d <= Math.round(len * 0.57)) return "ovulation";
  return "luteal";
}

function buildTimeline(periods, avgCycle = 28) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const BACK = 90, FWD = 60;
  const sorted = [...periods].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  const last = sorted[0];
  return Array.from({ length: BACK + FWD }, (_, i) => {
    const date = new Date(today); date.setDate(today.getDate() - BACK + i); date.setHours(0, 0, 0, 0);
    let phase = "unknown", cycleDay = null;
    if (last) {
      const ref = new Date(last.start_date); ref.setHours(0, 0, 0, 0);
      const diff = Math.round((date - ref) / 86400000);
      cycleDay = diff >= 0 ? (diff % avgCycle) + 1 : avgCycle - (Math.abs(diff) % avgCycle || avgCycle);
      if (cycleDay <= 0) cycleDay += avgCycle;
      phase = getPhaseForCycleDay(cycleDay, avgCycle);
    }
    const loggedPeriod = sorted.find(p => {
      const ps = new Date(p.start_date); ps.setHours(0, 0, 0, 0);
      const pe = p.end_date ? new Date(p.end_date) : null; if (pe) pe.setHours(0, 0, 0, 0);
      return date >= ps && (!pe || date <= pe);
    });
    const isPeriodStart = sorted.some(p => { const ps = new Date(p.start_date); ps.setHours(0, 0, 0, 0); return ps.getTime() === date.getTime(); });
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;
    const isPredictedPeriodStart = isFuture && phase === "menstrual" && (i === 0 || getPhaseForCycleDay(cycleDay - 1, avgCycle) !== "menstrual");
    return { date, phase, cycleDay, loggedPeriod, isPeriodStart, isToday, isFuture, isPredictedPeriodStart, index: i };
  });
}

// Simple stats to explain period patterns in plain language
function computePeriodStats(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const sorted = [...periods].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  const count = sorted.length;

  const diffDays = (a, b) => Math.round((b - a) / 86400000);

  const cycleLengths = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].start_date);
    const curr = new Date(sorted[i].start_date);
    cycleLengths.push(diffDays(prev, curr));
  }

  const durations = sorted
    .filter(p => p.end_date)
    .map(p => {
      const s = new Date(p.start_date);
      const e = new Date(p.end_date);
      return diffDays(s, e) + 1;
    });

  const painValues = sorted
    .map(p => p.pain_level)
    .filter(v => typeof v === "number" && !Number.isNaN(v));

  const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const avgCycle = cycleLengths.length ? Math.round(avg(cycleLengths)) : null;
  const minCycle = cycleLengths.length ? Math.min(...cycleLengths) : null;
  const maxCycle = cycleLengths.length ? Math.max(...cycleLengths) : null;

  const avgDuration = durations.length ? Math.round(avg(durations)) : null;
  const minDuration = durations.length ? Math.min(...durations) : null;
  const maxDuration = durations.length ? Math.max(...durations) : null;

  const avgPain = painValues.length ? Number(avg(painValues).toFixed(1)) : null;

  const flowCounts = {};
  sorted.forEach(p => {
    if (p.flow_intensity) {
      flowCounts[p.flow_intensity] = (flowCounts[p.flow_intensity] || 0) + 1;
    }
  });
  const flowEntries = Object.entries(flowCounts);
  const commonFlow = flowEntries.length
    ? flowEntries.sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    count,
    avgCycle,
    minCycle,
    maxCycle,
    avgDuration,
    minDuration,
    maxDuration,
    avgPain,
    commonFlow,
  };
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Outfit:wght@300;400;500;600&family=Fira+Code:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1A0F2E;--s1:#241539;--s2:#2E1D45;--s3:#3D2860;
  --border:#3D2860;--border-h:#4A3575;
  --cream:#F5EEF8;--muted:#A889C0;--muted-h:#7A5C90;--r:8px;
  --cta:#FF6B8A;--cta-hover:#FF4D70;
}
body{font-family:'Outfit',sans-serif;background:var(--bg);color:var(--cream);height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.6}
#root{height:100vh;display:flex;flex-direction:column}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}

/* AUTH */
.auth-wrap{min-height:100vh;background:var(--bg);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.auth-orb{position:absolute;border-radius:50%;filter:blur(120px);pointer-events:none;animation:orbIn 1.5s ease both}
.auth-orb-a{width:500px;height:500px;background:radial-gradient(circle,rgba(196,84,74,0.18),transparent 70%);top:-100px;right:-100px;animation-delay:.2s}
.auth-orb-b{width:400px;height:400px;background:radial-gradient(circle,rgba(124,102,192,0.12),transparent 70%);bottom:-80px;left:-80px;animation-delay:.5s}
@keyframes orbIn{from{opacity:0}to{opacity:1}}
.auth-card{position:relative;z-index:1;width:100%;max-width:380px;background:var(--s1);border:1px solid var(--border);padding:2.5rem;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:cardIn .5s cubic-bezier(.4,0,.2,1) both}
@keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(.98)}to{opacity:1;transform:none}}
.auth-logo{text-align:center;margin-bottom:2rem}
.auth-moon{display:block;font-size:2.2rem;margin-bottom:.5rem;animation:moonFloat 4s ease-in-out infinite}
@keyframes moonFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.auth-logo h1{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:500;color:var(--cream);letter-spacing:.02em}
.auth-logo p{font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-top:.3rem}
.auth-tabs{display:flex;gap:.3rem;margin-bottom:1.8rem}
.auth-tab{flex:1;padding:.55rem;background:transparent;border:1px solid transparent;color:var(--muted);font-family:'Outfit',sans-serif;font-size:.75rem;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:6px;transition:all .2s}
.auth-tab.on{color:#FF8A80;border-color:rgba(196,84,74,.3);background:rgba(196,84,74,.07)}
.auth-tab:not(.on):hover{color:var(--cream)}
.pw-wrap{position:relative}
.f .pw-wrap input{padding-right:3rem}
.pw-toggle{position:absolute;top:50%;right:0;transform:translateY(-50%);width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1rem;border-radius:var(--r)}
.pw-toggle:hover{color:var(--cream)}
.pw-toggle:focus-visible{outline:2px solid #FF8A80;outline-offset:-2px}
.pw-hint{font-size:.65rem;color:var(--muted);margin-top:.3rem}
.legal-link{color:#E8A09A;text-decoration:underline}
.legal-link:hover{color:#FFC1BB}

/* FORM */
.f{margin-bottom:1rem}
.f label{display:block;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem;font-weight:500}
.f input,.f select,.f textarea{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--cream);padding:.62rem .85rem;font-family:'Outfit',sans-serif;font-size:.82rem;outline:none;border-radius:var(--r);transition:border-color .2s,box-shadow .2s,background .2s;appearance:none}
.f input:focus,.f select:focus,.f textarea:focus{border-color:rgba(196,84,74,.5);background:rgba(255,255,255,.06);box-shadow:0 0 0 3px rgba(196,84,74,.1)}
.f input:hover:not(:focus),.f select:hover:not(:focus){border-color:var(--border-h)}
.f textarea{resize:vertical;min-height:70px}
.f select option{background:var(--s1)}
.f-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}

/* Fix checkbox and range controls in questionnaire */
.f input[type="checkbox"]{
  width:auto;
  padding:0;
  margin:0;
  margin-right:.35rem;
  border:none;
  background:transparent;
  appearance:auto;
  cursor:pointer;
}
.f input[type="range"]{
  width:100%;
  padding:0;
  margin-top:.25rem;
  background:transparent;
  border:none;
  appearance:auto;
}

/* BUTTONS */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.62rem 1.2rem;font-family:'Outfit',sans-serif;font-size:.78rem;font-weight:500;cursor:pointer;border:none;border-radius:var(--r);transition:all .2s cubic-bezier(.4,0,.2,1);user-select:none}
.btn:active:not(:disabled){transform:scale(.97)}
.btn-p{background:#FF6B8A;color:#fff;box-shadow:0 0 20px rgba(255, 107, 138, 0.45)}
.btn-p:hover:not(:disabled){background:#FF4D70;transform:translateY(-1px)}
.btn-p:disabled{opacity:.4;cursor:not-allowed}
.btn-g{background:transparent;border:1px solid var(--border);color:var(--muted)}
.btn-g:hover:not(:disabled){border-color:var(--border-h);color:var(--cream);background:var(--s2)}
.btn-g:disabled{opacity:.4;cursor:not-allowed}
.btn-full{width:100%}
.btn-sm{padding:.4rem .85rem;font-size:.72rem;min-height:44px}
.err{font-size:.75rem;color:#FF6B8A;padding:.55rem .8rem;background:rgba(255,107,138,0.1);border:1px solid rgba(255,107,138,0.3);border-radius:6px;margin-top:.5rem;animation:feedIn .2s ease}
@keyframes feedIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,107,138,0.3);border-top-color:#FF6B8A;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-c{display:flex;align-items:center;justify-content:center;gap:.75rem;padding:3rem;color:var(--muted);font-size:.78rem}

/* TOPBAR */
.topbar{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;background:#0F081A;backdrop-filter:blur(12px);border-bottom:1px solid var(--border);z-index:20}
.tlogo{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:500;color:var(--cream);letter-spacing:.02em;display:flex;align-items:center;gap:.5rem}
.tlogo .m{display:inline-block;animation:moonFloat 4s ease-in-out infinite}
.phase-pill{display:flex;align-items:center;gap:.4rem;padding:.28rem .7rem;border-radius:100px;font-size:.72rem;font-weight:500;letter-spacing:.03em;border:1px solid;white-space:nowrap;transition:all .4s}
.cday-badge{font-family:'Fira Code',monospace;font-size:.68rem;color:var(--muted);padding:.25rem .6rem;border:1px solid var(--border);border-radius:4px;white-space:nowrap}
.avatar-btn{width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:600;color:#fff;border:none;transition:transform .2s,box-shadow .2s;flex-shrink:0}
.avatar-btn:hover{transform:scale(1.08)}

/* JOURNEY CANVAS */
.j-canvas{flex:1;overflow:hidden;position:relative;background:var(--bg)}
.j-scroll{width:100%;height:100%;overflow-x:auto;overflow-y:hidden;cursor:grab;user-select:none}
.j-scroll:active{cursor:grabbing}
.j-inner{height:100%;position:relative;display:flex;flex-direction:column}

/* Month row */
.month-row{height:26px;flex-shrink:0;position:relative;background:rgba(7,8,12,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.month-lbl{position:absolute;bottom:5px;font-size:.58rem;color:var(--muted);font-weight:500;letter-spacing:.1em;text-transform:uppercase;font-family:'Fira Code',monospace;padding-left:6px}

/* Terrain */
.terrain{flex:1;position:relative;overflow:hidden}
.phase-bg{position:absolute;top:0;bottom:0;transition:background .3s}
.phase-sep{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.1);pointer-events:none;z-index:2}
.phase-sep-lbl{position:absolute;top:8px;font-size:.58rem;letter-spacing:.07em;text-transform:uppercase;font-weight:500;white-space:nowrap;z-index:3;padding:2px 7px;border-radius:3px;backdrop-filter:blur(4px);pointer-events:none;left:5px}
.week-sep{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.03);pointer-events:none;z-index:1}
.road{position:absolute;left:0;right:0;height:2px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.05);z-index:1}
.p-dot{position:absolute;border-radius:50%;z-index:10;top:50%;transform:translate(-50%,-50%);cursor:pointer;transition:transform .2s,box-shadow .2s}
.p-dot:hover{transform:translate(-50%,-50%) scale(1.6)}

/* Today beacon */
.beacon{position:absolute;top:0;bottom:0;width:2px;z-index:15;pointer-events:none}
.beacon-line{position:absolute;top:0;bottom:0;left:0;width:2px;animation:bPulse 2.5s ease-in-out infinite}
@keyframes bPulse{0%,100%{opacity:.6}50%{opacity:1}}
.beacon-dot{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:13px;height:13px;border-radius:50%;z-index:16}
.beacon-dot::after{content:'';position:absolute;inset:-7px;border-radius:50%;animation:ring 2.5s ease-in-out infinite;border:1.5px solid;opacity:0}
@keyframes ring{0%{transform:scale(1);opacity:.5}100%{transform:scale(3);opacity:0}}
.beacon-lbl{position:absolute;bottom:calc(50% + 15px);left:50%;transform:translateX(-50%);font-size:.58rem;font-family:'Fira Code',monospace;font-weight:500;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:3px;white-space:nowrap;pointer-events:none}

/* Predicted stripe */
.pred-stripe{position:absolute;top:0;bottom:0;pointer-events:none;background:repeating-linear-gradient(90deg,rgba(196,84,74,.07) 0,rgba(196,84,74,.07) 6px,transparent 6px,transparent 14px);z-index:3;border-left:1px dashed rgba(196,84,74,.28)}

/* Phase hover card */
.ph-card{position:absolute;z-index:25;bottom:12px;background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:.95rem 1.1rem;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:210px;max-width:270px;animation:cardIn .2s ease;pointer-events:none}
.ph-card-title{font-family:'Cormorant Garamond',serif;font-size:1.1rem;letter-spacing:.01em;margin-bottom:.2rem;color:var(--cream)}
.ph-card-sub{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.55rem;font-weight:500}
.ph-card-tip{font-size:.77rem;color:var(--cream);line-height:1.6;opacity:.85}

/* Marker detail card */
.mk-card{position:absolute;z-index:25;background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:.95rem 1.1rem;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:195px;animation:cardIn .2s ease}
.mk-card-close{position:absolute;top:7px;right:8px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;line-height:1;transition:color .2s}
.mk-card-close:hover{color:var(--cream)}

/* STATS STRIP */
.stats-strip{height:58px;flex-shrink:0;border-top:1px solid var(--border);background:#120A22;display:flex;align-items:center;padding:0 1.5rem}
.st-item{flex:1;display:flex;flex-direction:column;align-items:center;border-right:1px solid var(--border)}
.st-item:last-child{border-right:none}
.st-val{font-family:'Outfit',sans-serif;font-variant-numeric:lining-nums;font-size:1.4rem;line-height:1;letter-spacing:.01em;color:#FF8FAA}
.st-lbl{font-size:.58rem;color:#7A5C90;text-transform:uppercase;letter-spacing:.1em;margin-top:2px;font-weight:500}

/* DOCK */
.dock{height:64px;flex-shrink:0;background:var(--s1);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-around;padding:0 .75rem;z-index:20}
.dk{display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:.4rem .75rem;border-radius:8px;transition:all .2s;user-select:none;min-width:56px;background:transparent;border:none;color:var(--muted)}
.dk:hover{color:var(--muted-h);background:var(--s2)}
.dk.on{color:#64DCB4}
.dk .di{font-size:1.15rem;transition:transform .2s}
.dk:hover .di{transform:translateY(-2px)}
.dk .dl{font-size:.58rem;font-weight:500;letter-spacing:.05em;text-transform:uppercase}
.dock-log{width:46px;height:46px;border-radius:50%;background:#FF6B8A;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.4rem;color:#fff;box-shadow:0 0 20px rgba(255, 107, 138, 0.45);transition:all .2s;user-select:none;flex-shrink:0}
.dock-log:hover{transform:scale(1.1) rotate(8deg);background:#FF4D70;box-shadow:0 0 25px rgba(255, 107, 138, 0.6)}
.dock-log:active{transform:scale(.95)}

/* OVERLAY / DRAWER */
.o-backdrop{position:fixed;inset:0;background:rgba(7,8,12,.8);backdrop-filter:blur(6px);z-index:40;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.drawer{position:fixed;bottom:0;left:0;right:0;background:var(--s1);border-top:1px solid var(--border);border-radius:16px 16px 0 0;z-index:50;display:flex;flex-direction:column;box-shadow:0 -20px 60px rgba(0,0,0,.6);animation:drawIn .35s cubic-bezier(.4,0,.2,1);max-height:90vh}
@keyframes drawIn{from{transform:translateY(100%)}to{transform:translateY(0)}}
.drawer-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.13);margin:10px auto 0;flex-shrink:0;cursor:pointer}
.drawer-head{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem .75rem;flex-shrink:0;border-bottom:1px solid var(--border)}
.drawer-title{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:500;letter-spacing:.01em}
.drawer-close{background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--muted);transition:color .2s;padding:.2rem;line-height:1;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}
.drawer-close:hover{color:var(--cream)}
:focus-visible{outline:2px solid #E8A09A;outline-offset:2px}
:focus:not(:focus-visible){outline:none}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important}}
.drawer-body{flex:1;overflow-y:auto;padding:1.25rem 1.5rem}

/* CHAT */
.chat-layout{display:flex;flex:1;overflow:hidden;position:relative}
.chat-hist-panel{width:195px;flex-shrink:0;border-right:1px solid var(--border);background:var(--s2);display:flex;flex-direction:column;overflow:hidden}
.ch-head{padding:.8rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.ch-lbl{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:500}
.ch-list{flex:1;overflow-y:auto;padding:.35rem 0}
.ch-item{padding:.48rem 1rem;cursor:pointer;transition:background .15s;font-size:.72rem;color:var(--muted-h);line-height:1.4}
.ch-item:hover{background:rgba(255,255,255,.04);color:var(--cream)}
.ch-item.on{background:rgba(196,84,74,.08);color:#E0A09A}
.ch-empty{padding:2rem 1rem;text-align:center;font-size:.72rem;color:var(--muted);line-height:1.7}
.chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.chat-msgs{flex:1;overflow-y:auto;padding:1.2rem;display:flex;flex-direction:column;gap:.8rem}
.bubble{max-width:78%;padding:.8rem 1rem;border-radius:10px;font-size:.82rem;line-height:1.65;animation:bubIn .3s cubic-bezier(.4,0,.2,1)}
@keyframes bubIn{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}
.bubble.user{align-self:flex-end;background:rgba(196,84,74,.12);border:1px solid rgba(196,84,74,.2)}
.bubble.asst{align-self:flex-start;background:var(--s2);border:1px solid var(--border)}
.bname{font-size:.6rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:.32rem;font-weight:500}
.bubble.user .bname{color:rgba(196,84,74,.7)}
.chat-in{padding:.8rem 1.2rem;border-top:1px solid var(--border);background:var(--s2);display:flex;gap:.6rem;align-items:flex-end}
.chat-in textarea{flex:1;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--cream);padding:.62rem .9rem;font-family:'Outfit',sans-serif;font-size:.82rem;resize:none;height:44px;min-height:44px;max-height:150px;outline:none;border-radius:var(--r);transition:border-color .2s,box-shadow .2s;line-height:1.5}
.chat-in textarea:focus{border-color:rgba(255,107,138,0.4);box-shadow:0 0 3px rgba(255,107,138,0.15)}
.tdots{display:flex;gap:4px;align-items:center;padding:.32rem 0}
.tdots span{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:td 1.4s ease-in-out infinite}
.tdots span:nth-child(2){animation-delay:.2s}
.tdots span:nth-child(3){animation-delay:.4s}
@keyframes td{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-7px);opacity:1}}

/* THINKING */
.tk-hd{display:flex;align-items:center;gap:.4rem;font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:#FF6B8A;margin-bottom:.38rem}
.tk-pulse{width:6px;height:6px;border-radius:50%;background:#FF6B8A;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.tk-lines{border-left:1px solid rgba(255,107,138,0.2);padding-left:.7rem;max-height:100px;overflow:hidden;mask-image:linear-gradient(to bottom,black 60%,transparent);-webkit-mask-image:linear-gradient(to bottom,black 60%,transparent)}
.tk-line{font-size:.67rem;color:var(--muted);line-height:1.5;opacity:0;animation:tl 1s ease forwards;font-family:'Fira Code',monospace}
@keyframes tl{0%{opacity:0;transform:translateX(-4px)}15%{opacity:.5;transform:none}75%{opacity:.5}100%{opacity:0;transform:translateX(2px)}}
.tk-toggle{display:inline-flex;align-items:center;gap:.35rem;font-size:.6rem;color:var(--muted);cursor:pointer;padding:.2rem .55rem;background:rgba(255,107,138,0.08);border:1px solid rgba(255,107,138,0.15);border-radius:100px;margin-bottom:.45rem;transition:all .2s}
.tk-toggle:hover{color:#64DCB4;border-color:rgba(100,220,180,0.25)}
.tk-exp{border-left:1px solid rgba(100,220,180,0.14);padding-left:.7rem;margin-bottom:.45rem;font-size:.67rem;color:var(--muted);line-height:1.6;max-height:180px;overflow-y:auto;font-family:'Fira Code',monospace;animation:feedIn .3s ease}

/* ANALYSIS */
.ins-quote{font-size:.85rem;line-height:1.75;color:var(--cream);padding:1rem 1.1rem;background:rgba(255,107,138,0.08);border-left:3px solid #FF6B8A;border-radius:0 8px 8px 0;margin-bottom:1.2rem}
.ins-lbl{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.55rem;font-weight:500}
.ins-row{display:flex;gap:.55rem;margin-bottom:.45rem;font-size:.8rem;line-height:1.65}
.score-ring{flex-shrink:0;position:relative;width:108px;height:108px}
.score-ring svg{transform:rotate(-90deg)}
.score-num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.score-num .n{font-family:'Cormorant Garamond',serif;font-size:1.85rem;color:#E8A09A;line-height:1}
.score-num .s{font-size:.55rem;color:var(--muted);letter-spacing:.1em}
.sbar{margin-bottom:.8rem}
.sbar-lbl{display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted);margin-bottom:.3rem}
.sbar-track{height:3px;background:rgba(255,255,255,.05);border-radius:2px;overflow:hidden}
.sbar-fill{height:3px;background:linear-gradient(90deg,#C4544A,#E8A09A);transition:width 1.2s cubic-bezier(.4,0,.2,1);border-radius:2px}
.pred-tile{padding:.75rem 1rem;background:rgba(255,255,255,.03);border:1px solid var(--border);flex:1;min-width:120px;border-radius:var(--r)}
.pred-lbl{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:.3rem;font-weight:500}
.pred-val{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#E8A09A}

/* MODAL */
.modal-ov{position:fixed;inset:0;background:rgba(7,8,12,.85);backdrop-filter:blur(6px);z-index:60;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease}
.modal{background:var(--s1);border:1px solid var(--border);width:100%;max-width:450px;max-height:88vh;overflow-y:auto;padding:2rem;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.6);animation:cardIn .3s cubic-bezier(.4,0,.2,1)}
.modal-title{font-family:'Cormorant Garamond',serif;font-size:1.35rem;color:#E8A09A;margin-bottom:1.4rem}
.modal-foot{display:flex;gap:.65rem;justify-content:flex-end;margin-top:1.4rem;position:sticky;bottom:-2rem;margin-left:-2rem;margin-right:-2rem;margin-bottom:-2rem;padding:1rem 2rem;background:var(--s1);border-top:1px solid var(--border)}

/* CHIPS */
.chips{display:flex;flex-wrap:wrap;gap:.32rem}
.chip{padding:.22rem .68rem;font-size:.7rem;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted);font-family:'Outfit',sans-serif;transition:all .15s;border-radius:100px;user-select:none}
.chip.on{border-color:#C4544A;color:#C4544A;background:rgba(196,84,74,.1)}
.chip:hover:not(.on){border-color:var(--border-h);color:var(--cream)}

/* MISC */
.divider{height:1px;background:var(--border);margin:1.1rem 0}
.badge{display:inline-block;padding:.15rem .55rem;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;border-radius:100px;font-weight:500}
.b-r{background:rgba(196,84,74,.12);color:#C4544A;border:1px solid rgba(196,84,74,.25)}
.b-g{background:rgba(74,158,110,.1);color:#4A9E6E;border:1px solid rgba(74,158,110,.2)}
.b-m{background:rgba(255,255,255,.05);color:var(--muted);border:1px solid rgba(255,255,255,.08)}
.empty{text-align:center;padding:3rem 2rem}
.empty .ei{font-size:1.8rem;opacity:.35;margin-bottom:.75rem}
.empty p{font-size:.8rem;color:var(--muted);line-height:1.7}
.q-sec-title{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#E8A09A;margin-bottom:.9rem;letter-spacing:.01em}
.q-sec{background:rgba(255,255,255,.025);border:1px solid var(--border);border-radius:var(--r);padding:1.1rem;margin-bottom:.7rem}

/* ONBOARDING */
.intro-pill{display:inline-flex;align-items:center;gap:.4rem;padding:.18rem .7rem;border-radius:999px;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:#7ECECE;border:1px solid rgba(126,206,206,.4);background:rgba(126,206,206,.05);margin-bottom:.7rem}
.intro-dots{display:flex;gap:.35rem;margin-top:1rem}
.intro-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.15);transition:all .2s}
.intro-dot.on{width:14px;background:#C4544A}
.intro-kbd{display:inline-flex;align-items:center;justify-content:center;padding:.12rem .45rem;border-radius:4px;border:1px solid rgba(255,255,255,.12);font-size:.68rem;font-family:'Fira Code',monospace;background:rgba(0,0,0,.35);margin-left:.3rem}

/* CHAT AVATAR (LUNA) */
.chat-head-left{display:flex;align-items:center;gap:.65rem}
.ca-orbit{width:40px;height:40px;border-radius:50%;position:relative;perspective:400px}
.ca-bubble{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 30% 20%,#FFEAE3,#E28B78 40%,#5B3550 85%);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.55);transform-origin:center bottom;transition:transform .4s,box-shadow .4s}
.ca-face{position:relative;width:70%;height:70%;border-radius:50%;background:radial-gradient(circle at 30% 20%,#FCE6DA,#F2C2A4 55%,#BA7F60 100%);overflow:hidden;display:flex;align-items:center;justify-content:center}
.ca-hair{position:absolute;inset:-6px 0 35%;background:radial-gradient(circle at 20% 0,#2B102A,#6B3A71);border-radius:60% 60% 40% 40%}
.ca-eye{position:absolute;width:6px;height:6px;border-radius:50%;background:#1b0e1a;top:52%;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
.ca-eye.left{left:38%}
.ca-eye.right{right:38%}
.ca-mouth{position:absolute;width:12px;height:6px;border-radius:0 0 12px 12px;border-bottom:2px solid rgba(82,34,40,.9);bottom:32%}
.ca-shoulders{position:absolute;bottom:-4px;left:8px;right:8px;height:16px;border-radius:14px 14px 6px 6px;background:linear-gradient(135deg,#C4544A,#7C66C0)}
.ca-orbit.on .ca-bubble{animation:talkTilt 1.6s ease-in-out infinite}
.ca-orbit.on .ca-mouth{animation:talkMouth 1s ease-in-out infinite}
.ca-orbit.on .ca-eye.left{animation:blink 5s ease-in-out infinite}
.ca-orbit.on .ca-eye.right{animation:blink 5s ease-in-out infinite .12s}
@keyframes talkTilt{0%,100%{transform:rotate3d(0,0,0,0deg) translateY(0)}30%{transform:rotate3d(0,1,0,5deg) translateY(-1px)}60%{transform:rotate3d(0,-1,0,4deg) translateY(-.5px)}}
@keyframes talkMouth{0%,100%{transform:scaleX(1)}40%{transform:scaleX(1.18)}70%{transform:scaleX(.85)}}
@keyframes blink{0%,88%,92%,100%{transform:scaleY(1)}90%{transform:scaleY(.15)}}

.chat-hist-toggle,.chat-hist-back{display:none;min-height:44px;min-width:44px;padding:0 .8rem;background:none;border:1px solid var(--border);color:var(--muted);border-radius:var(--r);cursor:pointer;font-size:.75rem;font-family:inherit}
.chat-disclaimer{padding:.35rem 1.2rem .6rem;font-size:.68rem;color:var(--muted);background:var(--s2);line-height:1.4}
@media(max-width:640px){.chat-hist-toggle,.chat-hist-back{display:inline-flex;align-items:center;justify-content:center}.chat-hist-panel{display:none}.chat-hist-panel.open{display:flex;position:absolute;inset:0;width:100%;z-index:5;border-right:none}.ch-item{min-height:44px;display:flex;align-items:center}.f-row{grid-template-columns:1fr}}
`;

function injectStyles() {
  if (document.getElementById("luna-v3")) return;
  const s = document.createElement("style"); s.id = "luna-v3"; s.textContent = STYLES;
  document.head.appendChild(s);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function Spinner() { return <span className="spinner" />; }
function LoadingC({ text }) { return <div className="loading-c"><Spinner /><span>{text}</span></div>; }
function Err({ msg }) { if (!msg) return null; return <div className="err">⚠ {msg}</div>; }

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-ov" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.4rem" }}>
          <div className="modal-title">{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.2rem", lineHeight: 1 }}>×</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ─── ONBOARDING OVERLAY ─────────────────────────────────────────────────────────
function Onboarding({ onClose, email }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: "Set up your health profile",
      body: "Start by filling a quick health questionnaire so Luna understands your body, symptoms and cycle history. It’s not a diagnosis, just context to make future insights more personal.",
      badge: "Health Profile",
    },
    {
      title: "Your cycle journey map",
      body: "Scroll sideways to explore past and predicted cycles. Hover over coloured bands to see which phase you're in and what it means for energy, mood and focus.",
      badge: "Journey Canvas",
    },
    {
      title: "Logging periods & symptoms",
      body: "Tap the glowing + button in the dock to log a new period. Add flow, pain and symptoms – Luna uses this to understand your pattern over time.",
      badge: "Log Periods",
    },
    {
      title: "AI health insights",
      body: "In Insights, Luna analyses your last cycles to explain regularity, predicted dates and key patterns, with clear recommendations in everyday language.",
      badge: "AI Analysis",
    },
    {
      title: "Chat with Luna",
      body: "Use Chat for questions about cramps, cycle changes or patterns you’re worried about. Luna will reference your data when available, but never diagnose.",
      badge: "Chat",
    },
  ];

  const active = steps[step];

  function finish() {
    try {
      const key = email ? `luna_onboarding_done_${email}` : "luna_onboarding_done";
      window.localStorage.setItem(key, "1");
    } catch {}
    onClose();
  }

  return (
    <div className="modal-ov" style={{ zIndex: 70 }} onClick={e => e.target === e.currentTarget && finish()}>
      <div className="modal" style={{ maxWidth: 520, animationDuration: ".35s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
          <div>
            <div className="intro-pill"><span style={{ fontSize: "0.8rem" }}>◐</span>Welcome tour</div>
            <div className="modal-title" style={{ marginBottom: 0 }}>Meet your Luna journey</div>
          </div>
          <button onClick={finish} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.2rem", lineHeight: 1 }}>Skip</button>
        </div>
        <div style={{ fontSize: ".86rem", color: "var(--muted)", marginBottom: "1.1rem" }}>
          {active.badge && <span className="badge b-m" style={{ marginBottom: ".5rem", display: "inline-flex" }}>{active.badge}</span>}
          <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.2rem", color: "var(--cream)", margin: ".25rem 0 .55rem" }}>{active.title}</h3>
          <p style={{ lineHeight: 1.75 }}>{active.body}</p>
        </div>
        <div style={{ fontSize: ".74rem", color: "var(--muted)", marginBottom: ".8rem" }}>
          Use your mouse wheel or trackpad to pan across the map. On touch devices, drag sideways with one finger.
          <span className="intro-kbd">drag</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.1rem" }}>
          <div className="intro-dots">
            {steps.map((_, i) => (
              <div key={i} className={`intro-dot ${i === step ? "on" : ""}`} />
            ))}
          </div>
          <div style={{ display: "flex", gap: ".6rem" }}>
            {step > 0 && (
              <button className="btn btn-g btn-sm" type="button" onClick={() => setStep(s => Math.max(0, s - 1))}>
                Back
              </button>
            )}
            <button
              className="btn btn-p btn-sm"
              type="button"
              onClick={() => {
                if (step < steps.length - 1) setStep(s => s + 1);
                else finish();
              }}
            >
              {step < steps.length - 1 ? "Next" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── THINKING MESSAGE ─────────────────────────────────────────────────────────
function parseThink(content) {
  const m = content.match(/<think>([\s\S]*?)<\/think>/);
  if (!m) return { think: null, response: content.trim() };
  return { think: m[1].trim(), response: content.replace(/<think>[\s\S]*?<\/think>/, "").trim() };
}

function ThinkMsg({ content }) {
  const { think, response } = parseThink(content);
  const [phase, setPhase] = useState(think ? "anim" : "done");
  const [expanded, setExpanded] = useState(false);
  const lines = think ? think.split("\n").filter(l => l.trim()) : [];
  useEffect(() => {
    if (phase === "anim") { const t = setTimeout(() => setPhase("done"), (lines.length * 0.15 + 1.3) * 1000); return () => clearTimeout(t); }
  }, [phase]);
  if (!think) return <div style={{ whiteSpace: "pre-wrap" }}>{response}</div>;
  return (
    <div>
      {phase === "anim" && <div><div className="tk-hd"><span className="tk-pulse" />Thinking…</div><div className="tk-lines">{lines.map((l, i) => <div key={i} className="tk-line" style={{ animationDelay: `${i * .15}s` }}>{l}</div>)}</div></div>}
      {phase === "done" && think && <>
        <div className="tk-toggle" onClick={() => setExpanded(e => !e)}><span style={{ color: "#7ECECE" }}>{expanded ? "▾" : "▸"}</span>Thought process</div>
        {expanded && <div className="tk-exp">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
      </>}
      {phase === "done" && <div style={{ whiteSpace: "pre-wrap", animation: "feedIn .4s ease both" }}>{response}</div>}
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthScreen({ onLogin, initialMode = "login" }) {
  const [tab, setTab] = useState(initialMode); 
  const [email, setEmail] = useState(""); 
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false); 
  const [err, setErr] = useState("");
  const [message, setMessage] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const needsConsent = tab === "register" && !(adult && accepted);
  
  async function submit(e) {
    e.preventDefault(); setErr(""); setMessage(""); setLoading(true);
    try {
      const d = tab === "login"
        ? await API.auth.login({ email, password: pass })
        : await API.auth.register({ email, password: pass, accepted_privacy_policy: accepted, confirmed_18_plus: adult });
      
      if (d.message && d.message.includes("verify")) {
        // Registration successful but email verification required
        setMessage(d.message);
        return;
      }
      
      onLogin(d.access_token, d.refresh_token, email);
    } catch (e) { 
      setErr(e.message); 
    } finally { setLoading(false); }
  }
  
  async function handleGoogleSignIn() {
    setLoading(true);
    try {
      saveGoogleConsent({ accepted, adult });
      const response = await API.auth.getGoogleAuthUrl();
      window.location.href = response.auth_url;
    } catch (e) {
      setErr("Failed to initiate Google Sign-In");
      setLoading(false);
    }
  }
  
  async function handleResendVerification(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await API.verify.resend(email);
      setMessage("Verification email sent! Please check your inbox.");
      setShowResendVerification(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  
  async function handlePasswordReset(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await API.auth.requestPasswordReset({ email });
      setMessage(response.message);
      setShowPasswordReset(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  
  if (showResendVerification) {
    return (
      <div className="auth-wrap">
        <div className="auth-orb auth-orb-a" /><div className="auth-orb auth-orb-b" />
        <div className="auth-card">
          <div className="auth-logo"><span className="auth-moon">◐</span><h1>Luna Health</h1><p>Resend Verification</p></div>
          <form onSubmit={handleResendVerification}>
            <div className="f"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@gmail.com" required autoFocus /></div>
            <Err msg={err} />
            {message && <div style={{ color: "#5FA87A", fontSize: ".8rem", marginBottom: "1rem", textAlign: "center" }}>{message}</div>}
            <button className="btn btn-p btn-full" style={{ marginTop: "1.1rem" }} type="submit" disabled={loading}>
              {loading ? <><Spinner /> Sending…</> : "Resend Verification Email"}
            </button>
            <button 
              type="button" 
              className="btn btn-sm" 
              style={{ marginTop: "0.5rem", background: "transparent", border: "1px solid var(--border)" }}
              onClick={() => setShowResendVerification(false)}
            >
              Back to Login
            </button>
          </form>
        </div>
      </div>
    );
  }
  
  if (showPasswordReset) {
    return (
      <div className="auth-wrap">
        <div className="auth-orb auth-orb-a" /><div className="auth-orb auth-orb-b" />
        <div className="auth-card">
          <div className="auth-logo"><span className="auth-moon">◐</span><h1>Luna Health</h1><p>Reset Password</p></div>
          <form onSubmit={handlePasswordReset}>
            <div className="f"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@gmail.com" required autoFocus /></div>
            <Err msg={err} />
            {message && <div style={{ color: "#5FA87A", fontSize: ".8rem", marginBottom: "1rem", textAlign: "center" }}>{message}</div>}
            <button className="btn btn-p btn-full" style={{ marginTop: "1.1rem" }} type="submit" disabled={loading}>
              {loading ? <><Spinner /> Sending…</> : "Send Reset Link"}
            </button>
            <button 
              type="button" 
              className="btn btn-sm" 
              style={{ marginTop: "0.5rem", background: "transparent", border: "1px solid var(--border)" }}
              onClick={() => setShowPasswordReset(false)}
            >
              Back to Login
            </button>
          </form>
        </div>
      </div>
    );
  }
  
  return (
    <div className="auth-wrap">
      <div className="auth-orb auth-orb-a" /><div className="auth-orb auth-orb-b" />
      <div className="auth-card">
        <div className="auth-logo"><span className="auth-moon">◐</span><h1>Luna Health</h1><p>Your Cycle, Your Journey</p></div>
        <div className="auth-tabs">
          <button className={`auth-tab ${tab === "login" ? "on" : ""}`} onClick={() => { setTab("login"); setErr(""); setMessage(""); }}>Sign In</button>
          <button className={`auth-tab ${tab === "register" ? "on" : ""}`} onClick={() => { setTab("register"); setErr(""); setMessage(""); }}>Register</button>
        </div>
        <form onSubmit={submit}>
          <div className="f"><label>Email</label><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@gmail.com" required autoFocus /></div>
          <div className="f"><label>Password</label>
            <div className="pw-wrap">
              <input type={showPassword ? "text" : "password"} autoComplete={tab === "login" ? "current-password" : "new-password"} minLength={tab === "register" ? 8 : undefined} value={pass} onChange={e => setPass(e.target.value)} placeholder="•••••••" required />
              <button type="button" className="pw-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(v => !v)}>{showPassword ? "🙈" : "👁"}</button>
            </div>
            {tab === "register" && <div className="pw-hint">At least 8 characters</div>}
          </div>
          {tab === "register" && <ConsentCheckboxes adult={adult} accepted={accepted} onAdultChange={setAdult} onAcceptedChange={setAccepted} />}
          <Err msg={err} />
          {message && <div style={{ color: "#5FA87A", fontSize: ".8rem", marginBottom: "1rem", textAlign: "center" }}>{message}</div>}
          <button className="btn btn-p btn-full" style={{ marginTop: "1.1rem" }} type="submit" disabled={loading || needsConsent}>
            {loading ? <><Spinner /> Processing…</> : tab === "login" ? "Log in" : "Create Account"}
          </button>
        </form>
        
        {/* Google Sign-In */}
        <div style={{ margin: "1.5rem 0", textAlign: "center" }}>
          <div style={{ fontSize: ".7rem", color: "var(--muted)", marginBottom: "1rem", position: "relative" }}>
            <span style={{ background: "var(--s1)", padding: "0 1rem" }}>OR</span>
          </div>
          <button 
            className="btn btn-full" 
            onClick={handleGoogleSignIn}
            disabled={loading || needsConsent}
            style={{ 
              background: "#4285F4", 
              border: "1px solid #4285F4",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem"
            }}
          >
            <span style={{ fontSize: "1.2rem" }}>G</span>
            Continue with Google
          </button>
        </div>
        
        {/* Password Reset Link */}
        {tab === "login" && (
          <div style={{ textAlign: "center", marginTop: "1rem" }}>
            <button 
              type="button" 
              className="btn btn-sm" 
              style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: ".75rem" }}
              onClick={() => setShowPasswordReset(true)}
            >
              Forgot password?
            </button>
            <span style={{ margin: "0 0.5rem", color: "var(--muted)" }}>•</span>
            <button 
              type="button" 
              className="btn btn-sm" 
              style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: ".75rem" }}
              onClick={() => setShowResendVerification(true)}
            >
              Resend verification
            </button>
          </div>
        )}
        
        <p style={{ fontSize: ".65rem", color: "var(--muted)", textAlign: "center", marginTop: "1rem" }}>
          {tab === "register" && <>Only Gmail addresses are supported for registration.<br /></>}
          Luna Health is for people aged 18 and over.
        </p>
      </div>
    </div>
  );
}

// ─── JOURNEY MAP ─────────────────────────────────────────────────────────────
const SYMPTOMS_LIST = ["cramps", "bloating", "headache", "fatigue", "mood swings", "acne", "back pain", "nausea", "tender breasts", "insomnia"];
const DAY_W = 34, BACK = 90, FWD = 60, TOTAL = BACK + FWD;

function JourneyMap({ periods, avgCycle, selectedInfo, onSelectMarker, onDismiss, token, onPeriodDeleted }) {
  const scrollRef = useRef(null);
  const [hoveredPhase, setHoveredPhase] = useState(null);
  const [phaseCardX, setPhaseCardX] = useState(0);
  const dragging = useRef(false);
  const dragOrigin = useRef({ x: 0, sl: 0 });

  const timeline = buildTimeline(periods, avgCycle);
  const canvasW = TOTAL * DAY_W;
  const todayX = BACK * DAY_W;

  useEffect(() => {
    if (scrollRef.current) {
      const offset = todayX - scrollRef.current.clientWidth / 2 + DAY_W / 2;
      scrollRef.current.scrollLeft = Math.max(0, offset);
    }
  }, []);

  function onMD(e) { dragging.current = true; dragOrigin.current = { x: e.pageX, sl: scrollRef.current.scrollLeft }; }
  function onMM(e) { if (!dragging.current) return; scrollRef.current.scrollLeft = dragOrigin.current.sl - (e.pageX - dragOrigin.current.x); }
  function onMU() { dragging.current = false; }

  // Phase transitions
  const phaseTrans = [];
  let lastPh = null;
  timeline.forEach((d, i) => { if (d.phase !== lastPh) { phaseTrans.push({ i, phase: d.phase, x: i * DAY_W }); lastPh = d.phase; } });

  // Predicted zones
  const predZones = [];
  let inPred = false, predStart = 0;
  timeline.forEach((d, i) => {
    const isMens = d.isFuture && d.phase === "menstrual";
    if (isMens && !inPred) { inPred = true; predStart = i * DAY_W; }
    if (!isMens && inPred) { predZones.push({ x: predStart, w: i * DAY_W - predStart }); inPred = false; }
  });
  if (inPred) predZones.push({ x: predStart, w: canvasW - predStart });

  // Month labels
  const monthLabels = [];
  let lastM = null;
  timeline.forEach((d, i) => { const m = d.date.getMonth(); if (m !== lastM) { monthLabels.push({ x: i * DAY_W, label: d.date.toLocaleDateString("en", { month: "short" }) }); lastM = m; } });

  const todayDay = timeline.find(d => d.isToday);
  const todayPh = PHASES[todayDay?.phase || "unknown"] || PHASES.unknown;

  return (
    <div className="j-canvas" onClick={onDismiss}>
      <div ref={scrollRef} className="j-scroll" onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}>
        <div className="j-inner" style={{ width: canvasW }}>

          {/* Month row */}
          <div className="month-row" style={{ width: canvasW }}>
            {monthLabels.map((ml, i) => <div key={i} className="month-lbl" style={{ left: ml.x + 5 }}>{ml.label}</div>)}
          </div>

          {/* Terrain */}
          <div className="terrain" style={{ width: canvasW }}>

            {/* Phase backgrounds */}
            {phaseTrans.map((pt, i) => {
              const nextX = phaseTrans[i + 1]?.x ?? canvasW;
              const ph = PHASES[pt.phase] || PHASES.unknown;
              return (
                <div key={i} className="phase-bg"
                  style={{ left: pt.x, width: nextX - pt.x, background: ph.bg }}
                  onMouseEnter={e => { if (!dragging.current) { const r = scrollRef.current.getBoundingClientRect(); setHoveredPhase(pt.phase); setPhaseCardX(e.clientX - r.left + scrollRef.current.scrollLeft); } }}
                  onMouseLeave={() => setHoveredPhase(null)}
                />
              );
            })}

            {/* Predicted stripes */}
            {predZones.map((z, i) => <div key={i} className="pred-stripe" style={{ left: z.x, width: z.w }} />)}

            {/* Phase separators + labels */}
            {phaseTrans.map((pt, i) => {
              if (i === 0) return null;
              const ph = PHASES[pt.phase] || PHASES.unknown;
              return (
                <div key={i}>
                  <div className="phase-sep" style={{ left: pt.x }} />
                  <div className="phase-sep-lbl" style={{ left: pt.x + 5, color: ph.color, background: ph.muted, borderLeft: `2px solid ${ph.color}` }}>
                    {ph.icon} {ph.name}
                  </div>
                </div>
              );
            })}

            {/* Week separators */}
            {timeline.map((d, i) => i % 7 === 0 && i > 0 ? <div key={i} className="week-sep" style={{ left: i * DAY_W }} /> : null)}

            {/* Road */}
            <div className="road" />

            {/* Period markers */}
            {timeline.map((d, i) => {
              if (!d.isPeriodStart && !d.isPredictedPeriodStart) return null;
              const ph = PHASES[d.phase] || PHASES.unknown;
              const isPred = d.isFuture;
              const sz = isPred ? 9 : 13;
              return (
                <div key={i} className="p-dot"
                  style={{ left: i * DAY_W + DAY_W / 2, width: sz, height: sz, background: isPred ? "transparent" : ph.color, border: `2px solid ${ph.color}`, boxShadow: isPred ? "none" : `0 0 0 4px ${ph.muted},0 0 12px ${ph.glow}`, opacity: isPred ? .5 : 1 }}
                  onClick={e => { e.stopPropagation(); onSelectMarker(d, i * DAY_W); }}
                  title={isPred ? "Predicted period" : `Period: ${d.date.toLocaleDateString()}`}
                />
              );
            })}

            {/* Today beacon */}
            <div className="beacon" style={{ left: todayX }}>
              <div className="beacon-line" style={{ background: todayPh.color }} />
              <div className="beacon-dot" style={{ background: todayPh.color }}>
                <div style={{ position: "absolute", inset: "-7px", borderRadius: "50%", animation: "ring 2.5s ease-in-out infinite", border: `1.5px solid ${todayPh.color}`, opacity: 0 }} />
              </div>
              <div className="beacon-lbl" style={{ background: todayPh.muted, color: todayPh.color, border: `1px solid ${todayPh.border}` }}>NOW</div>
            </div>

            {/* Phase hover card */}
            {hoveredPhase && (() => {
              const ph = PHASES[hoveredPhase] || PHASES.unknown;
              const scrollLeft = scrollRef.current?.scrollLeft || 0;
              const viewW = scrollRef.current?.clientWidth || 800;
              const cardW = 240;
              const relX = phaseCardX - scrollLeft;
              const clampedLeft = phaseCardX - (relX + cardW > viewW ? cardW + 8 : 0);
              return (
                <div className="ph-card" style={{ left: Math.max(scrollLeft + 8, clampedLeft - 20) }}>
                  <div className="ph-card-title" style={{ color: ph.color }}>{ph.icon} {ph.name} · {ph.territory}</div>
                  <div className="ph-card-sub">{ph.days}</div>
                  <div className="ph-card-tip">{ph.tip}</div>
                </div>
              );
            })()}

            {/* Selected marker card */}
            {selectedInfo && (() => {
              const d = selectedInfo.day;
              const scrollLeft = scrollRef.current?.scrollLeft || 0;
              const cardLeft = Math.max(scrollLeft + 8, selectedInfo.x - 100);
              return (
                <div className="mk-card" style={{ left: cardLeft, bottom: 14 }} onClick={e => e.stopPropagation()}>
                  <button className="mk-card-close" onClick={onDismiss}>×</button>
                  {d.loggedPeriod ? (
                    <>
                      <div style={{ fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase", color: PHASES.menstrual.color, marginBottom: ".45rem", fontWeight: 500 }}>🩸 Logged Period</div>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.05rem", marginBottom: ".35rem" }}>{new Date(d.loggedPeriod.start_date).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" })}</div>
                      {d.loggedPeriod.end_date && <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>Ended: {new Date(d.loggedPeriod.end_date).toLocaleDateString()}</div>}
                      {d.loggedPeriod.flow_intensity && <div style={{ marginTop: ".45rem" }}><span className="badge b-r">{d.loggedPeriod.flow_intensity} flow</span></div>}
                      {d.loggedPeriod.pain_level != null && <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".35rem", fontFamily: "'Fira Code',monospace" }}>Pain: {d.loggedPeriod.pain_level}/10</div>}
                      {(d.loggedPeriod.symptoms || []).length > 0 && <div style={{ marginTop: ".5rem", display: "flex", flexWrap: "wrap", gap: ".22rem" }}>{d.loggedPeriod.symptoms.slice(0, 4).map(s => <span key={s} className="badge b-m">{s}</span>)}</div>}
                      <PeriodDelete period={d.loggedPeriod} token={token} onDeleted={onPeriodDeleted} />
                    </>
                  ) : <div style={{ fontSize: ".77rem", color: "var(--muted)" }}>Predicted period start</div>}
                </div>
              );
            })()}

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LOG PERIOD MODAL ─────────────────────────────────────────────────────────
function LogModal({ token, onClose, onSave }) {
  const today = localDateString();
  const [startDate, setStartDate] = useState(today); const [endDate, setEndDate] = useState("");
  const [flow, setFlow] = useState("medium"); const [pain, setPain] = useState(3);
  const [symptoms, setSymptoms] = useState([]); const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [stats, setStats] = useState(null); const [statsLoading, setStatsLoading] = useState(true); const [statsErr, setStatsErr] = useState("");
  const toggle = s => setSymptoms(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      setStatsErr("");
      try {
        const data = await API.periods.list(token);
        if (!cancelled) {
          const st = computePeriodStats(Array.isArray(data) ? data : []);
          setStats(st);
        }
      } catch (e) {
        if (!cancelled) setStatsErr(e.message || "Unable to load recent pattern");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);
  async function save() {
    if (!startDate) { setErr("Start date required"); return; }
    setSaving(true); setErr("");
    try { await API.periods.create({ start_date: startDate, end_date: endDate || null, flow_intensity: flow, pain_level: pain, symptoms, notes }, token); onSave(); }
    catch (e) { setErr(e.message); } finally { setSaving(false); }
  }
  return (
    <Modal title="Log New Period" onClose={onClose}
      footer={<><button className="btn btn-g" onClick={onClose}>Cancel</button><button className="btn btn-p" onClick={save} disabled={saving}>{saving ? <><Spinner /> Saving…</> : "Save to Journey"}</button></>}>
      <div className="f-row">
        <div className="f"><label>Start Date *</label><input type="date" value={startDate} max={today} onChange={e => { const v = e.target.value; setStartDate(v); if (endDate && v > endDate) setEndDate(""); }} /></div>
        <div className="f"><label>End Date</label><input type="date" value={endDate} min={startDate} max={today} onChange={e => setEndDate(e.target.value)} /></div>
      </div>
      <div className="f"><label>Flow Intensity</label><select value={flow} onChange={e => setFlow(e.target.value)}><option value="light">Light</option><option value="medium">Medium</option><option value="heavy">Heavy</option></select></div>
      <div className="f">
        <label>Pain Level — <span style={{ color: "#C4544A", fontFamily: "'Fira Code',monospace" }}>{pain}/10</span></label>
        <input type="range" min="0" max="10" value={pain} onChange={e => setPain(Number(e.target.value))} style={{ accentColor: "#C4544A" }} />
      </div>
      <div className="f"><label>Symptoms</label><div className="chips">{SYMPTOMS_LIST.map(s => <button key={s} type="button" className={`chip ${symptoms.includes(s) ? "on" : ""}`} onClick={() => toggle(s)}>{s}</button>)}</div></div>
      <div className="f"><label>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional observations…" /></div>
      <Err msg={err} />
      <div className="divider" style={{ marginTop: "1.2rem", marginBottom: "1rem" }} />
      <div className="q-sec">
        <div className="q-sec-title">How your cycles usually look</div>
        {statsLoading && <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Reading your recent pattern…</div>}
        {!statsLoading && statsErr && <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>We couldn't load past data ({statsErr}). You can still log this period.</div>}
        {!statsLoading && !statsErr && !stats && (
          <div style={{ fontSize: ".78rem", color: "var(--muted)" }}>
            Once you've logged a few periods, we'll summarise your typical cycle length, bleed days and pain pattern here.
          </div>
        )}
        {!statsLoading && stats && (
          <div style={{ display: "flex", flexDirection: "column", gap: ".65rem", fontSize: ".78rem" }}>
            <div style={{ color: "var(--muted)" }}>
              Based on your last <span style={{ fontFamily: "'Fira Code',monospace" }}>{stats.count}</span> logged periods.
            </div>
            {stats.avgCycle && (
              <div>
                <div className="sbar-lbl">
                  <span>Typical cycle length</span>
                  <span style={{ fontFamily: "'Fira Code',monospace", color: "#E8A09A" }}>{stats.avgCycle} days</span>
                </div>
                <div className="sbar-track">
                  <div className="sbar-fill" style={{ width: `${Math.min((stats.avgCycle / 40) * 100, 100)}%` }} />
                </div>
                {(stats.minCycle && stats.maxCycle && stats.minCycle !== stats.maxCycle) && (
                  <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".2rem" }}>
                    Most cycles fall between {stats.minCycle}–{stats.maxCycle} days.
                  </div>
                )}
              </div>
            )}
            {stats.avgDuration && (
              <div>
                <div className="sbar-lbl">
                  <span>Bleeding days</span>
                  <span style={{ fontFamily: "'Fira Code',monospace", color: "#E8A09A" }}>{stats.avgDuration} days</span>
                </div>
                <div className="sbar-track">
                  <div className="sbar-fill" style={{ width: `${Math.min((stats.avgDuration / 14) * 100, 100)}%`, background: "linear-gradient(90deg,#C4544A,#E8A09A)" }} />
                </div>
                {(stats.minDuration && stats.maxDuration && stats.minDuration !== stats.maxDuration) && (
                  <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".2rem" }}>
                    Usually between {stats.minDuration}–{stats.maxDuration} days of bleeding.
                  </div>
                )}
              </div>
            )}
            {typeof stats.avgPain === "number" && (
              <div>
                <div className="sbar-lbl">
                  <span>Average pain level</span>
                  <span style={{ fontFamily: "'Fira Code',monospace", color: "#E8A09A" }}>{stats.avgPain}/10</span>
                </div>
                <div className="sbar-track">
                  <div className="sbar-fill" style={{ width: `${Math.min((stats.avgPain / 10) * 100, 100)}%`, background: "linear-gradient(90deg,#E07070,#C4544A)" }} />
                </div>
              </div>
            )}
            {stats.commonFlow && (
              <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                <span className="badge b-r" style={{ textTransform: "capitalize" }}>{stats.commonFlow} flow</span>
                <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>This is the most common flow pattern you log.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── CHAT DRAWER ──────────────────────────────────────────────────────────────
function ChatDrawer({ token, onClose }) {
  const defaultMsg = { 
  role: "assistant", 
  content: "Hey there! 👋 I'm Luna. I can help you understand your cycle, your symptoms and how you're feeling.\n\nWhat's on your mind today? 💜",
  quickActions: [
    "What does my health score mean?",
    "How can I track symptoms better?", 
    "When will my next period arrive?",
    "Tips for managing cramps",
    "Is my cycle regular?"
  ]
};
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [input, setInput] = useState(""); const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const bottomRef = useRef(null); const taRef = useRef(null);

  useEffect(() => {
    API.chat.history(token).then(h => {
      if (h?.length > 0) {
        const groups = {};
        h.forEach(m => {
          const sid = m.session_id || 'legacy';
          if (!groups[sid]) groups[sid] = [];
          groups[sid].push(m);
        });
        const sessList = Object.keys(groups).map(k => {
          const msgs = groups[k];
          if (msgs[0]?.role === "user") msgs.unshift(defaultMsg);
          return { id: k, messages: msgs };
        });
        sessList.sort((a, b) => new Date(b.messages[b.messages.length - 1].created_at || 0) - new Date(a.messages[a.messages.length - 1].created_at || 0));
        setSessions(sessList);
        if (sessList.length > 0) setCurrentSessionId(sessList[0].id);
      }
    }).catch(() => { });
  }, [token]);
  
  const currentMessages = currentSessionId ? (sessions.find(s => s.id === currentSessionId)?.messages || [defaultMsg]) : [defaultMsg];
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [currentMessages, sending]);

  async function send() {
    const msg = input.trim(); if (!msg || sending) return;
    setInput(""); setErr("");
    
    let activeSid = currentSessionId;
    const isNew = !activeSid;
    const tempSid = isNew ? 'temp-' + Date.now() : activeSid;
    if (isNew) setCurrentSessionId(tempSid);

    const newUserMsg = { role: "user", content: msg, created_at: new Date().toISOString() };
    
    setSessions(prev => {
      const ex = prev.find(s => s.id === tempSid);
      if (ex) return prev.map(s => s.id === tempSid ? { ...s, messages: [...s.messages, newUserMsg] } : s);
      return [{ id: tempSid, messages: [defaultMsg, newUserMsg] }, ...prev];
    });
    
    setSending(true);
    
    try {
      const payload = { question: msg, include_context: true };
      if (!isNew && activeSid !== 'legacy') payload.session_id = activeSid;
      
      const d = await API.chat.send(payload, token);
      const finalSid = d.session_id || tempSid;
      const newAsstMsg = { role: "assistant", content: d.answer || d.response || d.message || d.content, created_at: new Date().toISOString(), session_id: finalSid };
      
      setSessions(prev => prev.map(s => s.id === tempSid ? { ...s, id: finalSid, messages: [...s.messages, newAsstMsg] } : s));
      if (isNew) setCurrentSessionId(finalSid);
    } catch (e) {
      setErr(e.message);
      setSessions(prev => prev.map(s => s.id === tempSid ? { ...s, messages: [...s.messages, { role: "assistant", content: `⚠ Error: ${e.message}` }] } : s));
    } finally {
      setSending(false);
    }
  }

  const isTalking = sending;

  return (
    <>
      <div className="o-backdrop" onClick={onClose} />
      <div className="drawer" style={{ height: "82vh" }}>
        <div className="drawer-handle" onClick={onClose} />
        <div className="drawer-head">
          <div className="chat-head-left">
            <div className={`ca-orbit ${isTalking ? "on" : ""}`}>
              <div className="ca-bubble">
                <div className="ca-face">
                  <div className="ca-hair" />
                  <div className="ca-eye left" />
                  <div className="ca-eye right" />
                  <div className="ca-mouth" />
                  <div className="ca-shoulders" />
                </div>
              </div>
            </div>
            <div className="drawer-title">Luna</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <button type="button" className="chat-hist-toggle" aria-label="Conversation history" aria-expanded={histOpen} onClick={() => setHistOpen(o => !o)}>History</button>
            <div style={{ fontSize: ".65rem", color: "var(--muted)", fontFamily: "'Fira Code',monospace" }}>AI companion</div>
            <button className="drawer-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="chat-layout">
          <div className={`chat-hist-panel${histOpen ? " open" : ""}`}>
            <div className="ch-head">
              <span className="ch-lbl">History</span>
              <button type="button" className="chat-hist-back" onClick={() => setHistOpen(false)}>Back to chat</button>
              <button aria-label="New chat" onClick={() => { setCurrentSessionId(null); setHistOpen(false); setInput(""); taRef.current?.focus(); }} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer", padding: ".2rem .45rem", borderRadius: "4px", fontSize: ".72rem", transition: "all .2s" }}>+</button>
            </div>
            <div className="ch-list">
              {sessions.length === 0 ? <div className="ch-empty">No messages yet.<br />Start a conversation.</div> :
                sessions.map((s) => {
                  const firstUserMsg = s.messages.find(m => m.role === "user");
                  const title = firstUserMsg ? firstUserMsg.content : "New Chat";
                  return <div key={s.id} onClick={() => { setCurrentSessionId(s.id); setHistOpen(false); }} className={`ch-item ${s.id === currentSessionId ? "on" : ""}`}>{title?.slice(0, 44)}{title?.length > 44 ? "…" : ""}</div>
                })}
            </div>
          </div>
          <div className="chat-main">
            <div className="chat-msgs">
              {currentMessages.map((m, i) => (
                <div key={i} className={`bubble ${m.role === "user" ? "user" : "asst"}`} style={{ animationDelay: `${Math.min(i * .03, .15)}s` }}>
                  <div className="bname">{m.role === "user" ? "You" : "◐ Luna"}</div>
                  {m.role === "assistant" ? <ThinkMsg content={m.content} /> : <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>}
                  {/* Show quick actions for the default welcome message */}
                  {m.role === "assistant" && i === 0 && m.quickActions && (
                    <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {m.quickActions.map((action, idx) => (
                        <button
                          key={idx}
                          onClick={() => setInput(action)}
                          className="btn btn-sm"
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.4rem 0.8rem",
                            background: "rgba(126, 206, 206, 0.15)",
                            border: "1px solid rgba(126, 206, 206, 0.3)",
                            color: "#7ECECE",
                            borderRadius: "1rem",
                            cursor: "pointer",
                            transition: "all 0.2s ease"
                          }}
                          onMouseOver={(e) => {
                            e.target.style.background = "rgba(126, 206, 206, 0.25)";
                            e.target.style.borderColor = "rgba(126, 206, 206, 0.5)";
                          }}
                          onMouseOut={(e) => {
                            e.target.style.background = "rgba(126, 206, 206, 0.15)";
                            e.target.style.borderColor = "rgba(126, 206, 206, 0.3)";
                          }}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sending && <div className="bubble asst"><div className="bname">◐ Luna</div><div className="tdots"><span /><span /><span /></div></div>}
              <div ref={bottomRef} />
            </div>
            {err && <div style={{ padding: "0 1.2rem .5rem" }}><Err msg={err} /></div>}
            <div className="chat-in">
              <textarea ref={taRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask Luna about your cycle…"
                rows={1} style={{ height: "44px" }}
                onInput={e => { e.target.style.height = "44px"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; }}
              />
              <button className="btn btn-p btn-sm" onClick={send} disabled={sending || !input.trim()} style={{ height: "44px", padding: "0 1rem", flexShrink: 0 }}>
                {sending ? <Spinner /> : "Send"}
              </button>
            </div>
            <div className="chat-disclaimer">Luna is an AI companion, not a doctor. For medical concerns, please see a clinician.</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── INSIGHTS COMPONENT ──────────────────────────────────────────────────────────
const Insights = ({ raw, medicalAnalysis, userReport }) => { 
  let p = null; 
  try { 
    p = typeof raw === "string" ? JSON.parse(raw) : raw; 
  } catch (e) { } 
  
  // Use structured data if available, fallback to parsed raw data
  const medicalData = medicalAnalysis || p?.medical_analysis || {};
  const userData = userReport || p?.user_report || p;
  
  return (
    <div>
      {/* User-friendly report */}
      {userData.simple_summary && <div className="ins-quote">{userData.simple_summary}</div>}
      
      {userData.key_insights?.length > 0 && (
        <>
          <div className="ins-lbl">Key Insights</div>
          {userData.key_insights.map((it, i) => (
            <div key={i} className="ins-row">
              <span style={{ color: "#7ECECE", flexShrink: 0 }}>◆</span>
              <span>{it}</span>
            </div>
          ))}
          <div className="divider" />
        </>
      )}
      
      {userData.why_this_result?.length > 0 && (
        <>
          <div className="ins-lbl">Why This Result</div>
          {userData.why_this_result.map((it, i) => (
            <div key={i} className="ins-row">
              <span style={{ color: "#D4A040", flexShrink: 0 }}>•</span>
              <span>{it}</span>
            </div>
          ))}
          <div className="divider" />
        </>
      )}
      
      {userData.recommendations?.length > 0 && (
        <>
          <div className="ins-lbl">Recommendations</div>
          {userData.recommendations.map((it, i) => (
            <div key={i} className="ins-row">
              <span style={{ color: "#5FA87A", flexShrink: 0 }}>✓</span>
              <span>{it}</span>
            </div>
          ))}
          <div className="divider" />
        </>
      )}
      
      {/* Probabilistic Disclaimer */}
      {userData.prediction_disclaimer && (
        <>
          <div className="ins-lbl">Prediction Notice</div>
          <div className="ins-row" style={{ fontSize: ".8rem", fontStyle: "italic", color: "var(--muted)" }}>
            <span style={{ color: "#FFB84D", flexShrink: 0 }}>ℹ️</span>
            <span>{userData.prediction_disclaimer}</span>
          </div>
          <div className="divider" />
        </>
      )}
      
      {/* Medical Analysis Section */}
      {(medicalData.clinical_findings?.length > 0 || medicalData.risk_factors?.length > 0 || medicalData.medical_recommendations?.length > 0) && (
        <>
          <div className="ins-lbl" style={{ color: "#E07070" }}>Medical Analysis (MedGemma)</div>
          
          {medicalData.clinical_findings?.length > 0 && (
            <>
              <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: ".4rem" }}>Clinical Findings:</div>
              {medicalData.clinical_findings.map((it, i) => (
                <div key={i} className="ins-row" style={{ fontSize: ".8rem" }}>
                  <span style={{ color: "#E07070", flexShrink: 0 }}>▸</span>
                  <span>{it}</span>
                </div>
              ))}
            </>
          )}
          
          {medicalData.risk_factors?.length > 0 && (
            <>
              <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: ".4rem", marginTop: ".6rem" }}>Risk Factors:</div>
              {medicalData.risk_factors.map((it, i) => (
                <div key={i} className="ins-row" style={{ fontSize: ".8rem" }}>
                  <span style={{ color: "#D4A040", flexShrink: 0 }}>⚠</span>
                  <span>{it}</span>
                </div>
              ))}
            </>
          )}
          
          {medicalData.medical_recommendations?.length > 0 && (
            <>
              <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: ".4rem", marginTop: ".6rem" }}>Medical Recommendations:</div>
              {medicalData.medical_recommendations.map((it, i) => (
                <div key={i} className="ins-row" style={{ fontSize: ".8rem" }}>
                  <span style={{ color: "#4A9E6E", flexShrink: 0 }}>‣</span>
                  <span>{it}</span>
                </div>
              ))}
            </>
          )}
          
          {medicalData.urgency && medicalData.urgency !== "none" && (
            <div style={{ 
              padding: ".6rem .8rem", 
              background: medicalData.urgency === "high" ? "rgba(224,112,112,.1)" : "rgba(212,160,64,.1)", 
              borderLeft: `2px solid ${medicalData.urgency === "high" ? "#E07070" : "#D4A040"}`, 
              borderRadius: "0 6px 6px 0", 
              fontSize: ".75rem", 
              lineHeight: 1.6,
              marginTop: ".6rem"
            }}>
              <span style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".1em", color: medicalData.urgency === "high" ? "#E07070" : "#D4A040", display: "block", marginBottom: ".2rem", fontWeight: 500 }}>
                Urgency Level: {medicalData.urgency}
              </span>
              {medicalData.urgency === "high" ? "Consider consulting with a healthcare provider soon." : "Monitor symptoms and consult if they worsen."}
            </div>
          )}
          
          <div className="divider" />
        </>
      )}
      
      {userData.what_to_expect && (
        <>
          <div className="ins-lbl">What to Expect</div>
          <div style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--cream)", padding: ".4rem 0" }}>
            {userData.what_to_expect}
          </div>
          <div className="divider" />
        </>
      )}
      
      {userData.next_steps?.length > 0 && (
        <>
          <div className="ins-lbl">Next Steps</div>
          {userData.next_steps.map((it, i) => (
            <div key={i} className="ins-row">
              <span style={{ color: "#7C66C0", flexShrink: 0 }}>→</span>
              <span>{it}</span>
            </div>
          ))}
        </>
      )}
      
      {userData.when_to_see_doctor && (
        <div style={{ 
          padding: ".8rem 1rem", 
          background: "rgba(224,112,112,.07)", 
          borderLeft: "2px solid #E07070", 
          borderRadius: "0 6px 6px 0", 
          fontSize: ".8rem", 
          lineHeight: 1.65 
        }}>
          <span style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".1em", color: "#E07070", display: "block", marginBottom: ".3rem", fontWeight: 500 }}>
            When to See a Doctor
          </span>
          {userData.when_to_see_doctor}
        </div>
      )}
    </div>
  );
};

// ─── ANALYSIS DRAWER ──────────────────────────────────────────────────────────
function AnalysisDrawer({ token, onClose }) {
  const [latest, setLatest] = useState(null); const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("overview");
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false); const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, latestRes] = await Promise.allSettled([
        API.analysis.list(token),
        API.analysis.latest("cycle_health", token)
      ]);
      if (listRes.status === "fulfilled") setHistory(Array.isArray(listRes.value) ? listRes.value : []);
      if (latestRes.status === "fulfilled") setLatest(latestRes.value);
    }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true); setErr("");
    try {
      const r = await API.analysis.generate({ analysis_type: "cycle_health" }, token);
      setLatest(r);
      setHistory(prev => [r, ...prev]);
      setSelected(r);
      setTab("overview");
    }
    catch (e) { setErr(e.message); } finally { setGenerating(false); }
  }

  const active = selected || latest;
  const score = active?.cycle_health_score ?? null;
  const ScoreRing = ({ score = 0 }) => { const r = 44, c = 2 * Math.PI * r, off = c - (score / 100) * c; return (<div className="score-ring"><svg width="108" height="108" viewBox="0 0 108 108"><circle cx="54" cy="54" r={r} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="7" /><circle cx="54" cy="54" r={r} fill="none" stroke="url(#rg2)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)" }} /><defs><linearGradient id="rg2" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#C4544A" /><stop offset="100%" stopColor="#7ECECE" /></linearGradient></defs></svg><div className="score-num"><span className="n">{score}</span><span className="s">/ 100</span></div></div>); };

  const fmt = d => { try { return new Date(d + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" }); } catch { return d; } };
  const fmtDT = d => { try { return new Date(d).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };

  return (
    <>
      <div className="o-backdrop" onClick={onClose} />
      <div className="drawer" style={{ height: "84vh" }}>
        <div className="drawer-handle" onClick={onClose} />
        <div className="drawer-head">
          <div className="drawer-title">AI Analysis</div>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <button className="btn btn-p btn-sm" onClick={generate} disabled={generating}>{generating ? <><Spinner />Analysing…</> : "✦ Run Analysis"}</button>
            <button className="drawer-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="drawer-body">
          {loading ? <LoadingC text="Loading analyses…" /> : <>
            <Err msg={err} />
            {generating && <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: ".9rem 1.1rem", background: "rgba(126,206,206,.05)", border: "1px solid rgba(126,206,206,.15)", borderRadius: "var(--r)", marginBottom: "1rem" }}><Spinner /><div><div style={{ fontSize: ".82rem", color: "#7ECECE" }}>Running MedGemma…</div><div style={{ fontSize: ".7rem", color: "var(--muted)" }}>5–15 seconds</div></div></div>}
            <div style={{ display: "flex", gap: ".4rem", marginBottom: "1rem", borderBottom: "1px solid var(--border)" }}>
              <button
                className="btn btn-g btn-sm"
                onClick={() => setTab("overview")}
                style={{
                  borderColor: tab === "overview" ? "rgba(196,84,74,.4)" : "var(--border)",
                  color: tab === "overview" ? "#C4544A" : "var(--muted)",
                  background: tab === "overview" ? "rgba(196,84,74,.08)" : "transparent",
                  marginBottom: "-1px"
                }}
              >
                Overview
              </button>
              <button
                className="btn btn-g btn-sm"
                onClick={() => setTab("history")}
                style={{
                  borderColor: tab === "history" ? "rgba(196,84,74,.4)" : "var(--border)",
                  color: tab === "history" ? "#C4544A" : "var(--muted)",
                  background: tab === "history" ? "rgba(196,84,74,.08)" : "transparent",
                  marginBottom: "-1px"
                }}
              >
                History
              </button>
            </div>
            {tab === "overview" && (
              active ? (
                <>
                  <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "1.2rem" }}>
                    {score != null && <ScoreRing score={score} />}
                    <div style={{ flex: 1, minWidth: 180 }}>
                      {active.avg_cycle_length && <div className="sbar"><div className="sbar-lbl"><span>Avg Cycle</span><span style={{ fontFamily: "'Fira Code',monospace", color: "#E8A09A" }}>{active.avg_cycle_length}d</span></div><div className="sbar-track"><div className="sbar-fill" style={{ width: `${Math.min((active.avg_cycle_length / 35) * 100, 100)}%` }} /></div></div>}
                      {active.cycle_std_deviation != null && <div className="sbar"><div className="sbar-lbl"><span>Regularity</span><span style={{ fontFamily: "'Fira Code',monospace", color: "#E8A09A" }}>σ={active.cycle_std_deviation}</span></div><div className="sbar-track"><div className="sbar-fill" style={{ width: `${Math.max(0, 100 - active.cycle_std_deviation * 10)}%`, background: "linear-gradient(90deg,#4A9E6E,#7ECECE)" }} /></div></div>}
                    </div>
                  </div>
                  {active.predictions && <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", marginBottom: "1.1rem" }}>
                    {active.predictions.predicted_next_period && <div className="pred-tile"><div className="pred-lbl">📅 Next Period</div><div className="pred-val">{fmt(active.predictions.predicted_next_period)}</div></div>}
                    {active.predictions.prediction_range && (
                      <div className="pred-tile">
                        <div className="pred-lbl">📅 Range</div>
                        <div className="pred-val">{fmt(active.predictions.prediction_range.earliest)} - {fmt(active.predictions.prediction_range.latest)}</div>
                      </div>
                    )}
                    {active.predictions.ovulation_date && <div className="pred-tile"><div className="pred-lbl">✦ Ovulation</div><div className="pred-val">{fmt(active.predictions.ovulation_date)}</div></div>}
                    {active.predictions.confidence && (
                      <div className="pred-tile">
                        <div className="pred-lbl">Confidence</div>
                        <div className="pred-val" style={{ textTransform: "capitalize" }}>
                          {active.predictions.confidence.level} ({active.predictions.confidence.percentage}%)
                        </div>
                      </div>
                    )}
                    {active.predictions.statistics?.data_quality && (
                      <div className="pred-tile">
                        <div className="pred-lbl">Data Quality</div>
                        <div className="pred-val" style={{ textTransform: "capitalize" }}>
                          {active.predictions.statistics.data_quality}
                        </div>
                      </div>
                    )}
                  </div>}
                  <div className="divider" />
                  {active.llm_response && <Insights raw={active.llm_response} medicalAnalysis={active.medical_analysis} userReport={active.user_report} />}
                </>
              ) : (
                <div className="empty"><div className="ei">🔮</div><p>No insights yet.<br />Log at least two periods (about a month apart), then tap <strong style={{ color: "#7ECECE" }}>Run Analysis</strong>.</p></div>
              )
            )}
            {tab === "history" && (
              history && history.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: ".7rem" }}>
                  {history.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      className="q-sec"
                      style={{
                        marginBottom: 0,
                        textAlign: "left",
                        width: "100%",
                        background: selected && selected.id === a.id ? "rgba(196,84,74,.06)" : "rgba(255,255,255,.02)",
                        borderColor: selected && selected.id === a.id ? "rgba(196,84,74,.4)" : "var(--border)",
                        cursor: "pointer"
                      }}
                      onClick={() => { setSelected(a); setTab("overview"); }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".4rem" }}>
                        <div style={{ fontSize: ".8rem", color: "var(--cream)" }}>
                          {a.analysis_type === "cycle_health" ? "Cycle health analysis" : (a.analysis_type || "Analysis")}
                        </div>
                        <div style={{ fontSize: ".7rem", color: "var(--muted)", fontFamily: "'Fira Code',monospace" }}>{fmtDT(a.created_at)}</div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center" }}>
                        {typeof a.cycle_health_score === "number" && (
                          <span className="badge b-g">Score {a.cycle_health_score}/100</span>
                        )}
                        {a.predictions?.predicted_next_period && (
                          <span className="badge b-m">Next period: {fmt(a.predictions.predicted_next_period)}</span>
                        )}
                        {Array.isArray(a.risk_flags) && a.risk_flags.length > 0 && (
                          <span className="badge b-r">Risk flags: {a.risk_flags.slice(0, 2).join(", ")}{a.risk_flags.length > 2 ? " +" : ""}</span>
                        )}
                      </div>
                      {a.llm_response && (
                        <div style={{ marginTop: ".5rem", fontSize: ".75rem", color: "var(--muted)", maxHeight: 88, overflow: "hidden", maskImage: "linear-gradient(to bottom, black 70%, transparent)" }}>
                          {(() => {
                            try {
                              const parsed = JSON.parse(a.llm_response);
                              const rep = parsed.user_report || parsed;
                              return rep.simple_summary || rep.summary || a.llm_response.slice(0, 240);
                            } catch {
                              return a.llm_response.slice(0, 240);
                            }
                          })()}
                          {a.llm_response.length > 240 ? "…" : ""}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="ei">📚</div>
                  <p>No past analyses yet.<br />As you run analyses, they’ll appear here with scores and key dates.</p>
                </div>
              )
            )}
          </>}
        </div>
      </div>
    </>
  );
}

// ─── PROFILE DRAWER ───────────────────────────────────────────────────────────
function ProfileDrawer({ token, onClose, email, onLogout, consents, onSetConsent, initialView = "main" }) {
  const [view, setView] = useState(initialView);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(""); const [done, setDone] = useState(false);
  const [age, setAge] = useState(25); const [sex, setSex] = useState("female"); const [wt, setWt] = useState(60); const [ht, setHt] = useState(165);
  const [lmp, setLmp] = useState(""); const [cl, setCl] = useState(28); const [cv, setCv] = useState(2);
  const [bd, setBd] = useState(5); const [bv, setBv] = useState("moderate"); const [prod, setProd] = useState(4);
  const [clots, setClots] = useState(false); const [ib, setIb] = useState(false);
  const [cramp, setCramp] = useState(true); const [psev, setPsev] = useState(3); const [pt, setPt] = useState("during_menses"); const [pe, setPe] = useState("partial");
  const [nausea, setNausea] = useState(false); const [vomit, setVomit] = useState(false); const [faint, setFaint] = useState(false); const [diarr, setDiarr] = useState(false);
  const [ms, setMs] = useState(1); const [sad, setSad] = useState(0); const [ang, setAng] = useState(0); const [anx, setAnx] = useState(1);
  const [conc, setConc] = useState(0); const [bt, setBt] = useState(1); const [bloat, setBloat] = useState(2); const [head, setHead] = useState(1);
  const [interf, setInterf] = useState(false); const [intSev, setIntSev] = useState(3);
  const [notes, setNotes] = useState(""); const [consent, setConsent] = useState(false);
  const [questionnaireAnalysis, setQuestionnaireAnalysis] = useState(null);

  async function submitQ(e) {
    e.preventDefault(); if (!lmp) { setErr("Last period date required"); return; }
    if (!consent) { setErr("Please tick the consent box to save your health profile."); return; }
    setSaving(true); setErr("");
    const payload = { basic_demographic: { age, biological_sex: sex, weight_kg: wt, height_cm: ht }, cycle_pattern: { last_menstrual_period: lmp, typical_cycle_length: cl, cycle_variability_days: cv, typical_bleeding_duration: bd, bleeding_volume: bv, sanitary_products_per_day: prod, passes_large_clots: clots, intermenstrual_bleeding: ib }, pain_symptoms: { has_cramping: cramp, pain_severity: psev, pain_timing: pt, painkiller_effectiveness: pe, has_nausea: nausea, has_vomiting: vomit, has_fainting: faint, has_diarrhea: diarr }, pms_symptoms: { mood_swings: ms, severe_sadness: sad, anger: ang, anxiety: anx, poor_concentration: conc, breast_tenderness: bt, bloating: bloat, headaches: head, interferes_with_daily_activities: interf, interference_severity: interf ? intSev : null }, optional_data: { additional_notes: notes || null, data_consent_given: consent } };
    try {
      const response = await API.questionnaires.submit(payload, token);
      setQuestionnaireAnalysis(response.analysis);
      setDone(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const R = (label, val, set, min, max) => (<div className="f"><label>{label}: <span style={{ color: "#C4544A", fontFamily: "'Fira Code',monospace" }}>{val}/{max}</span></label><input type="range" min={min} max={max} value={val} onChange={e => set(Number(e.target.value))} style={{ accentColor: "#C4544A" }} /></div>);
  const CB = (label, val, set) => (<div className="f"><label style={{ display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer", textTransform: "none", letterSpacing: 0 }}><input type="checkbox" checked={val} onChange={e => set(e.target.checked)} style={{ width: "auto", accentColor: "#C4544A" }} /><span style={{ fontSize: ".82rem", color: "var(--cream)" }}>{label}</span></label></div>);

  return (
    <>
      <div className="o-backdrop" onClick={onClose} />
      <div className="drawer" style={{ height: "88vh" }}>
        <div className="drawer-handle" onClick={onClose} />
        <div className="drawer-head">
          <div className="drawer-title">{view === "questionnaire" ? "Health Profile" : "Profile"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            {view === "main" && <button className="btn btn-g btn-sm" onClick={() => setView("questionnaire")}>Health Profile →</button>}
            {view === "questionnaire" && <button className="btn btn-g btn-sm" onClick={() => setView("main")}>← Back</button>}
            <button className="drawer-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="drawer-body">
          {view === "main" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ width: 50, height: 50, borderRadius: "50%", background: "linear-gradient(135deg,#C4544A,#7C66C0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.15rem", fontWeight: 600, color: "#fff", flexShrink: 0 }}>{email[0]?.toUpperCase()}</div>
                <div><div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.1rem" }}>{email}</div><div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".1rem" }}>Luna Health member</div></div>
              </div>
              <div className="divider" />
              <div style={{ display: "flex", flexDirection: "column", gap: ".45rem" }}>
                <button className="btn btn-g" style={{ justifyContent: "flex-start", gap: ".6rem" }} onClick={() => setView("questionnaire")}>📋 Update Health Profile</button>
                <button className="btn btn-g" style={{ justifyContent: "flex-start", gap: ".6rem", color: "#E07070", borderColor: "rgba(224,112,112,.2)" }} onClick={onLogout}>⏻ Sign Out</button>
              </div>
              <div className="divider" />
              <PrivacyPanel token={token} consents={consents} onSetConsent={onSetConsent} onAccountDeleted={onLogout} />
            </div>
          )}
          {view === "questionnaire" && (done ? (
            <div style={{ paddingTop: "2rem" }}>
              <div className="ei">🌸</div>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.25rem", color: "#E8A09A", marginBottom: ".6rem", fontWeight: 400 }}>Profile Saved</h3>
              <p>Your health profile has been updated.</p>
              
              {questionnaireAnalysis && (
                <div style={{ marginTop: "1.5rem" }}>
                  <div className="ins-lbl">Initial Analysis</div>
                  <Insights 
                    raw={JSON.stringify(questionnaireAnalysis)} 
                    medicalAnalysis={questionnaireAnalysis.medical_analysis} 
                    userReport={questionnaireAnalysis} 
                  />
                </div>
              )}
              
              <button className="btn btn-p" style={{ marginTop: "1.2rem" }} onClick={() => setDone(false)}>Update Again</button>
            </div>
          ) : (
            <form onSubmit={submitQ}>
              <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: ".8rem", padding: ".6rem .75rem", borderRadius: "8px", background: "rgba(255,255,255,.02)", border: "1px dashed var(--border)" }}>
                This is your health questionnaire. It helps Luna understand your body and symptoms. You can always edit these answers later under <strong>Profile → Health Profile</strong>.
              </div>
              <div className="q-sec"><div className="q-sec-title">Basic Info</div>
                <div className="f-row"><div className="f"><label>Age</label><input type="number" value={age} onChange={e => setAge(Number(e.target.value))} min="18" max="100" required /></div><div className="f"><label>Biological Sex</label><select value={sex} onChange={e => setSex(e.target.value)}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div></div>
                <div className="f-row"><div className="f"><label>Weight (kg)</label><input type="number" value={wt} onChange={e => setWt(Number(e.target.value))} min="30" max="200" /></div><div className="f"><label>Height (cm)</label><input type="number" value={ht} onChange={e => setHt(Number(e.target.value))} min="100" max="250" /></div></div>
              </div>
              <div className="q-sec"><div className="q-sec-title">Cycle Pattern</div>
                <div className="f"><label>Last Menstrual Period *</label><input type="date" value={lmp} onChange={e => setLmp(e.target.value)} required /></div>
                <div className="f-row"><div className="f"><label>Cycle Length (days)</label><input type="number" value={cl} onChange={e => setCl(Number(e.target.value))} min="10" max="120" /></div><div className="f"><label>Variability (days)</label><input type="number" value={cv} onChange={e => setCv(Number(e.target.value))} min="0" max="30" /></div></div>
                <div className="f-row"><div className="f"><label>Bleed Duration</label><input type="number" value={bd} onChange={e => setBd(Number(e.target.value))} min="1" max="15" /></div><div className="f"><label>Bleed Volume</label><select value={bv} onChange={e => setBv(e.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></div></div>
                {CB("Passes large clots", clots, setClots)}{CB("Intermenstrual bleeding", ib, setIb)}
              </div>
              <div className="q-sec"><div className="q-sec-title">Pain & Symptoms</div>
                {CB("Has cramping", cramp, setCramp)}{R("Pain Severity", psev, setPsev, 0, 10)}
                <div className="f"><label>Pain Timing</label><select value={pt} onChange={e => setPt(e.target.value)}><option value="before_menses">Before</option><option value="during_menses">During</option><option value="after_menses">After</option></select></div>
                <div className="f"><label>Painkiller Effectiveness</label><select value={pe} onChange={e => setPe(e.target.value)}><option value="none">None</option><option value="partial">Partial</option><option value="complete">Complete</option></select></div>
                <div className="f-row">{CB("Nausea", nausea, setNausea)}{CB("Vomiting", vomit, setVomit)}</div>
              </div>
              <div className="q-sec"><div className="q-sec-title">PMS Symptoms (0–3)</div>
                {R("Mood Swings", ms, setMs, 0, 3)}{R("Anxiety", anx, setAnx, 0, 3)}{R("Bloating", bloat, setBloat, 0, 3)}{R("Headaches", head, setHead, 0, 3)}
                {CB("Interferes with daily life", interf, setInterf)}
                {interf && R("Interference Severity", intSev, setIntSev, 0, 10)}
              </div>
              <div className="q-sec">
                <div className="f"><label>Additional Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any other health information…" /></div>
                {CB("I consent to data analysis", consent, setConsent)}
              </div>
              <Err msg={err} />
              <button className="btn btn-p btn-full" type="submit" disabled={saving} style={{ marginTop: ".5rem" }}>{saving ? <><Spinner />Saving…</> : "Save Health Profile"}</button>
            </form>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── MAIN JOURNEY APP ─────────────────────────────────────────────────────────
function JourneyApp({ token, email, onLogout }) {
  const [periods, setPeriods] = useState([]); const [loading, setLoading] = useState(true);
  const [overlay, setOverlay] = useState(null);
  const [selectedInfo, setSelectedInfo] = useState(null);
  const [showIntro, setShowIntro] = useState(false);
  const [forceQuestionnaire, setForceQuestionnaire] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return window.sessionStorage.getItem("luna_profile_banner_dismissed") === "1"; } catch (e) { return false; }
  });
  const { consents, error: consentError, reload: reloadConsents, setConsent } = useConsents(token);
  const [pendingAi, setPendingAi] = useState(null);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try { const d = await API.periods.list(token); setPeriods(Array.isArray(d) ? d.sort((a, b) => new Date(b.start_date) - new Date(a.start_date)) : []); }
    catch (e) { } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  // The API announces a 403 consent_required (e.g. consent withdrawn elsewhere): refresh our copy and ask again.
  useEffect(() => {
    const onConsentRequired = () => { reloadConsents(); setOverlay("ai-consent"); };
    window.addEventListener("luna:consent-required", onConsentRequired);
    return () => window.removeEventListener("luna:consent-required", onConsentRequired);
  }, [reloadConsents]);

  const refreshProfileStatus = useCallback(async () => {
    if (!token) return;
    try {
      const userStatus = await API.auth.status(token);
      setProfileIncomplete(!userStatus.has_completed_questionnaire);
    } catch (e) { /* keep the current banner state */ }
  }, [token]);

  useEffect(() => {
    const checkUserStatus = async () => {
      try {
        // Check onboarding status (keep localStorage for this since it's one-time)
        const seen = window.localStorage.getItem(email ? `luna_onboarding_done_${email}` : "luna_onboarding_done");
        if (!seen) setShowIntro(true);
        
        // Check questionnaire status via API
        if (token) {
          const userStatus = await API.auth.status(token);
          setProfileIncomplete(!userStatus.has_completed_questionnaire);
        }
      } catch (error) {
        setShowIntro(true);
      }
    };
    
    checkUserStatus();
  }, [token, email]);

  if (consentError) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Err msg={consentError} />
          <button className="btn btn-p btn-full" style={{ marginTop: "1rem" }} onClick={reloadConsents}>Retry</button>
          <button className="btn btn-g btn-full" style={{ marginTop: ".5rem" }} onClick={onLogout}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!consents) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><LoadingC text="Loading your privacy settings…" /></div>;
  }
  if (!consents.terms_privacy || !consents.age_18_plus) {
    return (
      <RequiredConsentScreen
        onSubmit={async () => { await setConsent("age_18_plus", true); await setConsent("terms_privacy", true); }}
        onLogout={onLogout}
      />
    );
  }

  const openAi = target => {
    if (consents.ai_processing) { setOverlay(target); return; }
    setPendingAi(target);
    setOverlay("ai-consent");
  };

  const sorted = [...periods].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  const avgCycle = sorted.length > 1 ? Math.round(sorted.slice(0, -1).reduce((s, p, i) => s + Math.abs((new Date(p.start_date) - new Date(sorted[i + 1].start_date)) / 86400000), 0) / (sorted.length - 1)) : 28;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cycleDay = null, currentPhase = "unknown", daysToNext = null;
  if (sorted[0]) {
    const ref = new Date(sorted[0].start_date); ref.setHours(0, 0, 0, 0);
    const diff = Math.round((today - ref) / 86400000);
    cycleDay = (diff % avgCycle) + 1;
    currentPhase = getPhaseForCycleDay(cycleDay, avgCycle);
    const cycles = Math.ceil(diff / avgCycle);
    const nextDate = new Date(ref); nextDate.setDate(ref.getDate() + cycles * avgCycle);
    daysToNext = Math.round((nextDate - today) / 86400000);
    if (daysToNext < 0) daysToNext = avgCycle + daysToNext;
  }

  const ph = PHASES[currentPhase] || PHASES.unknown;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* TOP BAR */}
      <div className="topbar">
        <div className="tlogo">
          <span className="m">◐</span>Luna
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          {currentPhase !== "unknown" && (
            <div className="phase-pill" style={{ color: ph.color, background: ph.bg, borderColor: ph.border }}>
              {ph.icon} {ph.territory}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".65rem" }}>
          {cycleDay && <div className="cday-badge">Day {cycleDay} · {ph.name}</div>}
          <button className="avatar-btn" onClick={() => setOverlay("profile")} style={{ background: `linear-gradient(135deg,${ph.color},#7C66C0)` }}>{email[0]?.toUpperCase()}</button>
        </div>
      </div>

      {/* JOURNEY MAP */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingC text="Loading your journey…" />
        </div>
      ) : (
        <JourneyMap periods={periods} avgCycle={avgCycle} selectedInfo={selectedInfo}
          onSelectMarker={(day, x) => setSelectedInfo({ day, x })}
          onDismiss={() => setSelectedInfo(null)}
          token={token} onPeriodDeleted={() => { setSelectedInfo(null); loadPeriods(); }}
        />
      )}

      {profileIncomplete && !bannerDismissed && (
        <ProfileBanner
          onStart={() => { setForceQuestionnaire(true); setOverlay("profile"); }}
          onLater={() => { try { window.sessionStorage.setItem("luna_profile_banner_dismissed", "1"); } catch (e) { /* ignore */ } setBannerDismissed(true); }}
        />
      )}

      {/* STATS STRIP */}
      <div className="stats-strip">
        <div className="st-item"><div className="st-val" style={{ color: ph.color, fontFamily: "'Fira Code',monospace", fontSize: "1.2rem" }}>{cycleDay ?? "—"}</div><div className="st-lbl">Cycle Day</div></div>
        <div className="st-item"><div className="st-val">{daysToNext != null ? `${daysToNext}d` : "—"}</div><div className="st-lbl">Next in</div></div>
        <div className="st-item"><div className="st-val">{avgCycle}</div><div className="st-lbl">Avg Cycle</div></div>
        <div className="st-item"><div className="st-val">{periods.length}</div><div className="st-lbl">Logged</div></div>
        <div className="st-item"><div className="st-val" style={{ color: ph.color, fontSize: "1rem", lineHeight: 1.2, fontFamily: "'Outfit',sans-serif" }}>{ph.name}</div><div className="st-lbl">Phase</div></div>
      </div>

      {/* BOTTOM DOCK */}
      <div className="dock">
        <button className="dk on"><span className="di">🗺</span><span className="dl">Journey</span></button>
        <button className="dk" onClick={() => openAi("analysis")}><span className="di">✦</span><span className="dl">Insights</span></button>
        <button className="dock-log" onClick={() => setOverlay("log")} title="Log period">+</button>
        <button className="dk" onClick={() => openAi("chat")}><span className="di">💬</span><span className="dl">Chat</span></button>
        <button className="dk" onClick={() => setOverlay("profile")}><span className="di">👤</span><span className="dl">Profile</span></button>
      </div>

      {/* OVERLAYS */}
      {overlay === "log" && <LogModal token={token} onClose={() => setOverlay(null)} onSave={() => { setOverlay(null); loadPeriods(); }} />}
      {overlay === "chat" && <ChatDrawer token={token} onClose={() => setOverlay(null)} />}
      {overlay === "analysis" && <AnalysisDrawer token={token} onClose={() => setOverlay(null)} />}
      {overlay === "profile" && <ProfileDrawer token={token} email={email} onClose={() => { setOverlay(null); setForceQuestionnaire(false); refreshProfileStatus(); }} onLogout={onLogout} consents={consents} onSetConsent={setConsent} initialView={forceQuestionnaire ? "questionnaire" : "main"} />}
      {overlay === "ai-consent" && (
        <AiConsentModal
          onClose={() => { setOverlay(null); setPendingAi(null); }}
          onGrant={async () => { await setConsent("ai_processing", true); setOverlay(pendingAi); setPendingAi(null); }}
        />
      )}
      {showIntro && <Onboarding email={email} onClose={() => setShowIntro(false)} />}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  injectStyles();
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  // Check for token in localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('access_token');
    const storedEmail = localStorage.getItem('email');
    if (storedToken && storedEmail) {
      setToken(storedToken);
      setEmail(storedEmail);
    }
  }, []);

  // api.js refreshes tokens silently (req() always sends the newest stored token, so React state
  // is deliberately left alone); bounce to login only if the session dies.
  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setEmail("");
      setAuthMode("login");
      setShowAuth(true);
    };
    window.addEventListener("luna:session-expired", onExpired);
    return () => {
      window.removeEventListener("luna:session-expired", onExpired);
    };
  }, []);

  // Check if user is accessing auth routes directly
  useEffect(() => {
    const path = window.location.pathname;
    if (path.includes('/auth') || path.includes('/login') || path.includes('/register')) {
      // Extract mode from URL
      if (path.includes('/register')) {
        setAuthMode('register');
      } else {
        setAuthMode('login');
      }
      setShowAuth(true);
    }
  }, []);

  const handleLogin = (accessToken, refreshToken, userEmail) => {
    setToken(accessToken);
    setEmail(userEmail);
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('email', userEmail);
    setShowAuth(false);
    
    // Redirect to app after successful login
    window.history.pushState({}, '', '/app');
  };

  const handleLogout = () => {
    setToken(null);
    setEmail("");
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('email');
    
    // Redirect to login page after logout
    window.history.pushState({}, '', '/login');
  };

  const handleShowAuth = (mode = "login") => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  if (showAuth) {
    return <AuthScreen onLogin={handleLogin} initialMode={authMode} />;
  }

  if (!token) {
    return <LandingPage onShowAuth={handleShowAuth} />;
  }

  return <JourneyApp token={token} email={email} onLogout={handleLogout} />;
}

export { injectStyles, AuthScreen, JourneyApp, ChatDrawer, LogModal, AnalysisDrawer };
