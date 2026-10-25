import React, { useEffect, useRef, useState } from "react";
import { tn } from "../i18n";

const LIFT_MS = 900; // a little longer than the .6s fog-lift animation: the fallback when animationend never fires
const FILL = "rgba(217,200,234,.16)";
const EDGES = "linear-gradient(to bottom, rgba(217,200,234,.14), transparent 22px), linear-gradient(to top, rgba(217,200,234,.14), transparent 22px)";
const SURFACE = { backgroundColor: FILL, backgroundImage: EDGES };

// Days of `prev` runs that no run in `next` still covers, as runs.
function clearedRuns(prev, next) {
  const out = [];
  prev.forEach((r) => {
    let open = null;
    for (let i = r.start; i <= r.end; i++) {
      const still = next.some((n) => i >= n.start && i <= n.end);
      if (!still && open === null) open = i;
      if (still && open !== null) { out.push({ start: open, end: i - 1 }); open = null; }
    }
    if (open !== null) out.push({ start: open, end: r.end });
  });
  return out;
}

export function FogLayer({ runs, dayW, onOpenRun, animated }) {
  const prev = useRef(runs);
  const seq = useRef(0);
  const timers = useRef([]);
  const [lifted, setLifted] = useState([]);

  useEffect(() => {
    const gone = animated ? clearedRuns(prev.current, runs) : [];
    prev.current = runs;
    if (!gone.length) return;
    const items = gone.map((g) => ({ ...g, id: ++seq.current }));
    setLifted((l) => [...l, ...items]);
    items.forEach((it) => {
      const tid = setTimeout(() => {
        timers.current = timers.current.filter((x) => x !== tid);
        setLifted((l) => l.filter((x) => x.id !== it.id));
      }, LIFT_MS);
      timers.current.push(tid);
    });
  }, [runs, animated]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const open = (run, x) => onOpenRun(run, x);

  return (
    <div className="fog" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 5, pointerEvents: "none" }}>
      {lifted.map((l) => (
        <div
          key={`l${l.id}`}
          className="fog-lift"
          aria-hidden="true"
          onAnimationEnd={() => setLifted((x) => x.filter((i) => i.id !== l.id))}
          style={{ position: "absolute", top: 0, bottom: 0, left: l.start * dayW, width: (l.end - l.start + 1) * dayW, ...SURFACE, pointerEvents: "none" }}
        />
      ))}
      {runs.map((r) => {
        const count = r.end - r.start + 1;
        return (
          <div
            key={`${r.start}-${r.end}`}
            className="fog-run"
            role="button"
            tabIndex={0}
            // i18n-note: "mist" is the fog-of-war metaphor for days not yet logged; the Hindi uses धुंध (mist) and छँटना (to lift/clear), kept gentle and non-judgemental
            aria-label={tn(count, "Mist hasn't lifted here yet. Tap to add a day.", "Mist hasn't lifted on these {count} days yet. Tap to add one.")}
            onClick={(e) => { e.stopPropagation(); open(r, e.clientX - e.currentTarget.getBoundingClientRect().left); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); open(r, 0); }
            }}
            style={{ position: "absolute", top: 0, bottom: 0, left: r.start * dayW, width: count * dayW, ...SURFACE, pointerEvents: "auto", cursor: "pointer" }}
          />
        );
      })}
    </div>
  );
}
