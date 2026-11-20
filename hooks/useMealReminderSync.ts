'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/**
 * Native app only: re-plan meal reminders on launch, whenever the app comes
 * back to the foreground, and when you leave the Eat page (you probably just
 * logged something). Tapping a reminder opens the page it points to.
 */
export function useMealReminderSync(): void {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const wasOnEat = useRef(false);

  const resync = () => {
    import('@/lib/nutrition/mealReminderSync')
      .then(({ syncMealReminders }) => syncMealReminders())
      .catch(() => {});
  };

  useEffect(() => {
    if (!isNativePlatform()) return;
    resync();
    let removeAppListener: (() => void) | null = null;
    let disposed = false;
    import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => isActive && resync()))
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
    const onEat = pathname.startsWith('/dashboard/nutrition');
    if (wasOnEat.current && !onEat) resync();
    wasOnEat.current = onEat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
