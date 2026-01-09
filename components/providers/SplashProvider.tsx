'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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
 * SplashProvider that:
 * 1. Uses sessionStorage to skip splash on subsequent navigations
 * 2. Monitors actual app readiness (document load state)
 * 3. Shows animated splash on first visit only
 */
export function SplashProvider({ children }: SplashProviderProps) {
  // Check sessionStorage synchronously to avoid flash
  const [hasSeenSplash] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('splash_seen') === 'true';
    }
    return false;
  });

  const [showSplash, setShowSplash] = useState(!hasSeenSplash);
  const [isAppReady, setIsAppReady] = useState(false);

  // Mark app as ready when document is fully loaded
  useEffect(() => {
    const checkReady = () => {
      if (document.readyState === 'complete') {
        setIsAppReady(true);
      }
    };

    checkReady();

    if (document.readyState !== 'complete') {
      window.addEventListener('load', checkReady, { once: true });
      const fallbackTimer = setTimeout(() => setIsAppReady(true), 3000);
      return () => {
        window.removeEventListener('load', checkReady);
        clearTimeout(fallbackTimer);
      };
    }
  }, []);

  const hideSplash = useCallback(() => {
    setShowSplash(false);
    sessionStorage.setItem('splash_seen', 'true');
  }, []);

  return (
    <SplashContext.Provider value={{ showSplash, hideSplash, isAppReady }}>
      {showSplash && (
        <SplashScreen
          onComplete={hideSplash}
          duration={1500}
        />
      )}
      <div
        className={showSplash ? 'opacity-0' : 'opacity-100 transition-opacity duration-300'}
        style={{ visibility: showSplash ? 'hidden' : 'visible' }}
      >
        {children}
      </div>
    </SplashContext.Provider>
  );
}
