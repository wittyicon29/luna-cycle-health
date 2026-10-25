import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "./api";
import { formatLongDate } from "./localDate";
import { SYMPTOMS_LIST } from "./symptoms";
import { maxSelectableDay } from "./CalendarScreen";
import MedicationManager from "./MedicationManager";

export const MOODS = ["Very low", "Low", "Okay", "Good", "Great"];
const MOOD_FACES = ["😞", "🙁", "😐", "🙂", "😄"];
const FLOWS = ["spotting", "light", "medium", "heavy"];
const NOTE_MAX = 1000;
const SAVE_FAIL = "Couldn't save this day. Your entries are still here — try again.";

export function buildPayload(s) {
  const out = {};
  if (s.mood != null) out.mood = s.mood;
  if (s.symptoms && s.symptoms.length) out.symptoms = [...new Set(s.symptoms)];
  if (s.flow) out.flow = s.flow;
  if (s.sleep != null) out.sleep_hours = s.sleep;
  if (s.water != null) out.water_glasses = s.water;
  if (s.meds && s.meds.length) out.medications_taken = [...new Set(s.meds)];
  const note = (s.note || "").trim();
  if (note) out.note = note;
  return out;
}

export const isBlank = s => Object.keys(buildPayload(s)).length === 0;

const EMPTY = { mood: null, symptoms: [], flow: null, sleep: null, water: null, meds: [], note: "" };
const fromRow = r => ({
  mood: r.mood ?? null,
  symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
  flow: r.flow || null,
  sleep: r.sleep_hours ?? null,
  water: r.water_glasses ?? null,
  meds: Array.isArray(r.medications_taken) ? r.medications_taken : [],
  note: r.note || "",
});

const tap = { minHeight: 44, minWidth: 44 };
const secStyle = { marginBottom: "1.25rem" };
const secTitle = { fontSize: ".8rem", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: ".5rem" };

function Stepper({ label, value, step, min, max, firstPlus, firstMinus, unit, onChange }) {
  const display = value == null ? "—" : `${value}${unit || ""}`;
  const up = () => onChange(value == null ? firstPlus : Math.min(max, value + step));
  const down = () => onChange(value == null ? firstMinus : Math.max(min, value - step));
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
      <button type="button" className="btn btn-g" style={tap} aria-label={`Decrease ${label}`}
        disabled={(value == null && firstMinus == null) || (value != null && value <= min)} onClick={down}>−</button>
      <output aria-label={`${label} value`} style={{ minWidth: 64, textAlign: "center" }}>{display}</output>
      <button type="button" className="btn btn-g" style={tap} aria-label={`Increase ${label}`}
        disabled={value != null && value >= max} onClick={up}>+</button>
      {value != null && <button type="button" className="btn btn-g btn-sm" style={tap} aria-label={`Clear ${label}`} onClick={() => onChange(null)}>Clear</button>}
    </div>
  );
}

