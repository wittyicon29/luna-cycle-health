import React, { useEffect, useRef, useState } from "react";
import { API } from "../api";
import { t } from "../i18n";
import { localDateString } from "../localDate";
import { MOODS, WEATHER, moodLabel } from "./weather";
import { buildCheckInPayload } from "./checkin";
import { tick } from "./haptics";
import { usePlayful } from "./playfulPrefs";
import WeatherIcon from "./WeatherIcon";

const NONE = Symbol("none");

// Comparable form of a log entry's check-in fields (ignores date/updated_at).
function norm(e) {
  const p = buildCheckInPayload(e, null);
  if (e && Number.isInteger(e.mood)) p.mood = e.mood;
  return JSON.stringify(Object.keys(p).sort().map(k => [k, p[k]]));
}
const sameEntry = (a, b) => norm(a) === norm(b);

// One-tap weather check-in. It merges the mood into today's existing log (never overwriting other fields)
// and serialises writes: one request at a time, later taps collapse into a single queued choice.
export default function SkyCheckIn({ token, logs, logsReady, onSaved, onAddDetails }) {
  const { animated } = usePlayful();
  const today = localDateString();
  const [shown, setShown] = useState(() => (logsReady && logs && logs[today] ? logs[today].mood ?? null : null));
  const [error, setError] = useState(false);
  const [pulse, setPulse] = useState(null);
  const refs = useRef([]);
  const inFlight = useRef(false);
  const queued = useRef(NONE);
  const flying = useRef(null);
  const lastSaved = useRef(null);
  const mounted = useRef(true);
  const shownRef = useRef(shown);
  const latest = useRef({});
  latest.current = { token, logs, logsReady, onSaved, animated };
  const setMood = v => { shownRef.current = v; if (mounted.current) setShown(v); };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Follow the map's logs (e.g. after the day sheet saved) unless a write is under way.
  const fromLogs = logsReady && logs && logs[today] ? logs[today].mood ?? null : null;
  useEffect(() => { if (logsReady && !inFlight.current) setMood(fromLogs); }, [logsReady, fromLogs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(value) {
    inFlight.current = true;
    flying.current = value;
    const day = localDateString();
    const before = shownRef.current;
    let saved = null;
    try {
      setError(false);
      const cur = latest.current;
      let entry;
      const ls = lastSaved.current;
      if (ls && ls.date === day && !(cur.logsReady && cur.logs && cur.logs[day] && sameEntry(cur.logs[day], ls.payload))) {
        entry = { ...ls.payload, date: day }; // our own latest write, until the map's logs catch up
      } else if (cur.logsReady) {
        entry = (cur.logs && cur.logs[day]) || null;
      } else {
        const rows = await API.logs.list(day, day, cur.token);
        entry = (Array.isArray(rows) ? rows.find(r => r && r.date === day) : null) || null;
      }
      const payload = buildCheckInPayload(entry, value);
      flying.current = payload.mood ?? null;
      setMood(flying.current);
      if (latest.current.animated) setPulse(value);
      await API.logs.put(day, payload, latest.current.token);
      saved = payload;
      lastSaved.current = { date: day, payload };
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
    if (next !== NONE && saved && mounted.current && next !== (saved.mood ?? null)) run(next);
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

  const wrap = { padding: ".35rem .85rem", minWidth: 0 };
  return (
    <section aria-labelledby="sky-title" style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap", minWidth: 0 }}>
        <div id="sky-title" style={{ fontSize: ".72rem", fontWeight: 600, minWidth: 0 }}>
          {shown != null ? t("Today's sky: {label}", { label: moodLabel(shown - 1) }) : t("How's your sky today?")}
        </div>
        {shown != null && (
          <button type="button" className="btn btn-g" style={{ minHeight: 44, fontSize: ".7rem", padding: "0 .6rem" }} onClick={onAddDetails}>
            {t("Add details")}
          </button>
        )}
      </div>
      <div className="sky-row" role="radiogroup" aria-labelledby="sky-title" onKeyDown={onKey}
        style={{ flexWrap: "wrap", margin: ".2rem 0 0", gap: ".3rem", minWidth: 0 }}>
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
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <div role="alert" style={{ fontSize: ".7rem", color: "#C4544A" }}>{error ? t("Couldn't save your check-in. Try again.") : null}</div>
    </section>
  );
}
