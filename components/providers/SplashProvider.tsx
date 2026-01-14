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
 * Optimized SplashProvider with balanced performance:
 * 1. First visit: Shows full branded animation (~1.3s) for user experience
 * 2. Repeat visits: Skips splash entirely via sessionStorage for instant loads
 * 3. Handoff: Smoothly transitions from static HTML splash to React splash
 * 4. Performance: Server-side data fetching + caching means content loads during animation
 */
export function SplashProvider({ children }: SplashProviderProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [hasSeenSplash, setHasSeenSplash] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);

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
      // Fallback timeout - ensure we eventually become ready (reduced from 1500ms)
      const fallbackTimer = setTimeout(() => setIsAppReady(true), 800);
      return () => {
        window.removeEventListener('DOMContentLoaded', checkReady);
        clearTimeout(fallbackTimer);
      };
    }
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

  // Note: We intentionally do NOT auto-hide splash when app is ready.
  // First visit: Let the animation complete fully (brand experience)
  // Repeat visits: Skip via sessionStorage (fast load)
  // The SplashScreen component controls its own timing via duration prop.

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
          duration={1300}
        />
      )}
      <div className="transition-opacity duration-300 opacity-100">
        {children}
      </div>
    </SplashContext.Provider>
  );
}
