/**
 * The smallest-plate choice is a per-unit device setting (plate inventory is
 * a property of the gym, not the account), persisted in localStorage like the
 * rest timer and theme. Set from the plate calculator; read there and by the
 * workout logger's loadable-weight rounding (lib/workout/loadableWeight).
 */

import { DEFAULT_SMALLEST_PLATE, SMALLEST_PLATE_OPTIONS } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';

export const smallestPlateStorageKey = (unit: WeightUnit) =>
  `plate_calculator_smallest_plate_${unit}`;

/** The plate the user explicitly chose, or undefined if they never chose one. */
export function readExplicitSmallestPlate(unit: WeightUnit): number | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = parseFloat(window.localStorage.getItem(smallestPlateStorageKey(unit)) ?? '');
    const options: readonly number[] = SMALLEST_PLATE_OPTIONS[unit];
    if (options.includes(stored)) return stored;
  } catch {
    // Storage unavailable (e.g. private browsing).
  }
  return undefined;
}

/** The plate to use: the explicit choice, else the unit default. */
export function readStoredSmallestPlate(unit: WeightUnit): number {
  return readExplicitSmallestPlate(unit) ?? DEFAULT_SMALLEST_PLATE[unit];
}

/** Same-tab change notification (the `storage` event only fires in OTHER tabs). */
export const SMALLEST_PLATE_CHANGE_EVENT = 'hypertrack:smallest-plate-change';

export function storeSmallestPlate(unit: WeightUnit, plate: number): void {
  try {
    window.localStorage.setItem(smallestPlateStorageKey(unit), String(plate));
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
  try {
    window.dispatchEvent(new CustomEvent(SMALLEST_PLATE_CHANGE_EVENT, { detail: { unit, plate } }));
  } catch {
    // No window/CustomEvent (non-browser) — nothing is listening.
  }
}

/** Subscribe to smallest-plate changes from this tab or another. Returns the unsubscribe. */
export function subscribeSmallestPlate(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith('plate_calculator_smallest_plate_')) onChange();
  };
  window.addEventListener(SMALLEST_PLATE_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SMALLEST_PLATE_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
