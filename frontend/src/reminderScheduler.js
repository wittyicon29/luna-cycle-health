import { isNative } from './platform';
import { planReminders } from './reminderPlanner';
import { anyEnabled, clearPrefs } from './reminderPrefs';

const CHANNEL_NEUTRAL = 'reminders';
const CHANNEL_DETAILS = 'reminders_details';
const CHANNELS = {
  [CHANNEL_NEUTRAL]: { id: CHANNEL_NEUTRAL, name: 'Reminders', description: 'Private check-in reminders', importance: 3, visibility: 0 },
  // SECRET (-1): hidden entirely on the lock screen, so explicit wording never shows while locked.
  [CHANNEL_DETAILS]: { id: CHANNEL_DETAILS, name: 'Reminders with details', description: 'Check-in reminders that name the reminder type', importance: 3, visibility: -1 },
};
const NEUTRAL = { title: 'Luna', body: 'Time for your check-in.' };

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

export function reminderText(kind, prefs) {
  if (!prefs || prefs.explicit !== true) return { ...NEUTRAL };
  if (kind === 'periodExpected') {
    const n = prefs.periodExpected.daysBefore;
    return { title: 'Luna', body: `Your period is expected in ${n} day${n === 1 ? '' : 's'}.` };
  }
  if (kind === 'lateCheckIn') return { title: 'Luna', body: 'Your period may be a little late. Tap to log or check in.' };
  return { title: 'Luna', body: 'Have you logged today?' };
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
  clearPrefs();
  return enqueue(doCancelAll);
}

export function rebuildReminders(args = {}) {
  const gen = generation;
  return enqueue(() => (gen === generation ? doRebuild(args) : { skipped: 'cancelled' }));
}

async function doRebuild(args) {
  if (!isNative()) return { skipped: 'web' };
  try {
    const { prefs, prediction = null, lastPeriodStart = null, lastLoggedOn = null, now = new Date() } = args || {};
    const ln = await plugin();
    await cancelPending(ln);
    if (!anyEnabled(prefs)) return { skipped: 'disabled' };
    const { display } = await ln.checkPermissions();
    if (display !== 'granted') return { skipped: 'no-permission' };
    const channelId = prefs.explicit === true ? CHANNEL_DETAILS : CHANNEL_NEUTRAL;
    await ln.createChannel(CHANNELS[channelId]);
    const plan = planReminders({ prefs, prediction, lastPeriodStart, lastLoggedOn, now });
    if (plan.length === 0) return { scheduled: 0 };
    await ln.schedule({
      notifications: plan.map(item => ({
        id: item.id,
        ...reminderText(item.kind, prefs),
        channelId,
        schedule: { at: item.at, allowWhileIdle: true },
      })),
    });
    return { scheduled: plan.length };
  } catch (e) {
    return { skipped: 'error' };
  }
}
