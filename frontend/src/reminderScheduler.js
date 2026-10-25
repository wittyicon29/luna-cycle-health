import { isNative } from './platform';
import { planReminders } from './reminderPlanner';
import { anyEnabled, clearPrefs } from './reminderPrefs';
import { getAppearance, isDiscreet } from './launcherAppearance';
import { t, tn } from './i18n';

const CHANNEL_NEUTRAL = 'reminders';
const CHANNEL_DETAILS = 'reminders_details';
const CHANNELS = {
  [CHANNEL_NEUTRAL]: { id: CHANNEL_NEUTRAL, name: 'Reminders', description: 'Private check-in reminders', importance: 3, visibility: 0 },
  // SECRET (-1): hidden entirely on the lock screen, so explicit wording never shows while locked.
  [CHANNEL_DETAILS]: { id: CHANNEL_DETAILS, name: 'Reminders with details', description: 'Check-in reminders that name the reminder type', importance: 3, visibility: -1 },
};

// The plugin object is a Capacitor Proxy whose `then` throws on native: never return it from an
// async function; resolve with a plain wrapper instead (same pitfall as tokenStore.js).
async function plugin() {
  const { LocalNotifications: ln } = await import('@capacitor/local-notifications');
  return {
    checkPermissions: () => ln.checkPermissions(),
    requestPermissions: () => ln.requestPermissions(),
    createChannel: c => ln.createChannel(c),
    getPending: () => ln.getPending(),
    cancel: c => ln.cancel(c),
    removeAllDeliveredNotifications: () => ln.removeAllDeliveredNotifications(),
    schedule: s => ln.schedule(s),
  };
}

// Text is translated in the language that is current when the notifications are scheduled; changing the
// language re-plans them (useReminders). Notification channel names stay English.
export function reminderText(kind, prefs, appearance = 'default') {
  // In a non-default appearance the title is generic too, so it never names the real app.
  const title = isDiscreet(appearance) ? t('Reminder') : 'Luna';
  if (!prefs || prefs.explicit !== true) return { title, body: t('Time for your check-in.') };
  if (kind === 'periodExpected') {
    const n = prefs.periodExpected.daysBefore;
    return { title, body: tn(n, 'Your period is expected in {count} day.', 'Your period is expected in {count} days.') };
  }
  if (kind === 'lateCheckIn') return { title, body: t('Your period may be a little late. Tap to log or check in.') };
  return { title, body: t('Have you logged today?') };
}

export async function getReminderPermission() {
  if (!isNative()) return 'unavailable';
  try {
    const { display } = await (await plugin()).checkPermissions();
    return display === 'granted' || display === 'denied' ? display : 'prompt';
  } catch (e) {
    return 'unavailable';
  }
}

export async function requestReminderPermission() {
  if (!isNative()) return 'denied';
  try {
    const { display } = await (await plugin()).requestPermissions();
    return display === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    return 'denied';
  }
}

async function cancelPending(ln) {
  const { notifications } = await ln.getPending();
  if (notifications && notifications.length) await ln.cancel({ notifications: notifications.map(n => ({ id: n.id })) });
}

// Rebuilds, cancels and teardowns run one at a time so a cancel/schedule pair is never interleaved
// and a rebuild in flight can never re-arm reminders after a teardown. Tasks never reject.
let queue = Promise.resolve();

function enqueue(task) {
  const next = queue.then(task, task);
  queue = next.then(() => {}, () => {});
  return next;
}

async function doCancelAll() {
  if (!isNative()) return;
  try {
    const ln = await plugin();
    await cancelPending(ln);
    await ln.removeAllDeliveredNotifications();
  } catch (e) { /* nothing more to do */ }
}

export function cancelAllReminders() {
  return enqueue(doCancelAll);
}

// Bumped synchronously by teardownReminders(); rebuilds queued before a teardown skip themselves.
let generation = 0;

export function teardownReminders() {
  generation += 1;
  lastArgs = null;
  clearPrefs();
  return enqueue(doCancelAll);
}

// Arguments of the last successful rebuild, so the notification wording can be redone for a
// different appearance without the caller recomputing the plan. Cleared on teardown.
let lastArgs = null;

export function rebuildReminders(args = {}) {
  const gen = generation;
  return enqueue(async () => {
    if (gen !== generation) return { skipped: 'cancelled' };
    const result = await doRebuild(args);
    if (gen === generation && (result.scheduled !== undefined || result.skipped === 'disabled' || result.skipped === 'no-permission')) lastArgs = args || {};
    return result;
  });
}

// Re-runs the last plan with the given appearance (used right before the launcher alias switches).
// Never throws; does nothing when no rebuild has run yet.
export function rebuildRemindersForAppearance(appearance) {
  const gen = generation;
  return enqueue(async () => {
    if (gen !== generation || !lastArgs) return { skipped: 'nothing-remembered' };
    try {
      return await doRebuild({ ...lastArgs, now: new Date(), appearance });
    } catch (e) {
      return { skipped: 'error' };
    }
  });
}

async function doRebuild(args) {
  if (!isNative()) return { skipped: 'web' };
  try {
    const { prefs, prediction = null, lastPeriodStart = null, lastLoggedOn = null, now = new Date(), appearance: override } = args || {};
    const ln = await plugin();
    await cancelPending(ln);
    if (!anyEnabled(prefs)) return { skipped: 'disabled' };
    const { display } = await ln.checkPermissions();
    if (display !== 'granted') return { skipped: 'no-permission' };
    const channelId = prefs.explicit === true ? CHANNEL_DETAILS : CHANNEL_NEUTRAL;
    await ln.createChannel(CHANNELS[channelId]);
    let appearance = override;
    if (typeof override !== 'string') {
      appearance = 'default';
      try { appearance = await getAppearance(); } catch (e) { /* default */ }
    }
    const plan = planReminders({ prefs, prediction, lastPeriodStart, lastLoggedOn, now });
    if (plan.length === 0) return { scheduled: 0 };
    await ln.schedule({
      notifications: plan.map(item => ({
        id: item.id,
        ...reminderText(item.kind, prefs, appearance),
        channelId,
        smallIcon: isDiscreet(appearance) ? 'ic_stat_neutral' : 'ic_stat_luna',
        schedule: { at: item.at, allowWhileIdle: true },
      })),
    });
    return { scheduled: plan.length };
  } catch (e) {
    return { skipped: 'error' };
  }
}
