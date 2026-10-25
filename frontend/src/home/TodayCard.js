import React, { useEffect, useId, useRef, useState } from "react";
import { t, useLanguage } from "../i18n";
import SkyCheckIn from "../playful/SkyCheckIn";
import { usePlayful } from "../playful/playfulPrefs";
import { moodLabel } from "../playful/weather";
import ProfileBanner from "../ProfileBanner";

// The bottom "Today" card: a one-line summary, the weather check-in, and a chevron that opens the old stats.
export default function TodayCard({ token, logs, logsReady, onSaved, onAddDetails, cycleDay, daysToNext, avgCycle, periodsCount, phaseName, phaseColor, profilePrompt }) {
  useLanguage();
  const { animated } = usePlayful();
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState(null);
  const root = useRef(null);
  const chev = useRef(null);
  const panelId = useId();
  const hintId = useId();
  const close = (focus) => { setOpen(false); if (focus && chev.current) chev.current.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === "Escape") close(true); };
    const onDown = e => { if (root.current && !root.current.contains(e.target)) close(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const parts = [];
  if (cycleDay && typeof phaseName === "string" && phaseName) parts.push(t("Day {day} · {phase}", { day: cycleDay, phase: phaseName }));
  if (Number.isFinite(daysToNext)) parts.push(`${t("Next in")} ${t("{days}d", { days: daysToNext })}`);
  if (mood != null) parts.push(t("Today's sky: {label}", { label: moodLabel(mood - 1) }));

  return (
    <div className="today-card" data-open={open ? "true" : "false"} ref={root}>
      {open && (
        <div id={panelId} className="today-panel" role="region" aria-label={t("Today's details")}>
          {/* i18n-note: "Next in" is shown as अगली माहवारी above "N दिन"; the label is long for a five-column strip, check the layout */}
          {/* i18n-note: "आज का ब्यौरा" (today's details) and "प्रोफ़ाइल अधूरी है" (profile incomplete) are new wording for the native reviewer */}
          <div className="today-stats">
            <div className="st-item"><div className="st-val" style={{ color: phaseColor, fontFamily: "'Fira Code','Noto Sans Devanagari',monospace", fontSize: "1.2rem" }}>{cycleDay ?? "—"}</div><div className="st-lbl">{t("Cycle Day")}</div></div>
            <div className="st-item"><div className="st-val">{Number.isFinite(daysToNext) ? t("{days}d", { days: daysToNext }) : "—"}</div><div className="st-lbl">{t("Next in")}</div></div>
            <div className="st-item"><div className="st-val">{avgCycle}</div><div className="st-lbl">{t("Avg Cycle")}</div></div>
            <div className="st-item"><div className="st-val">{periodsCount}</div><div className="st-lbl">{t("Logged")}</div></div>
            <div className="st-item"><div className="st-val st-val-phase" style={{ color: phaseColor, lineHeight: 1.2, fontFamily: "'Outfit','Noto Sans Devanagari',sans-serif" }}>{phaseName}</div><div className="st-lbl">{t("Phase")}</div></div>
          </div>
          <button type="button" className="btn btn-g" style={{ minHeight: 44 }} onClick={() => { onAddDetails(); close(false); }}>{t("Add details")}</button>
          {profilePrompt && <ProfileBanner onStart={profilePrompt.onStart} onLater={profilePrompt.onLater} />}
        </div>
      )}
      <div className="today-sum">{parts.join(" · ")}</div>
      <div className="today-row">
        <div className="today-sky">
          <SkyCheckIn compact token={token} logs={logs} logsReady={logsReady} onSaved={onSaved} onAddDetails={onAddDetails} onShownChange={setMood} />
        </div>
        <button ref={chev} type="button" className="today-chev" aria-expanded={open} aria-controls={open ? panelId : undefined}
          aria-describedby={profilePrompt ? hintId : undefined}
          aria-label={open ? t("Hide today's details") : t("Show today's details")} onClick={() => setOpen(o => !o)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: animated ? "transform .2s" : undefined }}><path d="M6 15l6-6 6 6" /></svg>
          {profilePrompt && <span className="today-dot" aria-hidden="true" />}
          {profilePrompt && <span id={hintId} className="vh">{t("Profile incomplete")}</span>}
        </button>
      </div>
    </div>
  );
}
