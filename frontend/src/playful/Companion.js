import React from "react";

const INK = "#2A1D45";
const STAR = "M0 -3 L1 -1 L3 0 L1 1 L0 3 L-1 1 L-3 0 L-1 -1 Z";
const SPARKS = [
  { x: 12, y: 14, d: "0s" },
  { x: 52, y: 10, d: ".15s" },
  { x: 56, y: 46, d: ".3s" },
];

function Face({ mood }) {
  const line = { stroke: INK, strokeWidth: 1.6, fill: "none", strokeLinecap: "round" };
  switch (mood) {
    case "happy":
      return (
        <g data-face="happy">
          <path d="M23 31 Q26 26 29 31" {...line} />
          <path d="M35 31 Q38 26 41 31" {...line} />
          <path d="M27 36 Q32 45 37 36 Z" fill={INK} />
        </g>
      );
    case "sleepy":
      return (
        <g data-face="sleepy">
          <path d="M23 31 H29" {...line} />
          <path d="M35 31 H41" {...line} />
          <path d="M30 38 H34" {...line} />
        </g>
      );
    case "cozy":
      return (
        <g data-face="cozy">
          <path d="M23 29 Q26 33 29 29" {...line} />
          <path d="M35 29 Q38 33 41 29" {...line} />
          <circle cx="22" cy="35" r="3" fill="#F28BA0" opacity=".5" />
          <circle cx="42" cy="35" r="3" fill="#F28BA0" opacity=".5" />
          <path d="M29 37 Q32 39 35 37" {...line} />
        </g>
      );
    default:
      return (
        <g data-face="neutral">
          <circle cx="26" cy="30" r="2" fill={INK} />
          <circle cx="38" cy="30" r="2" fill={INK} />
          <path d="M28 37 Q32 40 36 37" {...line} />
        </g>
      );
  }
}

export default function Companion({ mood = "neutral", size = 64, animate = false, sparkles = false, ariaLabel }) {
  const m = ["neutral", "happy", "sleepy", "cozy"].includes(mood) ? mood : "neutral";
  const hop = animate && m === "happy";
  const showSparks = sparkles && animate && m === "happy";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": "true" })}
      focusable="false"
      className={animate ? "lc-animate" : undefined}
    >
      <g className={hop ? "lc-hop" : undefined}>
        <g className="lc-body">
          <circle cx="32" cy="30" r="22" fill="#F5EEF8" opacity=".14" />
          <ellipse cx="26" cy="51" rx="5" ry="3" fill="#D9C8EA" />
          <ellipse cx="38" cy="51" rx="5" ry="3" fill="#D9C8EA" />
          <circle cx="32" cy="30" r="18" fill="#F7F0FA" />
          <path d="M47 22 Q55 26 54 34" stroke="#D9C8EA" strokeWidth="1.6" fill="none" />
          <rect x="50" y="33" width="8" height="2" rx="1" fill={INK} />
          <rect x="50.5" y="35" width="7" height="9" rx="2" fill="#FFC84A" />
          <Face mood={m} />
        </g>
      </g>
      {showSparks &&
        SPARKS.map((s, i) => (
          <g key={i} transform={`translate(${s.x} ${s.y})`}>
            <path className="lc-spark" d={STAR} fill="#FFC84A" style={{ animationDelay: s.d }} />
          </g>
        ))}
    </svg>
  );
}
