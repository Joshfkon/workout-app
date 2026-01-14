'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { SplashScreen } from '@/components/ui/SplashScreen';

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
 * Uses a fade-out transition for seamless handoff to React splash.
 */
function hideStaticSplash() {
  if (typeof document !== 'undefined') {
    const staticSplash = document.getElementById('static-splash');
    if (staticSplash) {
      // Fade out then hide to prevent flash
      staticSplash.style.opacity = '0';
      staticSplash.style.transition = 'opacity 150ms ease-out';
      setTimeout(() => {
        staticSplash.classList.add('hidden');
      }, 150);
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
      const fallbackTimer = setTimeout(() => setIsAppReady(true), 1500);
      return () => {
        window.removeEventListener('DOMContentLoaded', checkReady);
        clearTimeout(fallbackTimer);
      };
    }
  }, []);

  // Minimum splash duration for branding (reduced to keep initial load snappy)
  useEffect(() => {
    const timer = setTimeout(() => setMinDurationPassed(true), 300);
    return () => clearTimeout(timer);
  }, []);

  // Check session storage - but don't hide static splash yet
  useEffect(() => {
    const seen = sessionStorage.getItem('splash_seen');
    if (seen) {
      setShowSplash(false);
      setHasSeenSplash(true);
      // Hide static splash immediately since we're not showing React splash
      hideStaticSplash();
    }
    // If not seen, wait for React splash to signal ready before hiding static
  }, []);

  // Callback for when React splash is mounted and painted
  const handleSplashReady = useCallback(() => {
    hideStaticSplash();
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
          onReady={handleSplashReady}
          duration={1500}
        />
      )}
      <div className="transition-opacity duration-300 opacity-100">
        {children}
      </div>
    </SplashContext.Provider>
  );
}
