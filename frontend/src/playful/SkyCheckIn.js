import React, { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { localDateString } from "../localDate";
import { MOODS, WEATHER, moodLabel } from "./weather";
import { checkInPatch } from "./checkin";
import { useOfflineData } from "../offline/useOffline";
import { tick } from "./haptics";
import { usePlayful } from "./playfulPrefs";
import WeatherIcon from "./WeatherIcon";

const NONE = Symbol("none");

// One-tap weather check-in. It merges the mood into today's existing log (never overwriting other fields) through
// the offline facade's patchLog, and serialises writes: one request at a time, later taps collapse into a single queued choice.
export default function SkyCheckIn({ token, logs, logsReady, onSaved, onAddDetails, compact = false, onShownChange }) {
  const { animated } = usePlayful();
  const data = useOfflineData();
  const today = localDateString();
  const [shown, setShown] = useState(() => (logsReady && logs && logs[today] ? logs[today].mood ?? null : null));
  const [error, setError] = useState(false);
  const [pulse, setPulse] = useState(null);
  const refs = useRef([]);
  const inFlight = useRef(false);
  const queued = useRef(NONE);
  const flying = useRef(null);
  const pulseTimer = useRef(null);
  const mounted = useRef(true);
  const shownRef = useRef(shown);
  const latest = useRef({});
  latest.current = { token, logs, logsReady, onSaved, animated, data };
  useEffect(() => { if (onShownChange) onShownChange(shown); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const setMood = v => { shownRef.current = v; if (mounted.current) setShown(v); };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(pulseTimer.current); }; }, []);
  // Follow the map's logs (e.g. after the day sheet saved) unless a write is under way.
  const fromLogs = logsReady && logs && logs[today] ? logs[today].mood ?? null : null;
  useEffect(() => { if (logsReady && !inFlight.current) setMood(fromLogs); }, [logsReady, fromLogs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(value) {
    const before = shownRef.current;
    // Set or clear is decided from the mood on screen; only an integer 1..5 is ever sent.
    const patch = checkInPatch(before, value);
    if (!patch) return;
    const target = patch.set.mood ?? null;
    inFlight.current = true;
    flying.current = target;
    const day = localDateString();
    let saved = false;
    setError(false);
    setMood(target);
    if (latest.current.animated) {
      setPulse(value);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => { if (mounted.current) setPulse(null); }, 700); // fallback if animationend never fires
    }
    try {
      // Online: merged into the server's current copy of the day (fresh read, then PUT). Offline: queued as a patch.
      await latest.current.data.patchLog(day, patch, latest.current.token);
      saved = true;
    } catch (e) {
      setMood(before);
      if (mounted.current) setError(true);
    }
    inFlight.current = false;
    const next = queued.current;
    queued.current = NONE;
    if (saved) {
      if (latest.current.animated) tick();
      if (latest.current.onSaved) latest.current.onSaved();
    }
    // after a failure the queued choice is dropped; a queued choice means "set", so one equal to what was just saved is skipped
    if (next !== NONE && saved && mounted.current && next !== target) run(next);
  }

  function select(value) {
    if (inFlight.current) {
      if (value === flying.current) return; // a repeat of the request already under way
      queued.current = value;
      return;
    }
    run(value);
  }

  const onKey = e => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const cur = shown == null ? (dir > 0 ? -1 : 0) : shown - 1;
    const idx = e.key === "Home" ? 0 : e.key === "End" ? MOODS.length - 1 : (cur + dir + MOODS.length) % MOODS.length;
    if (idx + 1 !== shown) select(idx + 1); // keys set a mood, they never clear it
    if (refs.current[idx]) refs.current[idx].focus();
  };

  const wrap = { padding: compact ? 0 : ".35rem .85rem", minWidth: 0 };
  return (
    <section aria-labelledby="sky-title" style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap", minWidth: 0 }}>
        <div id="sky-title" className={compact ? "vh" : undefined} style={{ fontSize: ".72rem", fontWeight: 600, minWidth: 0 }}>
          {shown != null ? t("Today's sky: {label}", { label: moodLabel(shown - 1) }) : t("How's your sky today?")}
        </div>
        {shown != null && !compact && (
          <button type="button" className="btn btn-g" style={{ minHeight: 44, fontSize: ".7rem", padding: "0 .6rem" }} onClick={onAddDetails}>
            {t("Add details")}
          </button>
        )}
      </div>
      <div className="sky-row" role="radiogroup" aria-labelledby="sky-title" onKeyDown={onKey}
        style={{ flexWrap: compact ? "nowrap" : "wrap", margin: compact ? 0 : ".2rem 0 0", gap: ".3rem", minWidth: 0 }}>
        {WEATHER.map((w, i) => {
          const on = shown === w.value;
          const stop = shown == null ? i === 0 : on;
          const label = moodLabel(i);
          return (
            <button key={w.value} type="button" role="radio" aria-checked={on} tabIndex={stop ? 0 : -1}
              ref={el => { refs.current[i] = el; }}
              className={`sky-btn ${on ? "on" : ""}${animated && pulse === w.value ? " sky-pulse" : ""}`}
              style={{ minWidth: 0, padding: "2px 2px", gap: 1 }}
              onAnimationEnd={() => setPulse(null)}
              onClick={() => select(w.value)}>
              <WeatherIcon name={w.key} size={36} active={on} plate={false} />
              <span className={compact ? "vh" : undefined}>{label}</span>
            </button>
          );
        })}
      </div>
      <div role="alert" style={{ fontSize: ".7rem", color: "#C4544A" }}>{error ? t("Couldn't save your check-in. Try again.") : null}</div>
    </section>
  );
}
