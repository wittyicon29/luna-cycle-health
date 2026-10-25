import React, { useId } from "react";

// Luna v2. Light comes from the upper left; depth is a darker copy of a shape offset down and right.
const INK = "#2A1D45";
const CREAM = "#F5EEF8";
const MUTED = "#A889C0";
const PINK = "#FF6B8A";
const GOLD = "#FFC84A";
const BLUSH = "#FF8FAB";
const MOODS = ["neutral", "happy", "sleepy", "cozy", "curious"];

const TUFT_MOON = "M38.17 11.02A4.6 4.6 0 1 0 43.12 16.43A3.7 3.7 0 0 1 38.17 11.02Z";
const SPARK_SHAPES = [
  { x: 8, y: 15, d: "M0 -3.1Q0.56 -0.56 3.1 0Q0.56 0.56 0 3.1Q-0.56 0.56 -3.1 0Q-0.56 -0.56 0 -3.1Z", fill: GOLD, delay: "0s" },
  { x: 50.5, y: 13, d: "M0 -2.6Q0.47 -0.47 2.6 0Q0.47 0.47 0 2.6Q-0.47 0.47 -2.6 0Q-0.47 -0.47 0 -2.6Z", fill: GOLD, delay: ".15s" },
  { x: 56.5, y: 27, d: "M0 -1.8Q0.32 -0.32 1.8 0Q0.32 0.32 0 1.8Q-0.32 0.32 -1.8 0Q-0.32 -0.32 0 -1.8Z", fill: CREAM, delay: ".3s" },
];
const STAR_CURIOUS = "M47.5 10.6Q47.93 12.57 49.9 13Q47.93 13.43 47.5 15.4Q47.07 13.43 45.1 13Q47.07 12.57 47.5 10.6Z";

function mix(a, b, t) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = rgb(a);
  const B = rgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

function Ln({ d, w = 1.9 }) {
  return <path d={d} fill="none" stroke={INK} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
}

function Eye({ x, y, rx, ry }) {
  return (
    <>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={INK} />
      <circle cx={x - rx * 0.32} cy={y - ry * 0.4} r={rx * 0.42} fill="#fff" />
      <circle cx={x + rx * 0.4} cy={y + ry * 0.38} r={rx * 0.18} fill="#fff" opacity=".85" />
    </>
  );
}

function Cheeks({ o = 0.55, rx = 2.9 }) {
  return (
    <>
      <ellipse cx="18.6" cy="36" rx={rx} ry="1.8" fill={BLUSH} opacity={o} />
      <ellipse cx="39.4" cy="36" rx={rx} ry="1.8" fill={BLUSH} opacity={o} />
    </>
  );
}

function Face({ mood }) {
  switch (mood) {
    case "happy":
      return (
        <g data-face="happy">
          <Cheeks o={0.75} rx={3.1} />
          <Ln d="M20.4 33 Q23.4 27.6 26.4 33" w={2.2} />
          <Ln d="M31.6 33 Q34.6 27.6 37.6 33" w={2.2} />
          <path d="M26.3 35.4 Q29 35.9 31.7 35.4 Q31.4 40.6 29 40.6 Q26.6 40.6 26.3 35.4Z" fill={INK} />
          <ellipse cx="29" cy="39.1" rx="1.5" ry="1" fill={BLUSH} />
        </g>
      );
    case "sleepy":
      return (
        <g data-face="sleepy">
          <Cheeks o={0.45} />
          <Ln d="M20.6 32.2 Q23.5 34.2 26.4 32.2" />
          <Ln d="M31.6 32.2 Q34.5 34.2 37.4 32.2" />
          <Ln d="M20.9 33 L19.9 33.9 M37.1 33 L38.1 33.9" w={1.1} />
          <ellipse cx="29" cy="38" rx="1.6" ry="2" fill={INK} />
          <ellipse cx="29" cy="38.9" rx="1" ry=".7" fill={BLUSH} />
        </g>
      );
    case "cozy":
      return (
        <g data-face="cozy">
          <Cheeks o={0.8} rx={3.3} />
          <Ln d="M20.6 31 Q23.5 34.4 26.4 31" w={2.1} />
          <Ln d="M31.6 31 Q34.5 34.4 37.4 31" w={2.1} />
          <Ln d="M26.4 36 Q29 38.8 31.6 36" w={1.8} />
        </g>
      );
    case "curious":
      return (
        <g data-face="curious">
          <g transform="rotate(-7 29 32)">
            <Cheeks o={0.5} />
            <Eye x={23.4} y={31.2} rx={3.1} ry={3.7} />
            <Eye x={34.8} y={31.6} rx={2.6} ry={3.1} />
            <Ln d="M31.8 25.6 Q34.6 24 37.6 25.4" w={1.6} />
            <ellipse cx="30" cy="37.4" rx="1.3" ry="1.5" fill={INK} />
          </g>
        </g>
      );
    default:
      return (
        <g data-face="neutral">
          <Cheeks />
          <Eye x={23.5} y={31.2} rx={2.8} ry={3.4} />
          <Eye x={34.5} y={31.2} rx={2.8} ry={3.4} />
          <Ln d="M26.6 36.2 Q29 38.4 31.4 36.2" w={1.8} />
        </g>
      );
  }
}

