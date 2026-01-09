'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import dynamic from 'next/dynamic';

// Lazy load the animated splash screen to reduce initial bundle
const SplashScreen = dynamic(
  () => import('@/components/ui/SplashScreen').then(mod => ({ default: mod.SplashScreen })),
  { ssr: false }
);

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

/**
 * Hides the static HTML splash screen that shows before JS loads.
 * This ensures a seamless transition from static -> React splash.
 */
function hideStaticSplash() {
  if (typeof document !== 'undefined') {
    const staticSplash = document.getElementById('static-splash');
    if (staticSplash) {
      staticSplash.classList.add('hidden');
    }
  }
}

/**
 * Optimized SplashProvider that:
 * 1. Uses sessionStorage to skip splash on subsequent navigations
 * 2. Monitors actual app readiness (document load state)
 * 3. Uses a shorter minimum duration (1200ms) for faster perceived load
 * 4. Lazy loads the animated splash component
 */
export function SplashProvider({ children }: SplashProviderProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [hasSeenSplash, setHasSeenSplash] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const [minDurationPassed, setMinDurationPassed] = useState(false);

  // Mark app as ready when document is fully loaded
  useEffect(() => {
    const checkReady = () => {
      if (document.readyState === 'complete') {
        setIsAppReady(true);
      }
    };

    // Check immediately
    checkReady();

    // Also listen for load event
    if (document.readyState !== 'complete') {
      window.addEventListener('load', checkReady, { once: true });
      // Fallback timeout - ensure we eventually become ready
      const fallbackTimer = setTimeout(() => setIsAppReady(true), 3000);
      return () => {
        window.removeEventListener('load', checkReady);
        clearTimeout(fallbackTimer);
      };
    }
  }, []);

  // Minimum splash duration for branding (reduced from 2800ms to 1200ms)
  useEffect(() => {
    const timer = setTimeout(() => setMinDurationPassed(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  // Check session storage and handle splash visibility
  useEffect(() => {
    const seen = sessionStorage.getItem('splash_seen');
    if (seen) {
      setShowSplash(false);
      setHasSeenSplash(true);
      hideStaticSplash();
    } else {
      hideStaticSplash();
    }
  }, []);

  // Auto-hide splash when both conditions are met
  useEffect(() => {
    if (isAppReady && minDurationPassed && showSplash && !hasSeenSplash) {
      // Small delay for smooth transition
      const hideTimer = setTimeout(() => {
        setShowSplash(false);
        setHasSeenSplash(true);
        sessionStorage.setItem('splash_seen', 'true');
      }, 300);
      return () => clearTimeout(hideTimer);
    }
  }, [isAppReady, minDurationPassed, showSplash, hasSeenSplash]);

  const hideSplash = useCallback(() => {
    setShowSplash(false);
    setHasSeenSplash(true);
    sessionStorage.setItem('splash_seen', 'true');
  }, []);

  const shouldShowSplash = showSplash && !hasSeenSplash;

  return (
    <SplashContext.Provider value={{ showSplash: shouldShowSplash, hideSplash, isAppReady }}>
      {shouldShowSplash && (
        <SplashScreen
          onComplete={hideSplash}
          duration={1500}
        />
      )}
      <div
        className={shouldShowSplash ? 'opacity-0' : 'opacity-100 transition-opacity duration-300'}
        style={{ visibility: shouldShowSplash ? 'hidden' : 'visible' }}
      >
        {children}
      </div>
    </SplashContext.Provider>
  );
}

