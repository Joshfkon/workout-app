'use client';

import { useState, useEffect, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  getPWAContext,
  getInstallInstructions,
  type PWAContext,
  type InstallInstructions,
} from '@/lib/utils/pwa-detection';

// BeforeInstallPromptEvent type definition
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

// Global state for the deferred install prompt
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let promptListeners: Set<() => void> = new Set();

// Notify all listeners when the prompt becomes available
function notifyPromptListeners() {
  promptListeners.forEach((listener) => listener());
}

export interface PWAInstallPreferences {
  dismissedHomescreenPrompt: boolean;
  homescreenPromptDismissedAt?: string;
  homescreenInstallCompleted: boolean;
  homescreenInstallCompletedAt?: string;
}

const defaultPWAPrefs: PWAInstallPreferences = {
  dismissedHomescreenPrompt: false,
  homescreenInstallCompleted: false,
};

export function usePWA() {
  const [pwaContext, setPwaContext] = useState<PWAContext | null>(null);
  const [instructions, setInstructions] = useState<InstallInstructions | null>(null);
  const [canTriggerNativePrompt, setCanTriggerNativePrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installPrefs, setInstallPrefs] = useState<PWAInstallPreferences>(defaultPWAPrefs);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize PWA context
  useEffect(() => {
    const context = getPWAContext();
    setPwaContext(context);
    setInstructions(getInstallInstructions(context));
    setIsInstalled(context.isStandalone);

    // Set up listener for when the install prompt becomes available
    const handlePromptAvailable = () => {
      setCanTriggerNativePrompt(deferredInstallPrompt !== null);
    };

    promptListeners.add(handlePromptAvailable);

    // Check if we already have a deferred prompt
    setCanTriggerNativePrompt(deferredInstallPrompt !== null);

    return () => {
      promptListeners.delete(handlePromptAvailable);
    };
  }, []);

  // Load install preferences from database
  useEffect(() => {
    async function loadInstallPrefs() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data } = await supabase
            .from('users')
            .select('preferences')
            .eq('id', user.id)
            .single();

          if (data?.preferences) {
            const prefs = data.preferences as Record<string, unknown>;
            setInstallPrefs({
              dismissedHomescreenPrompt: (prefs.dismissedHomescreenPrompt as boolean) ?? false,
              homescreenPromptDismissedAt: prefs.homescreenPromptDismissedAt as string | undefined,
              homescreenInstallCompleted: (prefs.homescreenInstallCompleted as boolean) ?? false,
              homescreenInstallCompletedAt: prefs.homescreenInstallCompletedAt as string | undefined,
            });
          }
        }
      } catch (err) {
        console.error('Failed to load PWA install preferences:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadInstallPrefs();
  }, []);

  // Listen for appinstalled event
  useEffect(() => {
    const handleAppInstalled = () => {
      setIsInstalled(true);
      // Save to database
      saveInstallCompleted();
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save install completed preference
  const saveInstallCompleted = useCallback(async () => {
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: currentUser } = await supabase
          .from('users')
          .select('preferences')
          .eq('id', user.id)
          .single();

        const currentPrefs = (currentUser?.preferences as Record<string, unknown>) || {};

        await supabase
          .from('users')
          .update({
            preferences: {
              ...currentPrefs,
              homescreenInstallCompleted: true,
              homescreenInstallCompletedAt: new Date().toISOString(),
            },
          })
          .eq('id', user.id);

        setInstallPrefs((prev) => ({
          ...prev,
          homescreenInstallCompleted: true,
          homescreenInstallCompletedAt: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error('Failed to save install completion:', err);
    }
  }, []);

  // Trigger native install prompt (for Chrome/Edge on Android/Desktop)
  const triggerNativeInstallPrompt = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredInstallPrompt) {
      return 'unavailable';
    }

    try {
      await deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;

      // Clear the deferred prompt after use
      deferredInstallPrompt = null;
      setCanTriggerNativePrompt(false);
      notifyPromptListeners();

      if (result.outcome === 'accepted') {
        await saveInstallCompleted();
      }

      return result.outcome;
    } catch (err) {
      console.error('Failed to show install prompt:', err);
      return 'unavailable';
    }
  }, [saveInstallCompleted]);

  // Dismiss the prompt (Maybe Later)
  const dismissPrompt = useCallback(async () => {
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: currentUser } = await supabase
          .from('users')
          .select('preferences')
          .eq('id', user.id)
          .single();

        const currentPrefs = (currentUser?.preferences as Record<string, unknown>) || {};

        await supabase
          .from('users')
          .update({
            preferences: {
              ...currentPrefs,
              dismissedHomescreenPrompt: true,
              homescreenPromptDismissedAt: new Date().toISOString(),
            },
          })
          .eq('id', user.id);

        setInstallPrefs((prev) => ({
          ...prev,
          dismissedHomescreenPrompt: true,
          homescreenPromptDismissedAt: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error('Failed to save dismiss preference:', err);
    }
  }, []);

  // Mark installation as done manually (I've Done This)
  const markInstallDone = useCallback(async () => {
    await saveInstallCompleted();
  }, [saveInstallCompleted]);

  // Check if we should show the install reminder (after 7 days of dismissal)
  const shouldShowReminder = useCallback((): boolean => {
    if (isInstalled || pwaContext?.isStandalone) return false;
    if (installPrefs.homescreenInstallCompleted) return false;
    if (!installPrefs.dismissedHomescreenPrompt) return false;
    if (!installPrefs.homescreenPromptDismissedAt) return false;

    const dismissedAt = new Date(installPrefs.homescreenPromptDismissedAt);
    const now = new Date();
    const daysSinceDismiss = Math.floor(
      (now.getTime() - dismissedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysSinceDismiss >= 7;
  }, [isInstalled, pwaContext, installPrefs]);

  // Should show install screen in onboarding
  const shouldShowInOnboarding = useCallback((): boolean => {
    if (isLoading) return false;
    if (isInstalled || pwaContext?.isStandalone) return false;
    if (installPrefs.homescreenInstallCompleted) return false;
    return true;
  }, [isLoading, isInstalled, pwaContext, installPrefs]);

  return {
    pwaContext,
    instructions,
    isInstalled,
    isLoading,
    canTriggerNativePrompt,
    installPrefs,
    triggerNativeInstallPrompt,
    dismissPrompt,
    markInstallDone,
    shouldShowReminder,
    shouldShowInOnboarding,
  };
}

// Set up global event listener for beforeinstallprompt
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    notifyPromptListeners();
  });
}
