'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { SplashScreen } from '@/components/ui/SplashScreen';

interface SplashContextType {
  showSplash: boolean;
  hideSplash: () => void;
}

const SplashContext = createContext<SplashContextType>({
  showSplash: true,
  hideSplash: () => {},
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

export function SplashProvider({ children }: SplashProviderProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [hasSeenSplash, setHasSeenSplash] = useState(false);

  useEffect(() => {
    // Check if user has seen splash in this session
    const seen = sessionStorage.getItem('splash_seen');
    if (seen) {
      setShowSplash(false);
      setHasSeenSplash(true);
      // Hide static splash immediately if user already saw it
      hideStaticSplash();
    } else {
      // React splash is taking over, hide the static one
      hideStaticSplash();
    }
  }, []);

  const hideSplash = () => {
    setShowSplash(false);
    setHasSeenSplash(true);
    sessionStorage.setItem('splash_seen', 'true');
  };

  return (
    <SplashContext.Provider value={{ showSplash: showSplash && !hasSeenSplash, hideSplash }}>
      {showSplash && !hasSeenSplash && (
        <SplashScreen onComplete={hideSplash} duration={2800} />
      )}
      <div className={showSplash && !hasSeenSplash ? 'opacity-0' : 'opacity-100 transition-opacity duration-500'}>
        {children}
      </div>
    </SplashContext.Provider>
  );
}