export default function DaySheet({ token, date, onClose, onSaved }) {
  const tooFar = date > maxSelectableDay();
  const [state, setState] = useState(EMPTY);
  const [hasData, setHasData] = useState(false);
  const [allMeds, setAllMeds] = useState([]);
  const [loading, setLoading] = useState(!tooFar);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState("day");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const savingRef = useRef(false);

  const set = patch => setState(s => ({ ...s, ...patch }));

  useEffect(() => {
    if (tooFar) return undefined;
    let alive = true;
    setLoading(true); setLoadError(false);
    Promise.all([API.logs.list(date, date, token), API.medications.list(token, true)]).then(([rows, meds]) => {
      if (!alive) return;
      const list = Array.isArray(meds) ? meds : [];
      const known = new Set(list.map(m => m.id));
      const row = Array.isArray(rows) ? rows.find(r => r && r.date === date) || rows[0] : null;
      const loaded = row ? fromRow(row) : EMPTY;
      setAllMeds(list);
      setState({ ...loaded, meds: loaded.meds.filter(id => known.has(id)) });
      setHasData(!!row);
      setLoading(false);
    }).catch(() => { if (alive) { setLoadError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [date, token, tooFar, retry]);

  const refreshMeds = useCallback(async () => {
    try {
      const meds = await API.medications.list(token, true);
      if (Array.isArray(meds)) setAllMeds(meds);
    } catch (e) { /* the manager already reflects the change */ }
  }, [token]);

  const active = allMeds.filter(m => !m.archived);
  const known = new Set(allMeds.map(m => m.id));
  const shown = allMeds.filter(m => !m.archived || state.meds.includes(m.id));
  const effective = { ...state, meds: state.meds.filter(id => known.has(id)) };
  const blank = isBlank(effective);
  const canSave = !saving && !(blank && !hasData);

  const finish = () => { if (onSaved) onSaved(); if (onClose) onClose(); };

  const save = async () => {
    if (savingRef.current || (blank && !hasData)) return;
    savingRef.current = true; setSaving(true); setMessage("");
    try {
      await API.logs.put(date, buildPayload(effective), token);
      setMessage("Saved.");
      finish();
    } catch (e) {
      setMessage(SAVE_FAIL);
    } finally { savingRef.current = false; setSaving(false); }
  };

  const clearDay = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setMessage("");
    try {
      await API.logs.remove(date, token);
      finish();
    } catch (e) {
      setMessage("Couldn't clear this day. Your entries are still here — try again.");
    } finally { savingRef.current = false; setSaving(false); setConfirmClear(false); }
  };

  const toggle = (key, v) => setState(s => ({ ...s, [key]: s[key].includes(v) ? s[key].filter(x => x !== v) : [...s[key], v] }));

  let body;
  if (tooFar) {
    body = <p role="alert">This day is too far ahead to log yet. You can log up to tomorrow.</p>;
  } else if (loading) {
    body = <p style={{ color: "var(--muted)" }}>Loading…</p>;
  } else if (loadError) {
    body = (
      <div role="alert">
        <p>Couldn't load this day.</p>
        <button type="button" className="btn btn-g" style={tap} onClick={() => setRetry(n => n + 1)}>Retry</button>
      </div>
    );
  } else if (view === "meds") {
    body = <MedicationManager token={token} medications={active} onChange={() => { refreshMeds(); }} onBack={() => setView("day")} />;
  } else {
    body = (
      <>
        <section style={secStyle}>
          <div style={secTitle} id="ds-mood">Mood</div>
          <div role="radiogroup" aria-labelledby="ds-mood" style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
            {MOODS.map((label, i) => {
              const v = i + 1; const on = state.mood === v;
              return (
                <button key={v} type="button" role="radio" aria-checked={on} aria-label={label} title={label}
                  className={`chip ${on ? "on" : ""}`} style={{ ...tap, fontSize: "1.3rem" }}
                  onClick={() => set({ mood: on ? null : v })}>{MOOD_FACES[i]}</button>
              );
            })}
          </div>
        </section>
        <section style={secStyle}>
          <div style={secTitle}>Symptoms</div>
          <div className="chips">
            {SYMPTOMS_LIST.map(s => (
              <button key={s} type="button" aria-pressed={state.symptoms.includes(s)} style={{ minHeight: 44 }}
                className={`chip ${state.symptoms.includes(s) ? "on" : ""}`} onClick={() => toggle("symptoms", s)}>{s}</button>
            ))}
          </div>
        </section>
        <section style={secStyle}>
          <div style={secTitle}>Flow</div>
          <div className="chips">
            {FLOWS.map(f => (
              <button key={f} type="button" aria-pressed={state.flow === f} style={{ minHeight: 44 }}
                className={`chip ${state.flow === f ? "on" : ""}`} onClick={() => set({ flow: state.flow === f ? null : f })}>{f}</button>
            ))}
          </div>
        </section>
        <section style={secStyle}>
          <div style={secTitle}>Sleep</div>
          <Stepper label="sleep hours" value={state.sleep} step={0.5} min={0} max={24} firstPlus={7} firstMinus={6.5} unit=" h" onChange={v => set({ sleep: v })} />
        </section>
        <section style={secStyle}>
          <div style={secTitle}>Water</div>
          <Stepper label="glasses of water" value={state.water} step={1} min={0} max={30} firstPlus={1} firstMinus={null} onChange={v => set({ water: v })} />
        </section>
        <section style={secStyle}>
          <div style={secTitle}>Medications</div>
          {shown.length === 0 && <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>No medications on your list yet.</p>}
          {shown.map(m => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: ".6rem", minHeight: 44 }}>
              <input type="checkbox" checked={state.meds.includes(m.id)} style={{ width: 22, height: 22 }}
                onChange={() => toggle("meds", m.id)} />
              <span>{m.name}{m.archived ? " (archived)" : ""}</span>
            </label>
          ))}
          <button type="button" className="btn btn-g btn-sm" style={tap} onClick={() => setView("meds")}>Manage my list</button>
        </section>
        <section style={secStyle}>
          <div className="f">
            <label htmlFor="ds-note" style={secTitle}>Note</label>
            <textarea id="ds-note" rows={4} maxLength={NOTE_MAX} value={state.note} style={{ minHeight: 44 }}
              onChange={e => set({ note: e.target.value.slice(0, NOTE_MAX) })} />
            <div style={{ textAlign: "right", fontSize: ".72rem", color: "var(--muted)" }}>{state.note.length}/{NOTE_MAX}</div>
          </div>
        </section>
      </>
    );
  }

  const showFooter = !tooFar && !loading && !loadError && view === "day";
  return (
    <>
      <div className="o-backdrop o-backdrop-top" onClick={onClose} />
      <div className="drawer drawer-top" style={{ height: "88vh" }} role="dialog" aria-label={`Log for ${formatLongDate(date)}`}>
        <div className="drawer-head">
          <span className="drawer-title">{formatLongDate(date)}</span>
          <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">{body}</div>
        {showFooter && (
          <div style={{ padding: ".75rem 1.5rem 1rem", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            {message && <div role="status" style={{ marginBottom: ".5rem", fontSize: ".85rem" }}>{message}</div>}
            {blank && !hasData && <div style={{ marginBottom: ".5rem", fontSize: ".8rem", color: "var(--muted)" }}>Nothing to save yet.</div>}
            {confirmClear ? (
              <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: ".85rem" }}>Clear everything logged for this day?</span>
                <button type="button" className="btn btn-p" style={tap} disabled={saving} onClick={clearDay}>Yes, clear</button>
                <button type="button" className="btn btn-g" style={tap} onClick={() => setConfirmClear(false)}>Keep</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: ".5rem" }}>
                <button type="button" className="btn btn-p" style={{ ...tap, flex: 1 }} disabled={!canSave} onClick={save}>Save</button>
                {hasData && <button type="button" className="btn btn-g" style={tap} disabled={saving} onClick={() => setConfirmClear(true)}>Clear day</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
