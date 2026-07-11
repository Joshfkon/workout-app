/**
 * Task 5 — the suggestion / e1RM path reads TOTAL load for bodyweight sets.
 *
 * Invariant under test: when a weighted (or assisted) bodyweight set is logged,
 * SetLoggerRow persists `weightKg = bodyweightData.effectiveLoadKg` (BW ± mod),
 * so the history e1RM (`calculateE1RM`, Brzycki, keyed on `weight_kg`) is anchored
 * on the full load — not the added weight alone, and not zero. A pure bodyweight
 * entry (added weight = 0) must still yield a sane, load-based e1RM and must not
 * drive a nonsense "add weight" jump when reps are low.
 */

import { calculateE1RM } from '../suggestions';
import {
  createWeightedBodyweightData,
  createAssistedBodyweightData,
  createPureBodyweightData,
  suggestBodyweightProgression,
} from '@/services/bodyweightService';
import { inputWeightToKg, convertWeight } from '@/lib/utils';
import type { SetLog } from '@/types/schema';

// 176.4 lb athlete; 45 lb added; matches the back-extension bug report.
const BW_KG = inputWeightToKg(176.4, 'lb');
const ADDED_45_KG = inputWeightToKg(45, 'lb');

/** The exact weightKg SetLoggerRow persists is the effective load. */
function persistedWeightKg(mod: 'weighted' | 'assisted' | 'none'): number {
  if (mod === 'weighted') {
    return createWeightedBodyweightData(BW_KG, ADDED_45_KG).effectiveLoadKg;
  }
  if (mod === 'assisted') {
    return createAssistedBodyweightData(BW_KG, inputWeightToKg(60, 'lb'), 'machine')
      .effectiveLoadKg;
  }
  return createPureBodyweightData(BW_KG).effectiveLoadKg;
}

describe('bodyweight e1RM uses total load', () => {
  it('a weighted back-extension entry (BW + 45 × 13) produces a positive e1RM anchored on total load', () => {
    const weightKg = persistedWeightKg('weighted');
    // BW + 45 lb, not 45 lb alone.
    expect(weightKg).toBeCloseTo(BW_KG + ADDED_45_KG, 5);

    const e1rm = calculateE1RM(weightKg, 13, 10);
    expect(e1rm).toBeGreaterThan(0);
    expect(Number.isFinite(e1rm)).toBe(true);
    // Must exceed an e1RM computed from the added weight alone — proving BW is included.
    expect(e1rm).toBeGreaterThan(calculateE1RM(ADDED_45_KG, 13, 10));
  });

  it('adding weight raises the e1RM (monotonic in total load)', () => {
    const pure = calculateE1RM(persistedWeightKg('none'), 13, 10);
    const weighted = calculateE1RM(persistedWeightKg('weighted'), 13, 10);
    expect(weighted).toBeGreaterThan(pure);
  });

  it('an assisted entry (BW − 60) drops total load — and e1RM — below bodyweight', () => {
    const assistedKg = persistedWeightKg('assisted');
    expect(assistedKg).toBeLessThan(BW_KG);
    expect(calculateE1RM(assistedKg, 8, 10)).toBeLessThan(
      calculateE1RM(BW_KG, 8, 10)
    );
  });
});

describe('unweighted entries do not produce nonsense suggestions', () => {
  const pureSet = (reps: number): SetLog => ({
    id: `s-${reps}`,
    exerciseBlockId: 'b1',
    setNumber: 1,
    weightKg: BW_KG,
    reps,
    rpe: 8,
    restSeconds: null,
    isWarmup: false,
    setType: 'normal',
    parentSetId: null,
    quality: 'stimulative',
    qualityReason: '',
    note: null,
    loggedAt: new Date('2026-01-01').toISOString(),
    bodyweightData: createPureBodyweightData(BW_KG),
  });

  it('low reps on a pure entry hold the load instead of jumping weight', () => {
    const suggestion = suggestBodyweightProgression([pureSet(6), pureSet(7)], BW_KG);
    expect(suggestion.type).toBe('maintain');
    expect(suggestion.suggestedValue).toBeUndefined();
  });

  it('a pure entry never produces an e1RM that outstrips a lightly-weighted one', () => {
    const pure = calculateE1RM(persistedWeightKg('none'), 20, 9);
    const weighted = calculateE1RM(
      createWeightedBodyweightData(BW_KG, inputWeightToKg(5, 'lb')).effectiveLoadKg,
      20,
      9
    );
    expect(pure).toBeLessThanOrEqual(weighted);
  });
});
