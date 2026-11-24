'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/** Pages where logging something can change what a reminder should say. */
const MEAL_PAGES = ['/dashboard/nutrition'];
const TRACKING_PAGES = [
  '/dashboard/workout',
  '/dashboard/body-composition',
  '/dashboard/progress-photos',
  '/dashboard/analytics',
];

const onAny = (pathname: string, prefixes: string[]) => prefixes.some((p) => pathname.startsWith(p));

/**
 * Native app only: re-plan the local reminders (meals, body tracking,
 * training days) on launch, whenever the app comes back to the foreground,
 * and when you leave a page where you probably just logged something.
 * Tapping a reminder opens the page it points to.
 */
export function useReminderSync(): void {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const previous = useRef('');

  const resyncMeals = () => {
    import('@/lib/nutrition/mealReminderSync')
      .then(({ syncMealReminders }) => syncMealReminders())
      .catch(() => {});
  };
  const resyncTracking = () => {
    import('@/lib/reminders/trackingReminderSync')
      .then(({ syncTrackingReminders }) => syncTrackingReminders())
      .catch(() => {});
  };
  const resyncAll = () => {
    resyncMeals();
    resyncTracking();
  };

  useEffect(() => {
    if (!isNativePlatform()) return;
    resyncAll();
    let removeAppListener: (() => void) | null = null;
    let disposed = false;
    import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => isActive && resyncAll()))
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeAppListener = () => void handle.remove();
      })
      .catch(() => {});
    let removeTap: () => void = () => {};
    import('@/lib/integrations/notifications')
      .then(({ onNotificationTap }) => {
        if (!disposed) removeTap = onNotificationTap((url) => router.push(url));
      })
      .catch(() => {});
    return () => {
      disposed = true;
      removeAppListener?.();
      removeTap();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isNativePlatform()) return;
    const prev = previous.current;
    if (onAny(prev, MEAL_PAGES) && !onAny(pathname, MEAL_PAGES)) resyncMeals();
    // Any move away from a tracking page (including between two of them).
    if (onAny(prev, TRACKING_PAGES) && prev !== pathname) resyncTracking();
    previous.current = pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
