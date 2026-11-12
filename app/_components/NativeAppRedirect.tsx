'use client';

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

// useLayoutEffect warns during SSR; it only needs to run in the browser.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Keeps web-only marketing surfaces (the landing page, public pricing) out of
 * the native app. Inside the Capacitor shell the wrapped page is never shown:
 * the user is sent to `to` instead. In a browser this renders `children`
 * unchanged, so web behaviour and SSR output are untouched.
 *
 * Why: the iOS app loads the hosted site, so a signed-out user's first screen
 * was the marketing page with Stripe prices and upgrade copy (App Store
 * guidelines 3.1.1 / 4.2).
 *
 * Two layers, so there is no flash of the marketing page:
 *  1. An inline script that runs as the HTML is parsed (before hydration and
 *     before the content below it paints) on a full page load. Capacitor
 *     injects `window.Capacitor` at document start, so it is already there.
 *  2. A layout effect for client-side navigations (e.g. the logo link on
 *     /login), where inline scripts do not run. It hides the children before
 *     the browser paints and replaces the route.
 */
export function NativeAppRedirect({ to, children }: { to: string; children: ReactNode }) {
  const router = useRouter();
  const [isNative, setIsNative] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (isNativePlatform()) {
      setIsNative(true);
      router.replace(to);
    }
  }, [router, to]);

  if (isNative) {
    return <div className="min-h-screen bg-surface-950" data-testid="native-redirect" />;
  }

  const inlineRedirect = `(function(){try{var c=window.Capacitor;if(c&&c.isNativePlatform&&c.isNativePlatform()){document.documentElement.style.visibility='hidden';window.location.replace(${JSON.stringify(to)});}}catch(e){}})();`;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: inlineRedirect }} />
      {children}
    </>
  );
}
