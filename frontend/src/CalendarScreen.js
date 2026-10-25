import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { API } from "./api";
import { localDateString } from "./localDate";
import { monthGrid, shiftMonth, periodDaySet, predictedRangeSet, addDays, monthName, weekdayLabels } from "./calendarGrid";
import { t, useLanguage } from "./i18n";
import { flowWord } from "./symptoms";

// Latest selectable day: mirrors the backend limit (UTC today + 1) and never exceeds local tomorrow.
export function maxSelectableDay(now = new Date()) {
  const localTomorrow = addDays(localDateString(now), 1);
  const utcTomorrow = addDays(now.toISOString().slice(0, 10), 1);
  return localTomorrow < utcTomorrow ? localTomorrow : utcTomorrow;
}

// Earliest day the backend accepts for a daily log.
export const MIN_LOG_DAY = "2000-01-01";

export default function CalendarScreen({ token, periods, logsVersion, onClose, onOpenDay }) {
  useLanguage();
  const [today, setToday] = useState(() => localDateString());
  const maxDay = maxSelectableDay();
  useEffect(() => {
    const refresh = () => setToday(localDateString());
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(refresh, Math.max(1000, next - now));
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(timer); };
  }, [today]);
  const [view, setView] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [logs, setLogs] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [retry, setRetry] = useState(0);
  const reqId = useRef(0);

  const grid = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const { from, to } = grid;

  useEffect(() => {
    let alive = true;
    API.periods.prediction(token).then(p => { if (alive) setPrediction(p || null); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    reqId.current += 1;
    const id = reqId.current;
    setLoadError(false);
    API.logs.list(from, to, token).then(rows => {
      if (id !== reqId.current) return;
      const map = {};
      (Array.isArray(rows) ? rows : []).forEach(r => { if (r && r.date) map[r.date] = r; });
      setLogs(map);
    }).catch(() => {
      if (id !== reqId.current) return;
      setLogs({});
      setLoadError(true);
    });
    return () => { reqId.current += 1; };
  }, [from, to, token, logsVersion, retry]);

  const periodDays = useMemo(() => periodDaySet(periods, today), [periods, today]);
  const predicted = useMemo(() => predictedRangeSet(prediction, today), [prediction, today]);
  const go = useCallback(delta => setView(v => shiftMonth(v, delta)), []);

  const label = (cell) => {
    // The date word order comes from the catalog; the state words are a list joined with commas.
    const parts = [t("{month} {day}, {year}", { month: monthName(Number(cell.date.slice(5, 7)) - 1), day: cell.day, year: cell.date.slice(0, 4) })];
    // i18n-note: these state words are read aloud after the date by screen readers, e.g. "5 अक्टूबर 2026, आज, माहवारी का दिन"; unsure about the phrasing
    if (cell.date === today) parts.push(t("today"));
    if (periodDays.has(cell.date)) parts.push(t("period day"));
    if (predicted.has(cell.date)) parts.push(t("expected period"));
    const log = logs[cell.date];
    if (log) parts.push(t("logged"));
    if (log && log.flow) parts.push(t("flow {flow}", { flow: flowWord(log.flow) }));
    return parts.join(", ");
  };

  return (
    <>
      <div className="o-backdrop" onClick={onClose} />
      <div className="drawer" style={{ height: "88vh" }} role="dialog" aria-label={t("Calendar")}>
        <div className="drawer-head">
          <span className="drawer-title">{t("Calendar")}</span>
          <button className="drawer-close" aria-label={t("Close")} onClick={onClose}>×</button>
        </div>
        <div className="cal-body">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".5rem" }}>
            <button type="button" className="drawer-close" aria-label={t("Previous month")} disabled={view.year === 2000 && view.month === 0} onClick={() => go(-1)}>‹</button>
            <h2 className="drawer-title" style={{ margin: 0 }}>{monthName(view.month)} {view.year}</h2>
            <button type="button" className="drawer-close" aria-label={t("Next month")} onClick={() => go(1)}>›</button>
          </div>
          {loadError && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", margin: ".5rem 0", fontSize: ".85rem", color: "var(--muted)" }}>
              <span>{t("Couldn't load your logs. Tap Retry.")}</span>
              <button type="button" className="cal-retry" style={{ minHeight: 44, minWidth: 44 }} onClick={() => setRetry(n => n + 1)}>{t("Retry")}</button>
            </div>
          )}
          <div className="cal-grid" aria-hidden="true">
            {weekdayLabels().map((w, i) => <div key={i} className="cal-wd">{w}</div>)}
          </div>
          <div className="cal-grid">
            {grid.weeks.flat().map(cell => {
              const log = logs[cell.date];
              const cls = ["cal-day"];
              if (!cell.inMonth) cls.push("out");
              if (cell.date === today) cls.push("today");
              if (periodDays.has(cell.date)) cls.push("period");
              if (predicted.has(cell.date)) cls.push("predicted");
              return (
                <button key={cell.date} type="button" className={cls.join(" ")} style={{ minHeight: 44 }}
                  aria-label={label(cell)} disabled={cell.date > maxDay || cell.date < MIN_LOG_DAY} onClick={() => onOpenDay(cell.date)}>
                  <span>{cell.day}</span>
                  <span className="cal-marks" aria-hidden="true">
                    {log && <span className="cal-dot" data-testid="logged-dot">●</span>}
                    {log && log.flow && <span className="cal-flow" data-testid="flow-mark">▾</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cal-legend" style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", fontSize: ".75rem", color: "var(--muted)", margin: ".75rem 0" }}>
            <span><span className="cal-sw period" /> {t("Period")}</span>
            <span><span className="cal-sw predicted" /> {t("Expected period")}</span>
            <span>● {t("Logged")}</span>
            <span>▾ {t("Flow")}</span>
          </div>
          <button type="button" className="cal-today-btn" style={{ minHeight: 44 }} onClick={() => onOpenDay(today)}>{t("Log today")}</button>
        </div>
      </div>
    </>
  );
}
