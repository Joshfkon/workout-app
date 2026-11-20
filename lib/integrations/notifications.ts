/**
 * Local Notifications & Haptics Integration
 *
 * Provides native local-notification scheduling and haptic feedback when
 * running in a Capacitor app (iOS/Android), with safe no-op fallbacks for
 * web-only environments. Follows the same defensive-require pattern as
 * `capacitor-stub.ts` so the web build compiles whether or not the
 * `@capacitor/local-notifications` and `@capacitor/haptics` packages are
 * installed.
 */

import { isNativePlatform } from './capacitor-stub';

// Optional Capacitor plugin imports - use try-catch to allow web-only builds
let LocalNotifications: any;
let Haptics: any;
let ImpactStyle: any;
let NotificationType: any;

try {
  LocalNotifications = require('@capacitor/local-notifications').LocalNotifications;
} catch (e) {
  // Plugin not installed - provide a no-op fallback
  LocalNotifications = {
    schedule: async () => {},
    cancel: async () => {},
    requestPermissions: async () => ({ display: 'denied' }),
    checkPermissions: async () => ({ display: 'denied' }),
    removeAllDeliveredNotifications: async () => {},
  };
}

try {
  const haptics = require('@capacitor/haptics');
  Haptics = haptics.Haptics;
  ImpactStyle = haptics.ImpactStyle;
  NotificationType = haptics.NotificationType;
} catch (e) {
  // Plugin not installed - provide no-op fallbacks
  Haptics = {
    impact: async () => {},
    notification: async () => {},
    vibrate: async () => {},
  };
  ImpactStyle = { Heavy: 'HEAVY', Medium: 'MEDIUM', Light: 'LIGHT' };
  NotificationType = { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' };
}

// Fixed notification id for the rest timer. Reusing a single id means a newly
// scheduled rest-complete notification automatically replaces any previous one.
export const REST_TIMER_NOTIFICATION_ID = 1842;

// Fixed id for the daily "log blood pressure" reminder. Reusing one id means
// re-scheduling (e.g. after the user changes the time) replaces the old one.
export const BLOOD_PRESSURE_REMINDER_ID = 1843;

let permissionRequested = false;

/**
 * Ensure local-notification permission has been requested (native only).
 * Safe to call repeatedly; the request is only attempted once per session.
 */
async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    const current = await LocalNotifications.checkPermissions();
    if (current?.display === 'granted') return true;

    if (!permissionRequested) {
      permissionRequested = true;
      const result = await LocalNotifications.requestPermissions();
      return result?.display === 'granted';
    }

    return false;
  } catch (error) {
    console.warn('[Notifications] Permission check failed:', error);
    return false;
  }
}

/**
 * Schedule a local notification to fire at the given absolute time (ms epoch).
 * No-op on web. The notification fires even if the app is backgrounded or the
 * screen is locked, which is the whole point: JS timers and Web Audio are
 * suspended in that state.
 */
export async function scheduleRestCompleteNotification(fireAtMs: number): Promise<void> {
  if (!isNativePlatform()) return;

  // Don't schedule notifications in the past.
  if (fireAtMs <= Date.now()) return;

  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_TIMER_NOTIFICATION_ID,
          title: 'Rest Complete',
          body: "Time's up - back to your set!",
          schedule: { at: new Date(fireAtMs), allowWhileIdle: true },
          sound: 'default',
        },
      ],
    });
  } catch (error) {
    console.warn('[Notifications] Failed to schedule rest notification:', error);
  }
}

/**
 * Cancel any pending rest-complete notification. No-op on web.
 * Call this when the timer is skipped, reset, dismissed, or completes while
 * the app is in the foreground (so the user doesn't get a duplicate alert).
 */
export async function cancelRestCompleteNotification(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    await LocalNotifications.cancel({
      notifications: [{ id: REST_TIMER_NOTIFICATION_ID }],
    });
  } catch (error) {
    console.warn('[Notifications] Failed to cancel rest notification:', error);
  }
}

/**
 * Schedule (or reschedule) the daily "log blood pressure" reminder at the
 * given local time. Repeats every day until cancelled. No-op on web — the
 * feature is opt-in and only meaningful in the native app. Returns true when a
 * reminder was actually scheduled (native + permission granted).
 */
