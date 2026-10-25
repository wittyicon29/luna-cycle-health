import React, { useId } from "react";

const INK = "#2A1D45";
const CREAM = "#F5EEF8";
const GOLD = "#FFC84A";
const BLUSH = "#FF8FAB";
const TEAR = "#9FD0F5";

const CLOUD =
  "M13 36C8.6 36 6 33 6 29.6C6 26.2 8.7 23.6 12 23.5C12.6 17.6 17.4 13 23.4 13C28.4 13 32.6 16.2 34 20.7C38.6 20.9 42 24.5 42 28.6C42 32.7 38.8 36 34.6 36Z";
const MOON_OUTER = "M22.06 10A15 15 0 1 0 36.55 28.64A12 12 0 0 1 22.06 10Z";
const MOON_RIM = "M22.96 11A15 15 0 1 0 37.45 29.64A12 12 0 0 1 22.96 11Z";
const STAR = {
  s37_12: "M37 8.4Q37.65 11.35 40.6 12Q37.65 12.65 37 15.6Q36.35 12.65 33.4 12Q36.35 11.35 37 8.4Z",
  s40_30: "M40.5 27.4Q40.97 29.53 43.1 30Q40.97 30.47 40.5 32.6Q40.03 30.47 37.9 30Q40.03 29.53 40.5 27.4Z",
  s30_38: "M30.5 36.6Q30.84 38.16 32.4 38.5Q30.84 38.84 30.5 40.4Q30.16 38.84 28.6 38.5Q30.16 38.16 30.5 36.6Z",
  s5_11: "M5.4 8.4Q5.87 10.53 8 11Q5.87 11.47 5.4 13.6Q4.93 11.47 2.8 11Q4.93 10.53 5.4 8.4Z",
  s43_36: "M43 34.2Q43.4 36 45.2 36.4Q43.4 36.8 43 38.6Q42.6 36.8 40.8 36.4Q42.6 36 43 34.2Z",
  s41_9: "M41.6 8Q41.89 9.31 43.2 9.6Q41.89 9.89 41.6 11.2Q41.31 9.89 40 9.6Q41.31 9.31 41.6 8Z",
  act: "M41.6 4Q42.07 6.13 44.2 6.6Q42.07 7.07 41.6 9.2Q41.13 7.07 39 6.6Q41.13 6.13 41.6 4Z",
};

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

function Ln({ d, w = 1.6 }) {
  return <path d={d} fill="none" stroke={INK} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
}

function Dots({ x1, x2, y, r = 1.55 }) {
  const hi = (x) => <circle cx={x - r * 0.35} cy={y - r * 0.4} r={r * 0.4} fill="#fff" />;
  return (
    <>
      <circle cx={x1} cy={y} r={r} fill={INK} />
      <circle cx={x2} cy={y} r={r} fill={INK} />
      {hi(x1)}
      {hi(x2)}
    </>
  );
}

function Cloud({ gid, x = 0, y = 0, s = 1, top, bot, rim, hi = 0.55 }) {
  return (
    <>
      <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={top} />
        <stop offset="1" stopColor={bot} />
      </linearGradient>
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <path d={CLOUD} transform="translate(1 1.6)" fill={rim} />
        <path d={CLOUD} fill={`url(#${gid})`} />
        <ellipse cx="19" cy="18.6" rx="3.6" ry="1.9" transform="rotate(-30 19 18.6)" fill="#fff" opacity={hi} />
      </g>
    </>
  );
}

