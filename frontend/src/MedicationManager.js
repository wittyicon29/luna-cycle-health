import { useState, useRef } from "react";
import { API } from "./api";

export const MAX_MEDICATIONS = 30;
export const MAX_NAME = 60;
const FAIL = "Couldn't update your medication list. Nothing was changed — try again.";

function checkName(raw) {
  const name = (raw || "").trim();
  if (!name) return { error: "Enter a medication name." };
  if (name.length > MAX_NAME) return { error: `Names can be up to ${MAX_NAME} characters.` };
  return { name };
}

export default function MedicationManager({ token, medications, onChange, onBack }) {
  const list = Array.isArray(medications) ? medications : [];
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null); // { id, name }
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (fn) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setMessage("");
    try { await fn(); return true; }
    catch (e) { setMessage((e && e.status === 409 && e.message) || FAIL); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const add = async (ev) => {
    if (ev) ev.preventDefault();
    if (list.length >= MAX_MEDICATIONS) { setMessage(`You can keep up to ${MAX_MEDICATIONS} medications. Archive or delete one to add another.`); return; }
    const c = checkName(newName);
    if (c.error) { setMessage(c.error); return; }
    await run(async () => {
      const created = await API.medications.create(c.name, token);
      setNewName("");
      onChange([...list, created]);
    });
  };

  const saveRename = async () => {
    const c = checkName(editing.name);
    if (c.error) { setMessage(c.error); return; }
    const id = editing.id;
    const ok = await run(async () => {
      const updated = await API.medications.update(id, { name: c.name }, token);
      onChange(list.map(m => (m.id === id ? { ...m, ...(updated || {}), name: c.name } : m)));
    });
    if (ok) setEditing(null);
  };

  const archive = id => run(async () => {
    await API.medications.update(id, { archived: true }, token);
    onChange(list.filter(m => m.id !== id));
  });

  const remove = async id => {
    const ok = await run(async () => {
      await API.medications.remove(id, token);
      onChange(list.filter(m => m.id !== id));
    });
    if (ok) setConfirmId(null);
  };

  const btn = { minHeight: 44, minWidth: 44 };
  return (
    <div>
      <button type="button" className="btn btn-g btn-sm" style={btn} onClick={onBack}>← Back to day</button>
      <h3 style={{ margin: "1rem 0 .5rem" }}>My medications</h3>
      <form onSubmit={add} style={{ display: "flex", gap: ".5rem", alignItems: "flex-end" }}>
        <div className="f" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="med-new">Add a medication</label>
          <input id="med-new" value={newName} style={{ minHeight: 44 }} onChange={e => setNewName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-p" style={btn} disabled={busy}>Add</button>
      </form>
      {message && <div role="alert" style={{ margin: ".75rem 0", fontSize: ".85rem", color: "var(--cream)" }}>{message}</div>}
      {list.length === 0 && <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>No medications yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: ".75rem 0" }}>
        {list.map(m => (
          <li key={m.id} style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", padding: ".25rem 0", borderBottom: "1px solid var(--border)" }}>
            {editing && editing.id === m.id ? (
              <>
                <input aria-label={`New name for ${m.name}`} value={editing.name} style={{ minHeight: 44, flex: 1 }}
                  onChange={e => setEditing({ id: m.id, name: e.target.value })} />
                <button type="button" className="btn btn-p btn-sm" style={btn} disabled={busy} onClick={saveRename}>Save name</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} onClick={() => { setEditing(null); setMessage(""); }}>Cancel</button>
              </>
            ) : confirmId === m.id ? (
              <>
                <span style={{ flex: 1 }}>Delete {m.name}? Past days will no longer show it.</span>
                <button type="button" className="btn btn-p btn-sm" style={btn} disabled={busy} onClick={() => remove(m.id)}>Yes, delete</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} onClick={() => setConfirmId(null)}>Keep</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1 }}>{m.name}</span>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={`Rename ${m.name}`} onClick={() => { setEditing({ id: m.id, name: m.name }); setMessage(""); }}>Rename</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={`Archive ${m.name}`} disabled={busy} onClick={() => archive(m.id)}>Archive</button>
                <button type="button" className="btn btn-g btn-sm" style={btn} aria-label={`Delete ${m.name}`} onClick={() => { setConfirmId(m.id); setMessage(""); }}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
