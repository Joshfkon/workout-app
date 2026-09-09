/**
 * useIdleWorkoutPrompt.ts — Idle detection for in-progress workouts.
 *
 * Monitors time since the last logged set and prompts the user when they've
 * been idle for ABANDONED_SESSION_THRESHOLD_MINUTES. Prompts at most once per
 * idle streak (dismissing or logging a new set resets the detector).
 *
 * Pairs with the abandoned-session backdating at finish (#662): that catches
 * forgotten finishes AFTER the user eventually saves; this catches them WHILE
 * they're still in the workout.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { ABANDONED_SESSION_THRESHOLD_MINUTES } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/finishWorkout';

const IDLE_THRESHOLD_MS = ABANDONED_SESSION_THRESHOLD_MINUTES * 60 * 1000;

export interface IdleWorkoutPromptState {
  /** Whether to show the idle prompt right now. */
  shouldShowPrompt: boolean;
  /** Dismiss the prompt and reset the idle detector (user tapped "Keep going"). */
  dismissPrompt: () => void;
}

/**
 * Detect idle gaps from the last completed set's timestamp. Returns whether
 * to show the prompt and a dismissal callback.
 *
 * @param lastSetTimestamp - ISO string of the last logged set, or null if no
 *   sets yet. From `completedSets[completedSets.length - 1]?.logged_at`.
 * @param isWorkoutActive - Whether the workout session is currently in progress
 *   (not finished/discarded). Idle detection only runs while active.
 */
export function useIdleWorkoutPrompt(
  lastSetTimestamp: string | null,
  isWorkoutActive: boolean
): IdleWorkoutPromptState {
  const [shouldShowPrompt, setShouldShowPrompt] = useState(false);
  const [hasPromptedForCurrentIdle, setHasPromptedForCurrentIdle] = useState(false);
  const lastSetRef = useRef<string | null>(null);

  const dismissPrompt = useCallback(() => {
    setShouldShowPrompt(false);
    setHasPromptedForCurrentIdle(true);
  }, []);

  useEffect(() => {
    // Reset idle state when a new set is logged (timestamp changes).
    if (lastSetTimestamp !== lastSetRef.current) {
      lastSetRef.current = lastSetTimestamp;
      setHasPromptedForCurrentIdle(false);
      setShouldShowPrompt(false);
    }
  }, [lastSetTimestamp]);

  useEffect(() => {
    // Only monitor while the workout is active and we haven't already prompted
    // for this idle streak.
    if (!isWorkoutActive || !lastSetTimestamp || hasPromptedForCurrentIdle) {
      setShouldShowPrompt(false);
      return;
    }

    const checkIdle = () => {
      const lastSetTime = new Date(lastSetTimestamp).getTime();
      const now = Date.now();
      const idleMs = now - lastSetTime;

      if (idleMs >= IDLE_THRESHOLD_MS && !hasPromptedForCurrentIdle) {
        setShouldShowPrompt(true);
      }
    };

    // Check immediately on mount/change, then poll every 30 seconds.
    checkIdle();
    const interval = setInterval(checkIdle, 30 * 1000);

    return () => clearInterval(interval);
  }, [lastSetTimestamp, isWorkoutActive, hasPromptedForCurrentIdle]);

  return {
    shouldShowPrompt,
    dismissPrompt,
  };
}