function Art({ name, id }) {
  switch (name) {
    case "storm":
      return (
        <>
          <path d="M24.6 32 L19.6 40.4 H24 L21.8 46.4 L30.2 36.6 H25.8 L28.6 32Z" fill={GOLD} stroke="#F0A93A" strokeWidth=".8" strokeLinejoin="round" />
          <path d="M11.6 38.6 C10.6 40.4 10.4 41.4 11.6 42 C12.8 41.4 12.6 40.4 11.6 38.6Z" fill={TEAR} />
          <path d="M35.6 38.6 C34.6 40.4 34.4 41.4 35.6 42 C36.8 41.4 36.6 40.4 35.6 38.6Z" fill={TEAR} />
          <Cloud gid={`ws-${id}`} y={-2} top="#8C7CC0" bot="#6A5A9E" rim="#463A72" hi={0.35} />
          <Dots x1={19.4} x2={28.2} y={25.6} />
          <Ln d="M16.8 22.6 L20.6 21.4" w={1.3} />
          <Ln d="M27 21.4 L30.8 22.6" w={1.3} />
          <Ln d="M21.2 30.4 Q22.5 29.2 23.8 30.2 Q25.1 31.2 26.4 30.1" w={1.4} />
          <path d="M17.8 27.8 C17.1 29.1 17 29.8 17.8 30.3 C18.6 29.8 18.5 29.1 17.8 27.8Z" fill={TEAR} />
        </>
      );
    case "overcast":
      return (
        <>
          <Cloud gid={`wo1-${id}`} x={13} y={2} s={0.7} top="#9B8FC6" bot="#8072AE" rim="#5C4F8A" hi={0.3} />
          <Cloud gid={`wo2-${id}`} x={-1} y={4.5} s={0.95} top="#C9BEE6" bot="#A79AD0" rim="#76689F" hi={0.5} />
          <Dots x1={17.8} x2={26} y={30} r={1.45} />
          <Ln d="M20 34 H23.8" w={1.5} />
        </>
      );
    case "thinCloud":
      return (
        <>
          <linearGradient id={`wtm-${id}`} x1=".2" y1="0" x2=".8" y2="1">
            <stop offset="0" stopColor="#FFF8E0" />
            <stop offset="1" stopColor="#FFD877" />
          </linearGradient>
          <circle cx="31.4" cy="16.4" r="10" fill="#E2A548" />
          <circle cx="30.8" cy="15.8" r="9.3" fill={`url(#wtm-${id})`} />
          <ellipse cx="27.4" cy="11.6" rx="2.6" ry="1.3" transform="rotate(-35 27.4 11.6)" fill="#fff" opacity=".8" />
          <circle cx="34.6" cy="12.4" r="1.9" fill="#F3CF84" />
          <circle cx="37" cy="17.4" r="1.1" fill="#F3CF84" />
          <Cloud gid={`wt-${id}`} x={1} y={11} s={0.86} top="#FFFBFE" bot="#DCD0F0" rim="#A797CF" hi={0.9} />
          <Ln d="M15.4 31.4 Q16.9 33.2 18.4 31.4" />
          <Ln d="M22.6 31.4 Q24.1 33.2 25.6 31.4" />
          <Ln d="M18.6 34.6 Q20 35.8 21.4 34.6" w={1.4} />
          <ellipse cx="13.6" cy="34.2" rx="1.6" ry="1" fill={BLUSH} opacity=".55" />
          <ellipse cx="27.4" cy="34.2" rx="1.6" ry="1" fill={BLUSH} opacity=".55" />
        </>
      );
    case "starry":
      return (
        <>
          <linearGradient id={`wsm-${id}`} x1=".1" y1="0" x2=".7" y2="1">
            <stop offset="0" stopColor="#FFF2C8" />
            <stop offset="1" stopColor={GOLD} />
          </linearGradient>
          <path d={MOON_RIM} fill="#E39B34" />
          <path d={MOON_OUTER} fill={`url(#wsm-${id})`} />
          <ellipse cx="12.4" cy="19.6" rx="1.4" ry="3" transform="rotate(28 12.4 19.6)" fill="#fff" opacity=".7" />
          <Ln d="M12.8 28.2 Q14.4 25.8 16 28.2" />
          <Ln d="M19.4 31.2 Q21 28.8 22.6 31.2" />
          <Ln d="M15.4 33.6 Q18 36.4 21 34.4" w={1.5} />
          <ellipse cx="12.6" cy="32.2" rx="1.5" ry=".95" fill={BLUSH} opacity=".6" />
          <path d={STAR.s37_12} fill={CREAM} />
          <path d={STAR.s40_30} fill={GOLD} />
          <path d={STAR.s30_38} fill={CREAM} />
          <circle cx="42.5" cy="20.5" r="1" fill={CREAM} opacity=".8" />
        </>
      );
    case "fullMoon":
      return (
        <>
          <radialGradient id={`wfh-${id}`} cx=".5" cy=".5" r=".5">
            <stop offset=".55" stopColor="#FFE7A6" stopOpacity=".45" />
            <stop offset="1" stopColor="#FFE7A6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`wfm-${id}`} x1=".15" y1="0" x2=".75" y2="1">
            <stop offset="0" stopColor="#FFFBEA" />
            <stop offset=".55" stopColor="#FFEAB0" />
            <stop offset="1" stopColor="#FFD06A" />
          </linearGradient>
          <circle cx="24" cy="24" r="23" fill={`url(#wfh-${id})`} />
          <circle cx="24" cy="24" r="18.4" fill="none" stroke="#FFE19A" strokeWidth="1.2" opacity=".45" />
          <circle cx="24.9" cy="24.9" r="15" fill="#E8A845" />
          <circle cx="24" cy="24" r="15" fill={`url(#wfm-${id})`} />
          <ellipse cx="16.8" cy="15" rx="3.8" ry="1.9" transform="rotate(-38 16.8 15)" fill="#fff" opacity=".85" />
          <circle cx="31.4" cy="15.6" r="2.4" fill="#F6D184" />
          <circle cx="35" cy="21" r="1.3" fill="#F6D184" />
          <circle cx="29" cy="35.4" r="1.6" fill="#F6D184" />
          <Ln d="M15.6 24.4 Q18.1 20.4 20.6 24.4" w={2} />
          <Ln d="M27.4 24.4 Q29.9 20.4 32.4 24.4" w={2} />
          <path d="M20.6 27.4 Q24 28.1 27.4 27.4 Q27 32.8 24 32.8 Q21 32.8 20.6 27.4Z" fill={INK} />
          <ellipse cx="24" cy="31.2" rx="1.8" ry="1.1" fill={BLUSH} />
          <ellipse cx="14.8" cy="28.4" rx="2.3" ry="1.4" fill={BLUSH} opacity=".75" />
          <ellipse cx="33.2" cy="28.4" rx="2.3" ry="1.4" fill={BLUSH} opacity=".75" />
          <path d={STAR.s5_11} fill={CREAM} />
          <path d={STAR.s43_36} fill={GOLD} />
          <path d={STAR.s41_9} fill={CREAM} />
        </>
      );
    default:
      return null;
  }
}

const NAMES = ["storm", "overcast", "thinCloud", "starry", "fullMoon"];

/**
 * plate (default true) draws the faint ring, or the gold disc when active.
 * Pass plate={false} where the surrounding button already has its own ring.
 */
export default function WeatherIcon({ name, size = 40, title, active = false, plate = true }) {
  const id = safe(useId());
  if (!NAMES.includes(name)) return null;
  const a11y = title ? { role: "img" } : { "aria-hidden": "true" };
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} focusable="false" {...a11y}>
      {title ? <title>{title}</title> : null}
      {plate &&
        (active ? (
          <>
            <circle cx="24" cy="24" r="22.6" fill={GOLD} fillOpacity=".14" stroke={GOLD} strokeWidth="1.6" />
            <path d={STAR.act} fill={GOLD} />
          </>
        ) : (
          <circle cx="24" cy="24" r="22.6" fill={CREAM} fillOpacity=".03" stroke="#3D2860" strokeWidth="1.2" />
        ))}
      <g transform="translate(24 24) scale(.92) translate(-24 -24)">
        <Art name={name} id={id} />
      </g>
    </svg>
  );
}
