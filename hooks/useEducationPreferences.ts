'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_EDUCATION_PREFERENCES, type EducationPreferences } from '@/types/education';

interface EducationState extends EducationPreferences {
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

  // Getters
  isHintDismissed: (hintId: string) => boolean;
  isTourCompleted: (tourId: string) => boolean;
  shouldShowEducation: () => boolean;
}

export const useEducationStore = create<EducationState>()(
  persist(
    (set, get) => ({
      // Initial state
      ...DEFAULT_EDUCATION_PREFERENCES,

      // Actions
      setShowBeginnerTips: (show) => set({ showBeginnerTips: show }),

      setExplainScienceTerms: (explain) => set({ explainScienceTerms: explain }),

      dismissHint: (hintId) => {
        const { dismissedHints } = get();
        if (!dismissedHints.includes(hintId)) {
          set({ dismissedHints: [...dismissedHints, hintId] });
        }
      },

      resetHint: (hintId) => {
        const { dismissedHints } = get();
        set({ dismissedHints: dismissedHints.filter((id) => id !== hintId) });
      },

      resetAllHints: () => set({ dismissedHints: [] }),

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

      resetAll: () => set(DEFAULT_EDUCATION_PREFERENCES),

      // Getters
      isHintDismissed: (hintId) => get().dismissedHints.includes(hintId),

      isTourCompleted: (tourId) => get().completedTours.includes(tourId),

      shouldShowEducation: () => {
        const { showBeginnerTips, explainScienceTerms } = get();
        return showBeginnerTips || explainScienceTerms;
      },
    }),
    {
      name: 'education-preferences',
    }
  )
);

/**
 * Hook for checking if a specific hint should be shown
 */
export function useFirstTimeHint(hintId: string) {
  const showBeginnerTips = useEducationStore((state) => state.showBeginnerTips);
  const dismissedHints = useEducationStore((state) => state.dismissedHints);
  const dismissHint = useEducationStore((state) => state.dismissHint);

  const shouldShow = showBeginnerTips && !dismissedHints.includes(hintId);

  return {
    shouldShow,
    dismiss: () => dismissHint(hintId),
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
