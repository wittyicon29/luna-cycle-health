import React from "react";

const STAR = "M0 -3 L1 -1 L3 0 L1 1 L0 3 L-1 1 L-3 0 L-1 -1 Z";
const CLOUD = "M12 36 a7 7 0 0 1 2-13.7 A10 10 0 0 1 33 25 a6.5 6.5 0 0 1 1 13 H14 Z";

function Star({ x, y, s = 0.8, fill = "#F5EEF8" }) {
  return <path d={STAR} fill={fill} transform={`translate(${x} ${y}) scale(${s})`} />;
}

function art(name) {
  switch (name) {
    case "fullMoon":
      return (
        <>
          <circle cx="24" cy="24" r="14" fill="#FFE9A8" />
          <circle cx="19" cy="20" r="2.5" fill="#F2D27A" />
          <circle cx="29" cy="28" r="3" fill="#F2D27A" />
          <circle cx="27" cy="18" r="1.5" fill="#F2D27A" />
        </>
      );
    case "starry":
      return (
        <>
          <path d="M30 10 A14 14 0 1 0 38 30 A11 11 0 1 1 30 10 Z" fill="#FFE9A8" />
          <Star x={12} y={14} s={1.2} />
          <Star x={39} y={12} s={1.1} />
          <Star x={41} y={34} s={1} />
        </>
      );
    case "thinCloud":
      return (
        <>
          <circle cx="32" cy="16" r="8" fill="#FFE9A8" />
          <path d={CLOUD} fill="#C9BFE0" opacity=".95" transform="translate(0 2)" />
        </>
      );
    case "overcast":
      return (
        <>
          <path d={CLOUD} fill="#8E82B0" transform="translate(3 -3)" />
          <path d="M8 40 a5 5 0 0 1 1.5-9.8 A7 7 0 0 1 23 32 a4.5 4.5 0 0 1 .8 8 H9 Z" fill="#A99DC8" transform="translate(0 2)" />
        </>
      );
    case "storm":
      return (
        <>
          <path d={CLOUD} fill="#6B5F8F" transform="translate(2 -6)" />
          <path d="M27 28 L19 41 H25 L22 48 L33 34 H27 Z" fill="#FFC84A" />
        </>
      );
    default:
      return null;
  }
}

export default function WeatherIcon({ name, size = 40, title }) {
  const content = art(name);
  if (!content) return null;
  const a11y = title ? { role: "img" } : { "aria-hidden": "true" };
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      focusable="false"
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}
