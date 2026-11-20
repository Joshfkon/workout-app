'use client';

import { useState, type ReactNode } from 'react';
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
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const [transition, setTransition] = useState<NavTransition>(() => consumeNavTransition(pathname));

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
