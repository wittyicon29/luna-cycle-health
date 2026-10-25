import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "./api";
import { formatLongDate } from "./localDate";
import { SYMPTOMS_LIST, symptomLabel, flowWord } from "./symptoms";
import { t, useLanguage } from "./i18n";
import { maxSelectableDay, MIN_LOG_DAY } from "./CalendarScreen";
import MedicationManager from "./MedicationManager";
import { MOODS, moodLabel } from "./playful/weather";

export { MOODS };
const MOOD_FACES = ["😞", "🙁", "😐", "🙂", "😄"];
const FLOWS = ["spotting", "light", "medium", "heavy"];
const NOTE_MAX = 1000;
const DATE_RANGE_RE = /\bdate\b.*\brange\b|\brange\b.*\bdate\b/i;

// Footer messages are kept as codes and turned into text at render, so they follow a language change.
function messageText(code) {
  switch (code) {
    case "saved": return t("Saved.");
    case "dateFail": return t("That date can't be saved yet. Pick today or an earlier day.");
    case "clearFail": return t("Couldn't clear this day. Your entries are still here — try again.");
    default: return t("Couldn't save this day. Your entries are still here — try again.");
  }
}

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

const canon = s => {
  const p = buildPayload(s);
  if (p.symptoms) p.symptoms = [...p.symptoms].sort();
  if (p.medications_taken) p.medications_taken = [...p.medications_taken].sort();
  return JSON.stringify(p);
};

// Merge the manager's new active list into everything we know (active + archived).
// `info` says why an active item vanished: archived (kept, marked) or deleted (dropped).
export function mergeMeds(prev, next, info) {
  const nextIds = new Set(next.map(m => m.id));
  const prevById = new Map(prev.map(m => [m.id, m]));
  const out = [];
  prev.forEach(m => {
    if (nextIds.has(m.id)) return;
    if (m.archived) out.push(m);
    else if (info && info.type === "archive" && info.id === m.id) out.push({ ...m, archived: true });
  });
  next.forEach(m => out.push({ ...(prevById.get(m.id) || {}), ...m, archived: false }));
  return out;
}

function Stepper({ label, resetLabel, value, step, min, max, firstPlus, firstMinus, format, onChange }) {
  const display = value == null ? "—" : (format ? format(value) : String(value));
  const up = () => onChange(value == null ? firstPlus : Math.min(max, value + step));
  const down = () => onChange(value == null ? firstMinus : Math.max(min, value - step));
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
      <button type="button" className="btn btn-g" style={tap} aria-label={t("Decrease {label}", { label })}
        disabled={(value == null && firstMinus == null) || (value != null && value <= min)} onClick={down}>−</button>
      <output aria-label={t("{label} value", { label })} style={{ minWidth: 64, textAlign: "center" }}>{display}</output>
      <button type="button" className="btn btn-g" style={tap} aria-label={t("Increase {label}", { label })}
        disabled={value != null && value >= max} onClick={up}>+</button>
      {value != null && <button type="button" className="btn btn-g btn-sm" style={tap} aria-label={resetLabel} onClick={() => onChange(null)}>{t("Reset")}</button>}
    </div>
  );
}

