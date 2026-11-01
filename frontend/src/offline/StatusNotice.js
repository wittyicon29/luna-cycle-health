import React from "react";
import { t, tn, useLanguage } from "../i18n";
import { useOffline } from "./useOffline";

// One dismissible line for the most important thing the user should know about the offline queue.
// Priority: dropped changes, a lost queue, a cache write failure, a paused sync. Dismissing acknowledges all of them,
// and the status store keeps the same condition from coming back until it has been seen to clear.
export default function StatusNotice() {
  useLanguage();
  const { status, acknowledge } = useOffline();
  let text = null;
  if (status.dropped.length) text = tn(status.dropped.length, "{count} change couldn't be saved.", "{count} changes couldn't be saved.");
  else if (status.queueLost) text = t("Offline data couldn't be read, so changes waiting to sync were lost.");
  else if (status.lastError) text = t("Couldn't save offline data on this phone.");
  else if (status.stuck) text = t("Syncing is paused. We'll keep trying.");
  if (!text) return null;
  return (
    <div className="today-note" role="status">
      {/* i18n-note: "Syncing is paused. We'll keep trying." is new wording for the native reviewer */}
      <span className="today-note-t">{text}</span>
      <button type="button" className="today-note-x" aria-label={t("Dismiss")} onClick={acknowledge}>×</button>
    </div>
  );
}
