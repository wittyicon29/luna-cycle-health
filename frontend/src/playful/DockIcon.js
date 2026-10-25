import React from "react";

// Variant A: pure line. 24x24, stroke 1.8, round caps and joins, colour from currentColor.
const PATHS = {
  journey: "M4 7 L8.7 5 L15.3 7 L20 5 V17 L15.3 19 L8.7 17 L4 19Z M8.7 5 V17 M15.3 7 V19",
  insights: "M12 2.5 C12.6 9 15 11.4 21.5 12 C15 12.6 12.6 15 12 21.5 C11.4 15 9 12.6 2.5 12 C9 11.4 11.4 9 12 2.5Z",
  chat: "M8 4 H16 A4.5 4.5 0 0 1 20.5 8.5 V12.5 A4.5 4.5 0 0 1 16 17 H11.5 L7 20.5 V17 A3.5 3.5 0 0 1 3.5 13.5 V8.5 A4.5 4.5 0 0 1 8 4Z",
};

export const DOCK_ICON_NAMES = ["journey", "calendar", "insights", "chat", "profile"];

function Art({ name }) {
  switch (name) {
    case "calendar":
      return (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
          <path d="M8 3 V6.5 M16 3 V6.5 M3.5 10 H20.5" />
        </>
      );
    case "profile":
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5 C4.5 16.4 7.9 14 12 14 C16.1 14 19.5 16.4 19.5 20.5" />
        </>
      );
    default:
      return <path d={PATHS[name]} />;
  }
}

export default function DockIcon({ name, active = false, size = 26 }) {
  if (!DOCK_ICON_NAMES.includes(name)) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-active={active ? "true" : "false"}
    >
      <Art name={name} />
    </svg>
  );
}
