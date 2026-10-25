import { useState, useRef } from "react";
import { API } from "./api";
import { t, useLanguage } from "./i18n";

export const MAX_MEDICATIONS = 30;
export const MAX_NAME = 60;

// Messages are kept as small descriptors and turned into text at render, so they follow a language change.
// { id: "text", text } carries server text, which api.js has already translated.
const FAIL = { id: "fail" };

function checkName(raw) {
  const name = (raw || "").trim();
  if (!name) return { error: { id: "empty" } };
  if (name.length > MAX_NAME) return { error: { id: "tooLong" } };
  return { name };
}

function messageText(m) {
  switch (m.id) {
    case "empty": return t("Enter a medication name.");
    case "tooLong": return t("Names can be up to {max} characters.", { max: MAX_NAME });
    case "limitAdd": return t("You can keep up to {max} medications. Archive or delete one to add another.", { max: MAX_MEDICATIONS });
    case "limitRestore": return t("You can keep up to {max} medications. Remove or archive one first.", { max: MAX_MEDICATIONS });
    case "text": return m.text;
    default: return t("Couldn't update your medication list. Nothing was changed — try again.");
  }
}

const WRAP = { overflowWrap: "anywhere", minWidth: 0 };

export default function MedicationManager({ token, medications, archivedMedications, onChange, onBack }) {
  useLanguage();
  const list = Array.isArray(medications) ? medications : [];
  const archivedList = Array.isArray(archivedMedications) ? archivedMedications : [];
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null); // { id, name }
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (fn) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setMessage(null);
    try { await fn(); return true; }
    catch (e) { const known = e && ((e.status === 409) || (e.status === 422 && /\bmedications?\b/i.test(e.rawMessage || ""))) && e.message; setMessage(known ? { id: "text", text: known } : FAIL); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const add = async (ev) => {
    if (ev) ev.preventDefault();
    if (list.length >= MAX_MEDICATIONS) { setMessage({ id: "limitAdd" }); return; }
    const c = checkName(newName);
    if (c.error) { setMessage(c.error); return; }
    await run(async () => {
      const created = await API.medications.create(c.name, token);
      setNewName("");
      onChange([...list, created], { type: "add", id: created && created.id });
    });
  };

  const saveRename = async () => {
    const c = checkName(editing.name);
    if (c.error) { setMessage(c.error); return; }
    const id = editing.id;
    const ok = await run(async () => {
      const updated = await API.medications.update(id, { name: c.name }, token);
      onChange(list.map(m => (m.id === id ? { ...m, ...(updated || {}), name: c.name } : m)), { type: "rename", id });
    });
    if (ok) setEditing(null);
  };

  const archive = id => run(async () => {
    await API.medications.update(id, { archived: true }, token);
    onChange(list.filter(m => m.id !== id), { type: "archive", id });
  });

  const restore = item => {
    if (list.length >= MAX_MEDICATIONS) { setMessage({ id: "limitRestore" }); return Promise.resolve(); }
    return run(async () => {
      await API.medications.update(item.id, { archived: false }, token);
      onChange([...list, { ...item, archived: false }], { type: "restore", id: item.id });
    });
  };

  const remove = async id => {
    const ok = await run(async () => {
      await API.medications.remove(id, token);
      onChange(list.filter(m => m.id !== id), { type: "delete", id });
    });
    if (ok) setConfirmId(null);
  };

  const btn = { minHeight: 44, minWidth: 44 };
  return (
    <div>
      <button type="button" className="btn btn-g btn-sm" style={btn} onClick={onBack}>{t("← Back to day")}</button>
      <h3 style={{ margin: "1rem 0 .5rem" }}>{t("My medications")}</h3>
      <form onSubmit={add} style={{ display: "flex", gap: ".5rem", alignItems: "flex-end" }}>
        <div className="f" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="med-new">{t("Add a medication")}</label>
          <input id="med-new" value={newName} style={{ minHeight: 44 }} onChange={e => setNewName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-p" style={btn} disabled={busy}>{t("Add")}</button>
      </form>
      {message && <div role="alert" style={{ margin: ".75rem 0", fontSize: ".85rem", color: "var(--cream)" }}>{messageText(message)}</div>}
      {list.length === 0 && <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>{t("No medications yet.")}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: ".75rem 0" }}>
        {list.map(m => (
          <li key={m.id} style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", padding: ".25rem 0", borderBottom: "1px solid var(--border)" }}>
            {editing && editing.id === m.id ? (
              <form onSubmit={e => { e.preventDefault(); saveRename(); }} style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap", flex: 1 }}>
                <div className="f" style={{ flex: 1, marginBottom: 0, minWidth: 0 }}>
                  <input aria-label={t("New name for {name}", { name: m.name })} value={editing.name} style={{ minHeight: 44 }}
                    onChange={e => setEditing({ id: m.id, name: e.target.value })}
                    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); setMessage(null); } }} />
                </div>
                <button type="submit" className="btn btn-p btn-sm" style={btn} disabled={busy}>{t("Save name")}</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} onClick={() => { setEditing(null); setMessage(null); }}>{t("Cancel")}</button>
              </form>
            ) : confirmId === m.id ? (
              <>
                <span style={{ flex: 1, ...WRAP }}>{t("Delete {name}? Past days will no longer show it.", { name: m.name })}</span>
                <button type="button" className="btn btn-p btn-sm" style={btn} disabled={busy} onClick={() => remove(m.id)}>{t("Yes, delete")}</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} onClick={() => setConfirmId(null)}>{t("Keep")}</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, ...WRAP }} data-i18n-ignore>{m.name}</span>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={t("Rename {name}", { name: m.name })} onClick={() => { setEditing({ id: m.id, name: m.name }); setMessage(null); }}>{t("Rename")}</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={t("Archive {name}", { name: m.name })} disabled={busy} onClick={() => archive(m.id)}>{t("Archive")}</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={t("Delete {name}", { name: m.name })} onClick={() => { setConfirmId(m.id); setMessage(null); }}>{t("Delete")}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {archivedList.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer" }}>{t("Archived ({count})", { count: archivedList.length })}</summary>
          <ul style={{ listStyle: "none", padding: 0, margin: ".25rem 0" }}>
            {archivedList.map(m => (
              <li key={m.id} style={{ display: "flex", alignItems: "center", gap: ".5rem", padding: ".25rem 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, ...WRAP }} data-i18n-ignore>{m.name}</span>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={t("Restore {name}", { name: m.name })} disabled={busy} onClick={() => restore(m)}>{t("Restore")}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
