'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { bootMark, hasBootMark } from '@/lib/perf/bootTrace';

interface SplashContextType {
  showSplash: boolean;
  hideSplash: () => void;
  isAppReady: boolean;
}

const SplashContext = createContext<SplashContextType>({
  showSplash: true,
  hideSplash: () => {},
  isAppReady: false,
});

export function useSplash() {
  return useContext(SplashContext);
}

interface SplashProviderProps {
  children: ReactNode;
}

/** Persistent (not per-session) flag: this browser has booted the app before. */
const SPLASH_SEEN_KEY = 'ht_splash_seen';

/**
 * Hides the static HTML splash screen that shows before JS loads.
 */
function hideStaticSplash() {
  if (typeof document !== 'undefined') {
    const staticSplash = document.getElementById('static-splash');
    if (staticSplash) {
      staticSplash.style.display = 'none';
    }
  }
}

function hasSeenSplashBefore(): boolean {
  try {
    return Boolean(localStorage.getItem(SPLASH_SEEN_KEY));
  } catch {
    return false;
  }
}

/**
 * Native detection without importing any Capacitor package: the native
 * runtime injects the `Capacitor` bridge global before page scripts run, so
 * this is synchronous and costs the web bundle nothing.
 */
function isNativeCapacitor(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * ONE loading surface per boot (cold-start perf work — the app used to show
 * the native Capacitor splash, then replay the branded web splash with a
 * restarting progress bar, then a half-empty shell):
 *
 * - Native app: the NATIVE splash is the only surface. `launchAutoHide` is
 *   off in capacitor.config.ts; we hide it from here the moment the Log page
 *   paints real content (`boot:home-paint`, cached-first so ~immediately
 *   after mount for returning users), with a short fallback so a slow fetch
 *   can't hold the app hostage. The web splashes never show.
 *
 * - Web, returning user: no branded splash at all. The static HTML splash
 *   covers the pre-JS gap, then content paints straight from the persisted
 *   cache. The splash-seen flag is localStorage, not sessionStorage — a cold
 *   start IS the returning-user case that must not replay the animation.
 *
 * - Web, first-ever visit: the branded React splash plays once (~800ms) as
 *   the cache-less first fetch runs behind it.
 */
export function SplashProvider({ children }: SplashProviderProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [hasSeenSplash, setHasSeenSplash] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const [isNative, setIsNative] = useState(false);

  // Boot timeline: React has mounted (this provider wraps the whole app).
  useEffect(() => {
    bootMark('app-mount');
  }, []);

  // Mark app as ready when the document is at least interactive
  useEffect(() => {
    const checkReady = () => {
      if (document.readyState !== 'loading') {
        setIsAppReady(true);
      }
    };

    // Check immediately
    checkReady();

    // Also listen for load event
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', checkReady, { once: true });
      // Fallback timeout - ensure we eventually become ready
      const fallbackTimer = setTimeout(() => setIsAppReady(true), 800);
      return () => {
        window.removeEventListener('DOMContentLoaded', checkReady);
        clearTimeout(fallbackTimer);
      };
    }
  }, []);

  // Decide the boot surface. In the native app the native splash is still
  // covering the webview at this point; on the web the static splash is.
  useEffect(() => {
    const native = isNativeCapacitor();
    setIsNative(native);

    if (native || hasSeenSplashBefore()) {
      // No web splash: reveal the app (native splash still covers it in the
      // native case until home-paint below).
      setShowSplash(false);
      setHasSeenSplash(true);
      hideStaticSplash();
    }
    // First-ever web visit: keep showSplash=true; the React splash's onReady
    // hides the static splash underneath it.
  }, []);

  // Native: hide the native splash when the landing surface has painted real
  // content, with a fallback so a dead network never strands the user on the
  // splash. This is the ONLY hide call — launchAutoHide is off.
  useEffect(() => {
    if (!isNative) return;

    let done = false;
    let fallback: ReturnType<typeof setTimeout>;
    const hideNative = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      window.removeEventListener('bootmark', onMark);
      import('@/lib/integrations/capacitor-stub')
        .then((m) => m.hideSplashScreen())
        .catch(() => {});
    };
    const onMark = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'boot:home-paint') hideNative();
    };

    if (hasBootMark('home-paint')) {
      hideNative();
    } else {
      window.addEventListener('bootmark', onMark);
      // Returning users paint from cache well inside this; the fallback only
      // fires on a cache-less first boot or a dead-slow network, where the
      // app shell + skeleton is still better than an indefinite splash.
      fallback = setTimeout(hideNative, 2500);
    }
    return () => {
      clearTimeout(fallback);
      window.removeEventListener('bootmark', onMark);
    };
  }, [isNative]);

  // Callback for when React splash is mounted and painted
  const handleSplashReady = useCallback(() => {
    hideStaticSplash();
  }, []);

  const hideSplash = useCallback(() => {
    setShowSplash(false);
    setHasSeenSplash(true);
    try {
      localStorage.setItem(SPLASH_SEEN_KEY, 'true');
    } catch {
      /* storage unavailable — splash just replays next boot */
    }
  }, []);

  const shouldShowSplash = showSplash && !hasSeenSplash;

  return (
    <SplashContext.Provider value={{ showSplash: shouldShowSplash, hideSplash, isAppReady }}>
      {shouldShowSplash && (
        <SplashScreen
          onComplete={hideSplash}
          onReady={handleSplashReady}
          duration={800}
        />
      )}
      <div className="transition-opacity duration-300 opacity-100">
        {children}
      </div>
    </SplashContext.Provider>
  );
}
