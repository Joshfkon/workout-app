/**
 * Preset re-derivation gates (Change 2 — report only, values NOT applied).
 *
 * CORRECTED FLOOR RULE (2026-07-30 review): MEV is the minimum for GROWTH;
 * a cut targets RETENTION, whose minimum (maintenance volume, MV) sits below
 * MEV. No MV landmark is authored anywhere in the zone config —
 * PROPOSED_MAINTENANCE_VOLUME is a flagged authoring proposal. The hard
 * assertion is therefore goal-aware:
 *   bulk / maintenance / recomp outputs ≥ band MEV
 *   cut outputs                        ≥ proposed MV
 *
 * Under this rule the LIVE preset table is COMPLIANT (pinned empty below) —
 * the previously pinned "seven novice-cut MEV violations" were an artifact
 * of holding cut outputs to the growth floor.
 */

import {
  currentPresetFloorViolations,
  cutFloorPreset,
  derivePresetRecalibration,
  measureCapRatios,
  presetFloor,
  presetFloorViolations,
  proposedOutput,
  PROPOSED_MAINTENANCE_VOLUME,
  EXPERIENCES,
  type Experience,
} from '../presetRecalibration';
import { COARSE_MUSCLES, getEffectiveBand, type CoarseMuscle } from '../volumeBands';
import { recommendVolume } from '../mesocycleBuilder';
import type { Goal } from '@/types/schema';

const seedRatios = measureCapRatios(['bulk', 'cut'], 'seed-convention');
const rows = derivePresetRecalibration(seedRatios);
const proposedFor = (experience: Experience, goal: Goal, group: CoarseMuscle): number => {
  const row = rows.find((r) => r.group === group && r.experience === experience)!;
  return proposedOutput(row.proposedPreset, goal, group);
};

describe('hard assertion (goal-aware): growth outputs ≥ MEV, cut outputs ≥ MV', () => {
  it('the PROPOSED presets are compliant — standard profile', () => {
    expect(presetFloorViolations(proposedFor, 'standard')).toEqual([]);
  });

  it('… and enhanced profile (floors never scale, outputs only rise)', () => {
    expect(presetFloorViolations(proposedFor, 'enhanced')).toEqual([]);
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

describe('live table state under the corrected rule', () => {
  it('the CURRENT presets are compliant — the permanent gate now that v3 is applied', () => {
    expect(currentPresetFloorViolations()).toEqual([]);
  });
});

describe('v3 application acceptance gate', () => {
  it('recommendVolume returns exactly the reviewed proposal for every group × experience', () => {
    for (const row of rows) {
      expect(recommendVolume(row.experience, 'maintenance', row.group)).toBe(row.proposedPreset);
    }
  });
});

describe('placeholder MVs are INERT (gate result, pinned — real authoring deferred)', () => {
  // The glutes/abs/traps/forearms/adductors MVs are declared 0.5×MEV
  // placeholders, acceptable ONLY while they bind nothing. If any assertion
  // here ever fires, a made-up number has started steering a training
  // decision: stop and author a real MV first.
  const PLACEHOLDER_GROUPS = ['glutes', 'abs', 'traps', 'forearms', 'adductors'] as const;

  it('the base floor is always the MEV constraint, never the placeholder cut floor', () => {
    for (const g of PLACEHOLDER_GROUPS) {
      expect(cutFloorPreset(PROPOSED_MAINTENANCE_VOLUME[g])).toBeLessThanOrEqual(
        getEffectiveBand(g).mev
      );
      expect(presetFloor(g)).toBe(getEffectiveBand(g).mev);
    }
  });

  it('no proposal was raised by a placeholder floor', () => {
    for (const row of rows.filter((r) => (PLACEHOLDER_GROUPS as readonly string[]).includes(r.group))) {
      expect(row.proposedPreset).toBeGreaterThanOrEqual(Math.round(row.sameRealDosePreset));
      if (row.floorBinds) {
        // A bind on a placeholder group could only come from MEV (growth
        // floor), never MV — presetFloor equals MEV for these groups.
        expect(row.floor).toBe(getEffectiveBand(row.group).mev);
      }
    }
  });

  it('every applied cut output clears its placeholder MV with margin', () => {
    for (const g of PLACEHOLDER_GROUPS) {
      for (const experience of EXPERIENCES) {
        expect(recommendVolume(experience, 'cut', g)).toBeGreaterThanOrEqual(
          PROPOSED_MAINTENANCE_VOLUME[g] + 1
        );
      }
    }
  });
});

describe('MV proposal sanity (authoring decision pending — values are provisional)', () => {
  it('every proposed MV sits strictly below its group MEV and above zero', () => {
    for (const g of COARSE_MUSCLES) {
      expect(PROPOSED_MAINTENANCE_VOLUME[g]).toBeGreaterThan(0);
      expect(PROPOSED_MAINTENANCE_VOLUME[g]).toBeLessThan(getEffectiveBand(g).mev);
    }
  });

  it('cutFloorPreset is exact: its cut output clears MV, one less does not', () => {
    for (const g of COARSE_MUSCLES) {
      const mv = PROPOSED_MAINTENANCE_VOLUME[g];
      const p = cutFloorPreset(mv);
      expect(Math.round(p * 0.7)).toBeGreaterThanOrEqual(mv);
      expect(Math.round((p - 1) * 0.7)).toBeLessThan(mv);
    }
  });

  it('the base floor is the max of the maintenance-MEV and cut-MV constraints', () => {
    for (const g of COARSE_MUSCLES) {
      expect(presetFloor(g)).toBe(
        Math.max(getEffectiveBand(g).mev, cutFloorPreset(PROPOSED_MAINTENANCE_VOLUME[g]))
      );
    }
  });
});

describe('measurement sanity', () => {
  it('single-member groups the cap cannot bind measure ratio 1', () => {
    for (const g of ['biceps', 'quads', 'hamstrings', 'forearms'] as const) {
      expect(seedRatios[g].ratio).toBe(1);
    }
  });

  it('the known cap-binding groups measure ratio < 1 under seed-convention tags', () => {
    expect(seedRatios.triceps.ratio).toBeLessThan(1);
    expect(seedRatios.calves.ratio).toBeLessThan(1);
  });

  it('ratios are proper fractions', () => {
    for (const g of COARSE_MUSCLES) {
      expect(seedRatios[g].ratio).toBeGreaterThan(0);
      expect(seedRatios[g].ratio).toBeLessThanOrEqual(1);
    }
  });

  it('the derivation covers every group × experience', () => {
    expect(rows).toHaveLength(COARSE_MUSCLES.length * EXPERIENCES.length);
  });

  it('the corrected floors remove the intermediate triceps/calves real-dose increase', () => {
    // The v1 (wrong-floor) proposal raised intermediate triceps 10 → 11 and
    // calves 9.3 → 11 purely to satisfy a growth floor on cut outputs. Under
    // the goal-aware rule those proposals equal the same-real-dose values.
    const tri = rows.find((r) => r.group === 'triceps' && r.experience === 'intermediate')!;
    const cal = rows.find((r) => r.group === 'calves' && r.experience === 'intermediate')!;
    expect(tri.proposedPreset).toBe(Math.round(tri.sameRealDosePreset));
    expect(tri.floorBinds).toBe(false);
    expect(cal.proposedPreset).toBe(Math.round(cal.sameRealDosePreset));
    expect(cal.floorBinds).toBe(false);
  });
});
