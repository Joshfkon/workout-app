'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readExplicitSmallestPlate, subscribeSmallestPlate } from '@/lib/workout/smallestPlate';
import type { WeightUnit } from '@/types/schema';

/**
 * The smallest plate the user explicitly chose in the plate calculator, kept
 * live: a change made while a workout is open (same tab or another) reaches
 * every mounted consumer. undefined = never chosen. Server snapshot is
 * undefined, so SSR never reads storage.
 */
export function useExplicitSmallestPlate(unit: WeightUnit): number | undefined {
  const getSnapshot = useCallback(() => readExplicitSmallestPlate(unit), [unit]);
  return useSyncExternalStore(subscribeSmallestPlate, getSnapshot, () => undefined);
}
