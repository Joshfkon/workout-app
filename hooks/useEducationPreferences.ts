'use client';

import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_EDUCATION_PREFERENCES, type EducationPreferences } from '@/types/education';

interface EducationState extends EducationPreferences {
  // Active hint queue - only one hint shown at a time
  activeHintId: string | null;
  hintQueue: string[];

  // Actions
  setShowBeginnerTips: (show: boolean) => void;
  setExplainScienceTerms: (explain: boolean) => void;
  dismissHint: (hintId: string) => void;
  resetHint: (hintId: string) => void;
  resetAllHints: () => void;
  completeTour: (tourId: string) => void;
  resetTour: (tourId: string) => void;
  resetAllTours: () => void;
  resetAll: () => void;

  // Hint queue actions
  registerHint: (hintId: string) => void;
  unregisterHint: (hintId: string) => void;

  // Getters
  isHintDismissed: (hintId: string) => boolean;
  isTourCompleted: (tourId: string) => boolean;
  shouldShowEducation: () => boolean;
  isActiveHint: (hintId: string) => boolean;
}

export const useEducationStore = create<EducationState>()(
  persist(
    (set, get) => ({
      // Initial state
      ...DEFAULT_EDUCATION_PREFERENCES,

      // Hint queue state (not persisted, managed at runtime)
      activeHintId: null,
      hintQueue: [],

      // Actions
      setShowBeginnerTips: (show) => set({ showBeginnerTips: show }),

      setExplainScienceTerms: (explain) => set({ explainScienceTerms: explain }),

      dismissHint: (hintId) => {
        const { dismissedHints, hintQueue, activeHintId } = get();
        if (!dismissedHints.includes(hintId)) {
          // Add to dismissed and remove from queue
          const newQueue = hintQueue.filter((id) => id !== hintId);
          // If this was the active hint, activate the next one
          const newActiveHint = activeHintId === hintId ? (newQueue[0] || null) : activeHintId;
          set({
            dismissedHints: [...dismissedHints, hintId],
            hintQueue: newQueue,
            activeHintId: newActiveHint,
          });
        }
      },

      resetHint: (hintId) => {
        const { dismissedHints } = get();
        set({ dismissedHints: dismissedHints.filter((id) => id !== hintId) });
      },

      resetAllHints: () => set({ dismissedHints: [], hintQueue: [], activeHintId: null }),

      completeTour: (tourId) => {
        const { completedTours } = get();
        if (!completedTours.includes(tourId)) {
          set({ completedTours: [...completedTours, tourId] });
        }
      },

      resetTour: (tourId) => {
        const { completedTours } = get();
        set({ completedTours: completedTours.filter((id) => id !== tourId) });
      },

      resetAllTours: () => set({ completedTours: [] }),

      resetAll: () => set({ ...DEFAULT_EDUCATION_PREFERENCES, hintQueue: [], activeHintId: null }),

      // Hint queue actions
      registerHint: (hintId) => {
        const { hintQueue, activeHintId, dismissedHints, showBeginnerTips } = get();
        // Don't register dismissed hints or if beginner tips are off
        if (dismissedHints.includes(hintId) || !showBeginnerTips) return;
        // Don't re-register if already in queue
        if (hintQueue.includes(hintId)) return;

        const newQueue = [...hintQueue, hintId];
        // If no active hint, make this one active
        set({
          hintQueue: newQueue,
          activeHintId: activeHintId || hintId,
        });
      },

      unregisterHint: (hintId) => {
        const { hintQueue, activeHintId } = get();
        const newQueue = hintQueue.filter((id) => id !== hintId);
        // If this was the active hint, activate the next one
        const newActiveHint = activeHintId === hintId ? (newQueue[0] || null) : activeHintId;
        set({
          hintQueue: newQueue,
          activeHintId: newActiveHint,
        });
      },

      // Getters
      isHintDismissed: (hintId) => get().dismissedHints.includes(hintId),

      isTourCompleted: (tourId) => get().completedTours.includes(tourId),

      shouldShowEducation: () => {
        const { showBeginnerTips, explainScienceTerms } = get();
        return showBeginnerTips || explainScienceTerms;
      },

      isActiveHint: (hintId) => get().activeHintId === hintId,
    }),
    {
      name: 'education-preferences',
      // Don't persist the queue state - it's runtime only
      partialize: (state) => ({
        showBeginnerTips: state.showBeginnerTips,
        explainScienceTerms: state.explainScienceTerms,
        dismissedHints: state.dismissedHints,
        completedTours: state.completedTours,
      }),
    }
  )
);

/**
 * Hook for checking if a specific hint should be shown
 * Uses a queue system so only one hint displays at a time
 */
export function useFirstTimeHint(hintId: string) {
  const showBeginnerTips = useEducationStore((state) => state.showBeginnerTips);
  const dismissedHints = useEducationStore((state) => state.dismissedHints);
  const activeHintId = useEducationStore((state) => state.activeHintId);
  const dismissHintAction = useEducationStore((state) => state.dismissHint);
  const registerHintAction = useEducationStore((state) => state.registerHint);
  const unregisterHintAction = useEducationStore((state) => state.unregisterHint);

  const isDismissed = dismissedHints.includes(hintId);
  const isActive = activeHintId === hintId;

  // Only show if: beginner tips on, not dismissed, AND this is the active hint
  const shouldShow = showBeginnerTips && !isDismissed && isActive;

  // Memoize callbacks to prevent useEffect re-runs on every render
  const dismiss = useCallback(() => dismissHintAction(hintId), [dismissHintAction, hintId]);
  const register = useCallback(() => registerHintAction(hintId), [registerHintAction, hintId]);
  const unregister = useCallback(() => unregisterHintAction(hintId), [unregisterHintAction, hintId]);

  return {
    shouldShow,
    dismiss,
    register,
    unregister,
    // Whether this hint would be eligible to show (ignoring queue position)
    isEligible: showBeginnerTips && !isDismissed,
  };
}

/**
 * Hook for managing a guided tour
 */
export function useGuidedTour(tourId: string) {
  const showBeginnerTips = useEducationStore((state) => state.showBeginnerTips);
  const completedTours = useEducationStore((state) => state.completedTours);
  const completeTour = useEducationStore((state) => state.completeTour);
  const resetTour = useEducationStore((state) => state.resetTour);

  const isCompleted = completedTours.includes(tourId);
  const shouldShow = showBeginnerTips && !isCompleted;

  return {
    shouldShow,
    isCompleted,
    complete: () => completeTour(tourId),
    reset: () => resetTour(tourId),
  };
}

/**
 * Hook for education preferences with selectors
 */
export function useEducationPreferences() {
  const showBeginnerTips = useEducationStore((state) => state.showBeginnerTips);
  const explainScienceTerms = useEducationStore((state) => state.explainScienceTerms);
  const setShowBeginnerTips = useEducationStore((state) => state.setShowBeginnerTips);
  const setExplainScienceTerms = useEducationStore((state) => state.setExplainScienceTerms);
  const resetAll = useEducationStore((state) => state.resetAll);
  const resetAllHints = useEducationStore((state) => state.resetAllHints);

  return {
    showBeginnerTips,
    explainScienceTerms,
    setShowBeginnerTips,
    setExplainScienceTerms,
    resetAll,
    resetAllHints,
  };
}
