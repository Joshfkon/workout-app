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

export function SplashProvider({ children }: SplashProviderProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [hasSeenSplash, setHasSeenSplash] = useState(false);

  useEffect(() => {
    // Check if user has seen splash in this session
    const seen = sessionStorage.getItem('splash_seen');
    if (seen) {
      setShowSplash(false);
      setHasSeenSplash(true);
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

