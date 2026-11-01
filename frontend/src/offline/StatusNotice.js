import React from "react";
import { t, tn, useLanguage } from "../i18n";
import { useOffline } from "./useOffline";

// One dismissible line for the most important thing the user should know about the offline queue.
// Priority: dropped changes, a lost queue, a cache write failure, a paused sync. Dismissing acknowledges only the one
// that was shown (the next one, if any, then appears). The status store keeps a dismissed condition from coming back
// until it has been seen to clear. The live region is always mounted (empty) so the text is announced when it arrives;
// the visible row and its button sit outside it.
export default function StatusNotice() {
  useLanguage();
  const { status, acknowledge } = useOffline();
  let kind = null;
  let text = "";
  // i18n-note: "Syncing is paused. We'll keep trying." is new wording for the native reviewer
  if (status.dropped.length) { kind = "dropped"; text = tn(status.dropped.length, "{count} change couldn't be saved.", "{count} changes couldn't be saved."); }
  else if (status.queueLost) { kind = "queueLost"; text = t("Offline data couldn't be read, so changes waiting to sync were lost."); }
  else if (status.lastError) { kind = "lastError"; text = t("Couldn't save offline data on this phone."); }
  else if (status.stuck) { kind = "stuck"; text = t("Syncing is paused. We'll keep trying."); }
  return (
    <>
      <span className="vh" role="status" aria-live="polite">{text}</span>
      {kind && (
        <div className="today-note">
          <span className="today-note-t" aria-hidden="true">{text}</span>
          <button type="button" className="today-note-x" aria-label={t("Dismiss notice")} onClick={() => acknowledge(kind)}>×</button>
        </div>
      )}
    </>
  );
}