// Happy right after a log, then sleepy at night, then cozy while bleeding.
export function companionMood({ phase, hour, justLogged } = {}) {
  if (justLogged) return "happy";
  if (hour >= 22 || hour < 5) return "sleepy";
  if (phase === "menstrual") return "cozy";
  return "neutral";
}

export default function Companion({
  mood = "neutral",
  size = 64,
  animate = false,
  sparkles = false,
  accent = "#AA8CF0",
  ariaLabel,
}) {
  const uid = safe(useId());
  const m = MOODS.includes(mood) ? mood : "neutral";
  const hop = animate && m === "happy";
  const showSparks = sparkles && animate && m === "happy";
  const acDark = mix(accent, INK, 0.38);
  const acLight = mix(accent, "#FFFFFF", 0.45);
  const dim = m === "sleepy" ? 0.55 : 1;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": "true" })}
      focusable="false"
      className={animate ? "lc-animate" : undefined}
    >
      <defs>
        <radialGradient id={`lh-${uid}`} cx=".5" cy=".5" r=".5">
          <stop offset=".55" stopColor={CREAM} stopOpacity=".2" />
          <stop offset="1" stopColor={CREAM} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`lb-${uid}`} x1=".2" y1=".05" x2=".75" y2=".95">
          <stop offset="0" stopColor="#FFFBFE" />
          <stop offset=".6" stopColor="#F1E7FA" />
          <stop offset="1" stopColor="#DCCAF2" />
        </linearGradient>
        <radialGradient id={`lg-${uid}`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#FFD98A" stopOpacity=".75" />
          <stop offset=".45" stopColor="#FFC84A" stopOpacity=".3" />
          <stop offset="1" stopColor="#FFC84A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`ll-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF1C2" />
          <stop offset="1" stopColor="#FFB547" />
        </linearGradient>
        <clipPath id={`lc-${uid}`}>
          <circle cx="29" cy="31" r="18" />
        </clipPath>
      </defs>
      <ellipse cx="30" cy="57" rx="14" ry="1.8" fill="#0D0618" opacity=".45" />
      <g className={hop ? "lc-hop" : undefined}>
        <g className="lc-body">
          <circle cx="29" cy="31" r="25" fill={`url(#lh-${uid})`} />
          <circle className="lc-glow" cx="52.2" cy="47.4" r="11.5" fill={`url(#lg-${uid})`} opacity={dim} />
          {/* boots */}
          <path d="M17.4 54.6 Q17 49.6 21.6 49.2 Q26.2 49 26.4 52.6 Q26.6 55.4 22.6 55.4 H18.4 Q17.4 55.4 17.4 54.6Z" fill="#4A3172" />
          <path d="M40.6 54.6 Q41 49.6 36.4 49.2 Q31.8 49 31.6 52.6 Q31.4 55.4 35.4 55.4 H39.6 Q40.6 55.4 40.6 54.6Z" fill="#4A3172" />
          <ellipse cx="20.8" cy="51.3" rx="2" ry=".9" fill="#7A5CB0" />
          <ellipse cx="34.6" cy="51.3" rx="2" ry=".9" fill="#7A5CB0" />
          {/* body */}
          <circle cx="29" cy="31" r="18" fill="#C7AEE6" />
          <circle cx="28.1" cy="30.1" r="16.7" fill={`url(#lb-${uid})`} />
          <ellipse cx="19.6" cy="20.4" rx="4.4" ry="2.3" transform="rotate(-38 19.6 20.4)" fill="#fff" opacity=".85" />
          <circle cx="41.4" cy="24.4" r="2.2" fill="#DCCAF2" opacity=".75" />
          <circle cx="37.6" cy="21.8" r="1.1" fill="#DCCAF2" opacity=".75" />
          <circle cx="16.2" cy="27.8" r="1.1" fill="#E4D6F4" />
          {/* tuft and crescent */}
          <path d="M27.4 13.6 C26.6 10.2 28.4 7.8 31.2 7.4 C29.6 8.8 29.2 10.8 30 13.4Z" fill="#E7DAF5" />
          <path d={TUFT_MOON} transform="translate(.6 .7)" fill="#D9932F" />
          <path d={TUFT_MOON} fill={GOLD} />
          <ellipse cx="35.8" cy="15.6" rx=".7" ry="1.5" transform="rotate(20 35.8 15.6)" fill="#FFF3CF" />
          <Face mood={m} />
          {/* scarf */}
          <g clipPath={`url(#lc-${uid})`}>
            <path d="M8 39.4 Q29 46.6 50 39.4 L50 45 Q29 53.4 8 45Z" fill={accent} />
            <path d="M8 43.6 Q29 51.4 50 43.6 L50 45 Q29 53.4 8 45Z" fill={acDark} opacity=".55" />
            <path d="M11 40.9 Q29 47 47 40.9" fill="none" stroke={acLight} strokeWidth="1.1" strokeLinecap="round" opacity=".8" />
          </g>
          <path d="M15.6 44 C14 46.4 13.4 48.6 13.6 51 L17.4 50.4 C17.2 48.4 17.6 46.6 18.8 45Z" fill={acDark} />
          <path d="M13.8 51.2 L13.7 52.5 M15.6 50.9 L15.7 52.2 M17.3 50.6 L17.6 51.8" stroke={acDark} strokeWidth="1" strokeLinecap="round" />
          <circle cx="17.2" cy="43.4" r="2.8" fill={accent} />
          <circle cx="16.4" cy="42.5" r="1" fill={acLight} opacity=".9" />
          {/* lantern */}
          <g transform="translate(46 39) scale(1.22) translate(-46 -39)">
            <path d="M46 40.4 Q49 36.8 51 40.6" fill="none" stroke="#4A3172" strokeWidth="1.3" strokeLinecap="round" />
            <ellipse cx="45.6" cy="39.2" rx="2.7" ry="2.4" fill="#C7AEE6" />
            <ellipse cx="45.2" cy="38.7" rx="2.2" ry="1.9" fill="#F4EBFB" />
            <path d="M47.6 43.2 L48.8 41 H53.2 L54.4 43.2Z" fill="#4A3172" />
            <rect x="47.6" y="42.8" width="6.8" height="8.6" rx="2.4" fill={`url(#ll-${uid})`} opacity={dim === 1 ? 1 : 0.85} />
            <path d="M51 43.6 V50.6" stroke="#D99434" strokeWidth=".7" opacity=".55" />
            <path d="M51 44.6 C52.4 46.2 52.4 48.4 51 49 C49.6 48.4 49.6 46.2 51 44.6Z" fill="#FF9A3D" opacity={0.9 * dim} />
            <ellipse cx="49.2" cy="44.8" rx=".7" ry="1.4" fill="#fff" opacity=".75" />
            <rect x="48.2" y="51" width="5.6" height="1.6" rx=".8" fill="#4A3172" />
          </g>
        </g>
      </g>
      {/* mood marks, always static */}
      {m === "sleepy" && (
        <>
          <path d="M44 12.4 H48 L44 16.6 H48" fill="none" stroke={MUTED} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M50.4 6.6 H53 L50.4 9.4 H53" fill="none" stroke={MUTED} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity=".8" />
        </>
      )}
      {m === "cozy" && (
        <path d="M48.6 16.4 C46.4 14.8 45.4 13.4 45.4 12.2 C45.4 10.4 47.6 9.8 48.6 11.6 C49.6 9.8 51.8 10.4 51.8 12.2 C51.8 13.4 50.8 14.8 48.6 16.4Z" fill={PINK} />
      )}
      {m === "curious" && (
        <>
          <path d={STAR_CURIOUS} fill={GOLD} />
          <circle cx="52.6" cy="9.4" r="1.1" fill={CREAM} />
        </>
      )}
      {showSparks &&
        SPARK_SHAPES.map((sp, i) => (
          <g key={i} transform={`translate(${sp.x} ${sp.y})`}>
            <path className="lc-spark" d={sp.d} fill={sp.fill} style={{ animationDelay: sp.delay }} />
          </g>
        ))}
    </svg>
  );
}
