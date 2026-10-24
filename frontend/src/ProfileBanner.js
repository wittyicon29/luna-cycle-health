import React from "react";

const btn = { minHeight: 44, minWidth: 44 };

export default function ProfileBanner({ onStart, onLater }) {
  return (
    <div role="region" aria-label="Health profile"
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".6rem", justifyContent: "space-between", padding: ".5rem 1rem", background: "#1A0F2E", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
      <span style={{ fontSize: ".8rem", color: "var(--cream)" }}>Complete your health profile for better insights.</span>
      <span style={{ display: "flex", gap: ".5rem" }}>
        <button type="button" className="btn btn-p btn-sm" style={btn} onClick={onStart}>Start</button>
        <button type="button" className="btn btn-g btn-sm" style={btn} onClick={onLater}>Later</button>
      </span>
    </div>
  );
}
