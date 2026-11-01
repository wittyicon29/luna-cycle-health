import { useEffect, useId, useRef } from "react";
import { t, useLanguage } from "./i18n";

const FOCUSABLE = 'a[href], button, input, textarea, select, summary, [tabindex]';

// The app's centred modal. `dialog` opts in to dialog semantics: role="dialog" labelled by the title, focus moves in
// on open and returns on close, Tab stays inside, Escape closes. Existing callers leave it off and render as before.
export default function Modal({ title, onClose, children, footer, dialog = false }) {
  useLanguage();
  const titleId = useId();
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!dialog) return undefined;
    const prev = document.activeElement;
    if (boxRef.current) boxRef.current.focus();
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    };
  }, [dialog]);

  const trapTab = e => {
    if (!dialog || e.key !== "Tab" || !boxRef.current) return;
    const nodes = Array.from(boxRef.current.querySelectorAll(FOCUSABLE))
      .filter(n => !n.disabled && n.getAttribute("tabindex") !== "-1");
    if (!nodes.length) return;
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    const act = document.activeElement;
    const outside = !boxRef.current.contains(act) || act === boxRef.current;
    if (e.shiftKey && (act === first || outside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (act === last || outside)) { e.preventDefault(); first.focus(); }
  };

  const a11y = dialog ? { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: -1, ref: boxRef, onKeyDown: trapTab } : {};
  return (
    <div className="modal-ov" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" {...a11y}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.4rem" }}>
          <div className="modal-title" id={dialog ? titleId : undefined}>{title}</div>
          <button className="modal-close" aria-label={t("Close")} onClick={onClose}>×</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
