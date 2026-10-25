import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { API } from "./api";
import { localDateString } from "./localDate";
import { monthGrid, shiftMonth, periodDaySet, predictedRangeSet, addDays, MONTH_NAMES, WEEKDAY_LABELS } from "./calendarGrid";

// Latest selectable day: mirrors the backend limit (UTC today + 1) and never exceeds local tomorrow.
export function maxSelectableDay(now = new Date()) {
  const localTomorrow = addDays(localDateString(now), 1);
  const utcTomorrow = addDays(now.toISOString().slice(0, 10), 1);
  return localTomorrow < utcTomorrow ? localTomorrow : utcTomorrow;
}

export default function CalendarScreen({ token, periods, logsVersion, onClose, onOpenDay }) {
  const [today, setToday] = useState(() => localDateString());
  const maxDay = maxSelectableDay();
  useEffect(() => {
    const refresh = () => setToday(localDateString());
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const t = setTimeout(refresh, Math.max(1000, next - now));
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(t); };
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
    const parts = [`${MONTH_NAMES[Number(cell.date.slice(5, 7)) - 1]} ${cell.day}, ${cell.date.slice(0, 4)}`];
    if (cell.date === today) parts.push("today");
    if (periodDays.has(cell.date)) parts.push("period day");
    if (predicted.has(cell.date)) parts.push("expected period");
    const log = logs[cell.date];
    if (log) parts.push("logged");
    if (log && log.flow) parts.push(`flow ${log.flow}`);
    return parts.join(", ");
  };

  return (
    <>
      <div className="o-backdrop" onClick={onClose} />
      <div className="drawer" style={{ height: "88vh" }} role="dialog" aria-label="Calendar">
        <div className="drawer-head">
          <span className="drawer-title">Calendar</span>
          <button className="drawer-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1rem 1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".5rem" }}>
            <button type="button" className="drawer-close" aria-label="Previous month" onClick={() => go(-1)}>‹</button>
            <h2 className="drawer-title" style={{ margin: 0 }}>{MONTH_NAMES[view.month]} {view.year}</h2>
            <button type="button" className="drawer-close" aria-label="Next month" onClick={() => go(1)}>›</button>
          </div>
          {loadError && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", margin: ".5rem 0", fontSize: ".85rem", color: "var(--muted)" }}>
              <span>Couldn't load your logs. Tap Retry.</span>
              <button type="button" className="cal-retry" style={{ minHeight: 44, minWidth: 44 }} onClick={() => setRetry(n => n + 1)}>Retry</button>
            </div>
          )}
          <div className="cal-grid" aria-hidden="true">
            {WEEKDAY_LABELS.map((w, i) => <div key={i} className="cal-wd">{w}</div>)}
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
                  aria-label={label(cell)} disabled={cell.date > maxDay} onClick={() => onOpenDay(cell.date)}>
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
            <span><span className="cal-sw period" /> Period</span>
            <span><span className="cal-sw predicted" /> Expected period</span>
            <span>● Logged</span>
            <span>▾ Flow</span>
          </div>
          <button type="button" className="cal-today-btn" style={{ minHeight: 44 }} onClick={() => onOpenDay(today)}>Log today</button>
        </div>
      </div>
    </>
  );
}
