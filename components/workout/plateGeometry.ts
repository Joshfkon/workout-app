import type { WeightUnit } from '@/types/schema';

/**
 * Pure geometry helpers for the plate calculator's barbell graphic.
 *
 * Plate sprites are scaled by real-ish proportions: diameter maps to SVG
 * height, thickness maps to SVG width, so a loaded bar looks like a loaded bar.
 * Both sides of the bar consume the same layout, so they cannot diverge.
 */

export const BAR_MID_Y = 60; // vertical center of the 120-tall viewBox
export const MAX_DIAMETER = 58; // full-height plate (45lb / 20-25kg)
export const PLATE_GAP = 1.5; // gap between adjacent plates
export const COLLAR_OFFSET = 30; // distance from center to the collar plates rest against
export const PLATE_START = 36; // inner edge of the first (largest) plate, from center

/** Height fraction of a full plate, keyed by real denomination. */
const HEIGHT_FRACTION: Record<WeightUnit, Array<[number, number]>> = {
  lb: [[45, 1.0], [35, 1.0], [25, 0.8], [10, 0.6], [5, 0.5], [2.5, 0.4]],
  kg: [[25, 1.0], [20, 1.0], [15, 0.85], [10, 0.6], [5, 0.5], [2.5, 0.45], [1.25, 0.4]],
};

/** Thickness (SVG width) in px, keyed by real denomination. Heavier = thicker. */
const THICKNESS: Record<WeightUnit, Array<[number, number]>> = {
  lb: [[45, 15], [35, 13], [25, 11], [10, 8], [5, 7], [2.5, 6]],
  kg: [[25, 15], [20, 14], [15, 12], [10, 10], [5, 8], [2.5, 7], [1.25, 6]],
};

function nearestValue(table: Array<[number, number]>, weight: number): number {
  let best = table[0];
  let bestDiff = Infinity;
  for (const entry of table) {
    const diff = Math.abs(entry[0] - weight);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best[1];
}

export function plateDiameter(weight: number, unit: WeightUnit): number {
  return MAX_DIAMETER * nearestValue(HEIGHT_FRACTION[unit], weight);
}

export function plateThickness(weight: number, unit: WeightUnit): number {
  return nearestValue(THICKNESS[unit], weight);
}

/** Plates 10lb / 5kg and under are too small to read a number on — legend carries it. */
export function showPlateLabel(weight: number, unit: WeightUnit): boolean {
  return unit === 'lb' ? weight > 10 : weight > 5;
}

/** Pick a readable label color for text drawn on top of a plate fill. */
export function plateLabelColor(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 150 ? '#18181b' : '#ffffff';
}

export interface PlateLayoutItem {
  plate: number;
  width: number;
  height: number;
  /** Distance of the plate's center from the bar center. */
  centerOffset: number;
}

/**
 * Compute the plate geometry for ONE side, measured as offsets from the bar
 * center. Both the left and right renderers consume this identical array, so
 * the two sides are guaranteed pixel mirrors of each other.
 */
export function computePlateLayout(
  platesPerSide: number[],
  unit: WeightUnit
): { items: PlateLayoutItem[]; sleeveEnd: number } {
  let cursor = PLATE_START;
  const items: PlateLayoutItem[] = platesPerSide.map((plate) => {
    const width = plateThickness(plate, unit);
    const height = plateDiameter(plate, unit);
    const innerEdge = cursor;
    const centerOffset = innerEdge + width / 2;
    cursor = innerEdge + width + PLATE_GAP;
    return { plate, width, height, centerOffset };
  });
  const plateEnd = platesPerSide.length ? cursor - PLATE_GAP : PLATE_START;
  // Sleeve pokes a little past the last plate so plates visibly sit on it.
  const sleeveEnd = Math.max(plateEnd + 10, 56);
  return { items, sleeveEnd };
}
