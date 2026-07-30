/**
 * Preset re-derivation gates (Change 2 — report only, values NOT applied).
 *
 *  - THE hard assertion: the PROPOSED presets never prescribe below the
 *    group's band MEV for any (experience, goal, profile). When the proposal
 *    is applied to recommendVolume, repoint presetMevViolations at the live
 *    outputs and this becomes the permanent regression gate.
 *  - The LIVE table's violations are PINNED (not asserted away): several
 *    novice cut outputs sit below MEV even in the pre-cap currency — the
 *    recalibration must close these; a new violation appearing fails CI.
 *  - Measurement sanity: cap ratios are 1 for groups the cap can't bind and
 *    strictly < 1 for the known cap-binding groups under seed-convention tags.
 */

import {
  currentPresetMevViolations,
  derivePresetRecalibration,
  measureCapRatios,
  mevFloorPreset,
  presetMevViolations,
  proposedOutput,
  EXPERIENCES,
  type Experience,
} from '../presetRecalibration';
import { COARSE_MUSCLES, getEffectiveBand, type CoarseMuscle } from '../volumeBands';
import type { Goal } from '@/types/schema';

const seedRatios = measureCapRatios(['bulk', 'cut'], 'seed-convention');
const rows = derivePresetRecalibration(seedRatios);
const proposedFor = (experience: Experience, goal: Goal, group: CoarseMuscle): number => {
  const row = rows.find((r) => r.group === group && r.experience === experience)!;
  return proposedOutput(row.proposedPreset, goal, group);
};

describe('hard assertion: proposed presets never prescribe below MEV', () => {
  it('no (group, experience, goal) proposal output sits below the band MEV — standard profile', () => {
    expect(presetMevViolations(proposedFor, 'standard')).toEqual([]);
  });

  it('… and enhanced profile (MEVs never scale, outputs only rise)', () => {
    expect(presetMevViolations(proposedFor, 'enhanced')).toEqual([]);
  });

  it('every proposal stays inside the band (never above MRV after the clamp)', () => {
    for (const row of rows) {
      const mrv = getEffectiveBand(row.group).mrv;
      for (const goal of ['bulk', 'maintenance', 'cut', 'recomp'] as const) {
        expect(proposedOutput(row.proposedPreset, goal, row.group)).toBeLessThanOrEqual(mrv);
      }
    }
  });
});

describe('live table state (pinned, not fixed here — Change 2 is report-only)', () => {
  it('current presets violate the MEV rule for these exact cases (novice cut), pre-cap currency', () => {
    // These are PRE-EXISTING: cut ×0.7 lands below MEV before any cap effect.
    // The recalibration proposal closes them; shrink-only list.
    expect(currentPresetMevViolations().sort()).toEqual(
      [
        'chest/novice/cut: 7 < MEV 8',
        'back/novice/cut: 10 < MEV 12',
        'shoulders/novice/cut: 10 < MEV 12',
        'biceps/novice/cut: 8 < MEV 10',
        'quads/novice/cut: 7 < MEV 8',
        'calves/novice/cut: 7 < MEV 8',
        'traps/novice/cut: 4 < MEV 6',
      ].sort()
    );
  });
});

describe('measurement sanity', () => {
  it('single-member groups the cap cannot bind measure ratio 1', () => {
    for (const g of ['biceps', 'quads', 'hamstrings', 'forearms'] as const) {
      expect(seedRatios[g].ratio).toBe(1);
    }
  });

  it('the known cap-binding groups measure ratio < 1 under seed-convention tags', () => {
    // Triceps isolations (lat_med primary + long secondary) and calf raises
    // (gastroc↔soleus pairs) bind in every generated template that includes
    // them; the ratio must reflect it.
    expect(seedRatios.triceps.ratio).toBeLessThan(1);
    expect(seedRatios.calves.ratio).toBeLessThan(1);
  });

  it('ratios are proper fractions and floors are consistent', () => {
    for (const g of COARSE_MUSCLES) {
      expect(seedRatios[g].ratio).toBeGreaterThan(0);
      expect(seedRatios[g].ratio).toBeLessThanOrEqual(1);
      const mev = getEffectiveBand(g).mev;
      expect(Math.round(mevFloorPreset(mev) * 0.7)).toBeGreaterThanOrEqual(mev);
      expect(Math.round((mevFloorPreset(mev) - 1) * 0.7)).toBeLessThan(mev);
    }
  });

  it('the derivation covers every group × experience', () => {
    expect(rows).toHaveLength(COARSE_MUSCLES.length * EXPERIENCES.length);
  });
});