export async function scheduleBloodPressureReminder(
  hour: number,
  minute: number
): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return false;

    // Replace any existing reminder first (id reuse also does this, but an
    // explicit cancel keeps behaviour predictable across plugin versions).
    await LocalNotifications.cancel({
      notifications: [{ id: BLOOD_PRESSURE_REMINDER_ID }],
    });

    await LocalNotifications.schedule({
      notifications: [
        {
          id: BLOOD_PRESSURE_REMINDER_ID,
          title: 'Log blood pressure',
          body: 'Take a moment to record today’s reading.',
          schedule: {
            on: { hour, minute },
            allowWhileIdle: true,
            repeats: true,
          },
          sound: 'default',
        },
      ],
    });
    return true;
  } catch (error) {
    console.warn('[Notifications] Failed to schedule BP reminder:', error);
    return false;
  }
}

/** Cancel the daily blood-pressure reminder. No-op on web. */
export async function cancelBloodPressureReminder(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    await LocalNotifications.cancel({
      notifications: [{ id: BLOOD_PRESSURE_REMINDER_ID }],
    });
  } catch (error) {
    console.warn('[Notifications] Failed to cancel BP reminder:', error);
  }
}

/**
 * Replace every scheduled meal reminder with `planned` (one-shot local
 * notifications; see services/mealReminders). Native only. Pass [] to clear.
 * Returns false when permission is missing or scheduling failed.
 */
export async function scheduleMealReminders(
  planned: Array<{ id: number; fireAt: Date; title: string; body: string; url: string }>,
  options: { requestPermission?: boolean } = {}
): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const { MEAL_REMINDER_ID_BASE, MEAL_REMINDER_ID_COUNT } = await import('@/services/mealReminders');
    await LocalNotifications.cancel({
      notifications: Array.from({ length: MEAL_REMINDER_ID_COUNT }, (_, i) => ({
        id: MEAL_REMINDER_ID_BASE + i,
      })),
    });
    if (planned.length === 0) return true;

    // Background re-syncs never pop the permission sheet; only the explicit
    // "turn on" tap asks (requestPermission).
    const granted = options.requestPermission
      ? await ensureNotificationPermission()
      : (await LocalNotifications.checkPermissions())?.display === 'granted';
    if (!granted) return false;

    await LocalNotifications.schedule({
      notifications: planned.map((reminder) => ({
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        schedule: { at: reminder.fireAt, allowWhileIdle: true },
        sound: 'default',
        extra: { url: reminder.url },
      })),
    });
    return true;
  } catch (error) {
    console.warn('[Notifications] Failed to schedule meal reminders:', error);
    return false;
  }
}

/**
 * Call `onOpen(url)` when the user taps a notification that carries an
 * in-app route (meal reminders). Returns an unsubscribe. No-op on web.
 */
export function onNotificationTap(onOpen: (url: string) => void): () => void {
  if (!isNativePlatform() || typeof LocalNotifications.addListener !== 'function') {
    return () => {};
  }
  let handle: { remove: () => void } | null = null;
  let removed = false;
  Promise.resolve(
    LocalNotifications.addListener('localNotificationActionPerformed', (event: any) => {
      const url = event?.notification?.extra?.url;
      if (typeof url === 'string' && url.startsWith('/')) onOpen(url);
    })
  )
    .then((h: { remove: () => void }) => {
      if (removed) h?.remove?.();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    removed = true;
    handle?.remove?.();
  };
}

/**
 * Trigger vibration/haptic feedback for the rest-complete alarm.
 *
 * On native we use the Capacitor Haptics plugin (a notification-style pattern
 * plus a couple of heavy impacts). On web we fall back to navigator.vibrate.
 * navigator.vibrate is a no-op on iOS WKWebView, which is exactly why the
 * native path uses Haptics instead.
 */
export async function restCompleteHaptic(): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Haptics.notification({ type: NotificationType.Success });
      await Haptics.impact({ style: ImpactStyle.Heavy });
      await Haptics.impact({ style: ImpactStyle.Heavy });
      return;
    } catch (error) {
      console.warn('[Notifications] Haptics failed:', error);
      // fall through to web vibrate as a last resort
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([200, 100, 200, 100, 400]);
  }
}

/**
 * A single subtle haptic "tick" — e.g. when a set is logged. Light impact on
 * native; a short single vibration on web (no-op on iOS WKWebView). Best-effort.
 */
export async function lightHaptic(): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    } catch {
      // fall through to web vibrate
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(15);
  }
}

/**
 * A single success-style haptic notification — e.g. when finishing a workout.
 * Native only (uses NotificationType.Success); no-op on web/PWA. Best-effort.
 */
export async function successHaptic(): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (error) {
      console.warn('[Notifications] Success haptic failed:', error);
    }
  }
}
