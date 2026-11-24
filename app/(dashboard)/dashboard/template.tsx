'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { consumeNavTransition, type NavTransition } from '@/lib/navigation/navTransition';

/**
 * Remounts on every dashboard navigation (that's what a Next.js template
 * does), so each screen can enter the way a native app's would: pushed
 * screens slide in from the right; tab switches, back and the first screen
 * appear instantly. See lib/navigation/navTransition.ts.
 *
 * The slide animates `left` on a relatively-positioned wrapper rather than
 * `transform`: a transform would become the containing block for the
 * screen's `position: fixed` chrome (rest timer, sticky macro bar) and make it
 * jump during the animation. The wrapper is always rendered — swapping it out
 * when the animation ends would remount the screen.
 */
/** False until the first client render after a full page load has hydrated. */
let hydrated = false;

export default function DashboardTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  // A full page load has nothing to slide in from, and the server always
  // renders 'none': using a pending 'push' during hydration made the
  // attribute differ between server and client (React hydration error on
  // the builder). Later SPA navigations mount client-only and animate.
  const [transition, setTransition] = useState<NavTransition>(() => {
    const next = consumeNavTransition(pathname);
    return hydrated ? next : 'none';
  });
  useEffect(() => {
    hydrated = true;
  }, []);

  return (
    <div
      data-nav-transition={transition}
      className={transition === 'push' ? 'relative motion-safe:animate-push-in' : undefined}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setTransition('none');
      }}
    >
      {children}
    </div>
  );
}