export default function DaySheet({ token, date, onClose, onSaved }) {
  useLanguage();
  const tooEarly = date < MIN_LOG_DAY;
  const tooFar = date > maxSelectableDay();
  const unavailable = tooFar || tooEarly;
  const [state, setState] = useState(EMPTY);
  const [baseline, setBaseline] = useState(canon(EMPTY));
  const [loadedMedIds, setLoadedMedIds] = useState([]);
  const [hasData, setHasData] = useState(false);
  const [allMeds, setAllMeds] = useState([]);
  const [medsLoaded, setMedsLoaded] = useState(false);
  const [medsError, setMedsError] = useState(false);
  const [loading, setLoading] = useState(!unavailable);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState("day");
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const dateRef = useRef(date);
  dateRef.current = date;
  const medSeq = useRef(0);
  const medsLoadedRef = useRef(false);
  const titleRef = useRef(null);
  const moodRefs = useRef([]);
  const closeRef = useRef(null);
  const manageRef = useRef(null);
  const drawerRef = useRef(null);
  const prevView = useRef("day");

  useEffect(() => {
    if (prevView.current === "meds" && view === "day" && manageRef.current) manageRef.current.focus();
    prevView.current = view;
  }, [view]);

  const trapTab = e => {
    if (e.key !== "Tab" || !drawerRef.current) return;
    const nodes = Array.from(drawerRef.current.querySelectorAll('button, input, textarea, select, summary, [tabindex]'))
      .filter(n => !n.disabled && n.getAttribute("tabindex") !== "-1" && n.type !== "hidden");
    if (!nodes.length) return;
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    const act = document.activeElement;
    const outside = !drawerRef.current.contains(act);
    if (e.shiftKey && (act === first || act === titleRef.current || outside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (act === last || outside)) { e.preventDefault(); first.focus(); }
  };

  const set = patch => setState(s => ({ ...s, ...patch }));

  // Focus moves into the sheet on open and returns to where it was on close.
  useEffect(() => {
    mounted.current = true;
    const prev = document.activeElement;
    if (titleRef.current) titleRef.current.focus();
    return () => {
      mounted.current = false;
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    };
  }, []);

  // Medication list: `initial` loads report failure in the section; background refetches never revert state.
  const loadMeds = useCallback(async (initial) => {
    const my = ++medSeq.current;
    try {
      const meds = await API.medications.list(token, true);
      if (my !== medSeq.current || !mounted.current) return;
      setAllMeds(Array.isArray(meds) ? meds : []);
      medsLoadedRef.current = true; setMedsLoaded(true); setMedsError(false);
    } catch (e) {
      if (my !== medSeq.current || !mounted.current) return;
      if (initial && !medsLoadedRef.current) setMedsError(true);
    }
  }, [token]);

  useEffect(() => {
    if (unavailable) return undefined;
    let alive = true;
    setLoading(true); setLoadError(false); setMedsError(false);
    medsLoadedRef.current = false; setMedsLoaded(false);
    API.logs.list(date, date, token).then(rows => {
      if (!alive) return;
      const row = Array.isArray(rows) ? rows.find(r => r && r.date === date) || rows[0] : null;
      const loaded = row ? fromRow(row) : EMPTY;
      setState(loaded);
      setBaseline(canon(loaded));
      setLoadedMedIds(loaded.meds);
      setHasData(!!row);
      setLoading(false);
    }).catch(() => { if (alive) { setLoadError(true); setLoading(false); } });
    loadMeds(true);
    return () => { alive = false; };
  }, [date, token, unavailable, retry, loadMeds]);

  const active = allMeds.filter(m => !m.archived);
  const known = new Set(allMeds.map(m => m.id));
  // Archived medications stay listed for the whole session if they were checked on load (or are checked now).
  const shown = allMeds.filter(m => !m.archived || loadedMedIds.includes(m.id) || state.meds.includes(m.id));
  const effective = medsLoaded ? { ...state, meds: state.meds.filter(id => known.has(id)) } : state;
  const blank = isBlank(effective);
  const canSave = !saving && !(blank && !hasData);
  const dirty = canon(state) !== baseline;

  const onManagerChange = (next, info) => {
    medSeq.current += 1; // any refetch still in flight is now stale
    setAllMeds(prev => mergeMeds(prev, next, info));
    if (info && info.type === "delete") {
      setState(s => ({ ...s, meds: s.meds.filter(id => id !== info.id) }));
      setLoadedMedIds(ids => ids.filter(id => id !== info.id));
      setBaseline(b => { try { const p = JSON.parse(b); if (p.medications_taken) p.medications_taken = p.medications_taken.filter(id => id !== info.id); if (!p.medications_taken || !p.medications_taken.length) delete p.medications_taken; return JSON.stringify(p); } catch (e) { return b; } });
    }
    loadMeds(false);
  };

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirty) { setConfirmDiscard(true); return; }
    if (onClose) onClose();
  };
  closeRef.current = () => { if (confirmDiscard) setConfirmDiscard(false); else requestClose(); };

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const finish = forDate => {
    if (onSaved) onSaved();
    if (onClose && mounted.current && dateRef.current === forDate) onClose();
  };

  const save = async () => {
    if (savingRef.current || (blank && !hasData)) return;
    const forDate = date;
    savingRef.current = true; setSaving(true); setMessage(null); setConfirmDiscard(false);
    try {
      await API.logs.put(forDate, buildPayload(effective), token);
      if (mounted.current) setMessage("saved");
      finish(forDate);
    } catch (e) {
      if (mounted.current) setMessage(e && e.status === 422 && DATE_RANGE_RE.test(e.rawMessage || "") ? "dateFail" : "saveFail");
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };

  const clearDay = async () => {
    if (savingRef.current) return;
    const forDate = date;
    savingRef.current = true; setSaving(true); setMessage(null);
    try {
      await API.logs.remove(forDate, token);
      finish(forDate);
    } catch (e) {
      if (mounted.current) setMessage("clearFail");
    } finally { savingRef.current = false; if (mounted.current) { setSaving(false); setConfirmClear(false); } }
  };

  const toggle = (key, v) => setState(s => ({ ...s, [key]: s[key].includes(v) ? s[key].filter(x => x !== v) : [...s[key], v] }));

  const moodKey = e => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const cur = state.mood == null ? (dir > 0 ? -1 : 0) : state.mood - 1;
    const idx = e.key === "Home" ? 0 : e.key === "End" ? MOODS.length - 1 : (cur + dir + MOODS.length) % MOODS.length;
    set({ mood: idx + 1 });
    if (moodRefs.current[idx]) moodRefs.current[idx].focus();
  };

  let body;
  if (tooEarly) {
    body = <p role="alert">{t("That date is too far back to log.")}</p>;
  } else if (tooFar) {
    body = <p role="alert">{t("This day is too far ahead to log yet. You can log up to tomorrow.")}</p>;
  } else if (loading) {
    body = <p style={{ color: "var(--muted)" }}>{t("Loading…")}</p>;
  } else if (loadError) {
    body = (
      <div role="alert">
        <p>{t("Couldn't load this day.")}</p>
        <button type="button" className="btn btn-g" style={tap} onClick={() => setRetry(n => n + 1)}>{t("Retry")}</button>
      </div>
    );
  } else if (view === "meds") {
    body = <MedicationManager token={token} medications={active} archivedMedications={allMeds.filter(m => m.archived)} onChange={onManagerChange} onBack={() => setView("day")} />;
  } else {
    body = (
      <>
        <section style={secStyle}>
          <div style={secTitle} id="ds-mood">{t("Mood")}</div>
          <div role="radiogroup" aria-labelledby="ds-mood" style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }} onKeyDown={moodKey}>
            {MOODS.map((_, i) => {
              const label = moodLabel(i);
              const v = i + 1; const on = state.mood === v;
              const stop = state.mood == null ? i === 0 : on;
              return (
                <button key={v} type="button" role="radio" aria-checked={on} aria-label={label} title={label}
                  ref={el => { moodRefs.current[i] = el; }} tabIndex={stop ? 0 : -1}
                  className={`chip ${on ? "on" : ""}`} style={{ ...tap, fontSize: "1.3rem" }}
                  onClick={() => set({ mood: on ? null : v })}>{MOOD_FACES[i]}</button>
              );
            })}
          </div>
        </section>
        <section style={secStyle}>
          <div style={secTitle}>{t("Symptoms")}</div>
          <div className="chips">
            {SYMPTOMS_LIST.map(s => (
              <button key={s} type="button" aria-pressed={state.symptoms.includes(s)} style={{ minHeight: 44 }}
                className={`chip ${state.symptoms.includes(s) ? "on" : ""}`} onClick={() => toggle("symptoms", s)}>{symptomLabel(s)}</button>
            ))}
          </div>
        </section>
        <section style={secStyle}>
          <div style={secTitle}>{t("Flow")}</div>
          <div className="chips">
            {FLOWS.map(f => (
              <button key={f} type="button" aria-pressed={state.flow === f} style={{ minHeight: 44 }}
                className={`chip ${state.flow === f ? "on" : ""}`} onClick={() => set({ flow: state.flow === f ? null : f })}>{flowWord(f)}</button>
            ))}
          </div>
        </section>
        <section style={secStyle}>
          <div style={secTitle}>{t("Sleep")}</div>
          <Stepper label={t("sleep hours")} resetLabel={t("Reset sleep")} value={state.sleep} step={0.5} min={0} max={24} firstPlus={7} firstMinus={6.5} format={v => (v === 1 ? t("1 h") : t("{hours} h", { hours: v }))} onChange={v => set({ sleep: v })} />
        </section>
        <section style={secStyle}>
          <div style={secTitle}>{t("Water")}</div>
          <Stepper label={t("glasses of water")} resetLabel={t("Reset water")} value={state.water} step={1} min={0} max={30} firstPlus={1} firstMinus={null} onChange={v => set({ water: v })} />
        </section>
        <section style={secStyle}>
          <div style={secTitle}>{t("Medications")}</div>
          {medsError ? (
            <div role="alert" style={{ fontSize: ".85rem" }}>
              <span>{t("Couldn't load your medications.")}</span>{" "}
              <button type="button" className="btn btn-g btn-sm" style={tap} onClick={() => { setMedsError(false); loadMeds(true); }}>{t("Retry")}</button>
            </div>
          ) : !medsLoaded ? (
            <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>{t("Loading medications…")}</p>
          ) : (
            <>
              {shown.length === 0 && <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>{t("No medications on your list yet.")}</p>}
              {shown.map(m => (
                <label key={m.id} style={{ display: "flex", alignItems: "center", gap: ".6rem", minHeight: 44 }}>
                  <input type="checkbox" checked={state.meds.includes(m.id)} style={{ width: 22, height: 22 }}
                    onChange={() => toggle("meds", m.id)} />
                  <span style={{ overflowWrap: "anywhere", minWidth: 0 }}><span style={{ overflowWrap: "anywhere", minWidth: 0 }} data-i18n-ignore>{m.name}</span>{m.archived ? <> {t("(archived)")}</> : null}</span>
                </label>
              ))}
              <button type="button" ref={manageRef} className="btn btn-g btn-sm" style={tap} onClick={() => setView("meds")}>{t("Manage my list")}</button>
            </>
          )}
        </section>
        <section style={secStyle}>
          <div className="f">
            <label htmlFor="ds-note" style={secTitle}>{t("Note")}</label>
            <textarea id="ds-note" rows={4} maxLength={NOTE_MAX} value={state.note} style={{ minHeight: 44 }}
              onChange={e => set({ note: e.target.value.slice(0, NOTE_MAX) })}
              onFocus={e => { const el = e.target; setTimeout(() => { try { if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" }); } catch (err) { /* best effort */ } }, 300); }} />
            <div style={{ textAlign: "right", fontSize: ".72rem", color: "var(--muted)" }}>{state.note.length}/{NOTE_MAX}</div>
          </div>
        </section>
      </>
    );
  }

  const showFooter = !unavailable && !loading && !loadError && view === "day";
  return (
    <>
      <div className="o-backdrop o-backdrop-top" aria-hidden="true" onClick={requestClose} />
      <div className="drawer drawer-top" ref={drawerRef} onKeyDown={trapTab} style={{ height: "88vh" }} role="dialog" aria-label={t("Log for {date}", { date: formatLongDate(date) })}>
        <div className="drawer-head">
          <span className="drawer-title" ref={titleRef} tabIndex={-1} style={{ outline: "none" }}>{formatLongDate(date)}</span>
          <button type="button" className="drawer-close" aria-label={t("Close")} disabled={saving} onClick={requestClose}>×</button>
        </div>
        {confirmDiscard && (
          <div role="alertdialog" aria-label={t("Discard changes?")} style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap", padding: ".5rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: ".85rem" }}>{t("Discard changes?")}</span>
            <button type="button" className="btn btn-g" style={tap} onClick={() => { setConfirmDiscard(false); if (titleRef.current) titleRef.current.focus(); }}>{t("Keep editing")}</button>
            <button type="button" className="btn btn-p" style={tap} onClick={() => { if (onClose) onClose(); }}>{t("Discard")}</button>
          </div>
        )}
        <div className="drawer-body" style={{ paddingBottom: "4rem", overscrollBehavior: "contain" }}>{body}</div>
        {showFooter && (
          <div style={{ padding: ".75rem 1.5rem 1rem", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            {message && <div role={message === "saved" ? "status" : "alert"} style={{ marginBottom: ".5rem", fontSize: ".85rem" }}>{messageText(message)}</div>}
            {blank && !hasData && <div style={{ marginBottom: ".5rem", fontSize: ".8rem", color: "var(--muted)" }}>{t("Nothing to save yet.")}</div>}
            {confirmClear ? (
              <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: ".85rem" }}>{t("Clear everything logged for this day?")}</span>
                <button type="button" className="btn btn-p" style={tap} disabled={saving} onClick={clearDay}>{t("Yes, clear")}</button>
                <button type="button" className="btn btn-g" style={tap} onClick={() => setConfirmClear(false)}>{t("Keep")}</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: ".5rem" }}>
                <button type="button" className="btn btn-p" style={{ ...tap, flex: 1 }} disabled={!canSave} onClick={save}>{t("Save")}</button>
                {hasData && <button type="button" className="btn btn-g" style={tap} disabled={saving} onClick={() => setConfirmClear(true)}>{t("Clear day")}</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
