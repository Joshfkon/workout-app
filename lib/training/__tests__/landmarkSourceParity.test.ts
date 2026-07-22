/**
 * Landmark-source ARITHMETIC parity (enforcement-hole fix).
 *
 * The symbol-list import guard only catches parallel landmark sources you
 * already know the names of — which is exactly how the retired
 * ENHANCED_SCALING table (rollover landmarks at MEV ×1.10) slipped past 3b.
 * This suite inverts the enforcement: it asserts the VALUES every landmark
 * consumer uses agree with the single derivation in services/volumeBands,
 * for every (muscle, experience, profile) combination — so a future parallel
 * table fails on arithmetic, whatever it is called.
 */

import { resolveVolumeLandmarks } from '../weeklyRollover';
import {
  applyRecoveryProfileToLandmarks,
  getEffectiveBand,
  COARSE_MUSCLES,
} from '@/services/volumeBands';
import { DEFAULT_VOLUME_LANDMARKS, STANDARD_MUSCLE_GROUPS } from '@/types/schema';
import type { Experience } from '@/types/schema';

const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];

describe('rollover landmarks agree with the single profile derivation', () => {
  it.each(EXPERIENCES.map((e): [Experience] => [e]))(
    '%s: enhanced landmarks = applyRecoveryProfileToLandmarks(base) for every standard muscle',
    (experience) => {
      const standard = resolveVolumeLandmarks(experience, null, false);
      const enhanced = resolveVolumeLandmarks(experience, null, true);
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        expect(enhanced[muscle]).toEqual(
          applyRecoveryProfileToLandmarks(standard[muscle], muscle, {
            recoveryProfile: 'enhanced',
          })
        );
        // The invariant the retired table violated: enhanced NEVER raises MEV.
        expect(enhanced[muscle].mev).toBe(standard[muscle].mev);
        // And the ceiling never shrinks.
        expect(enhanced[muscle].mrv).toBeGreaterThanOrEqual(standard[muscle].mrv);
      }
    }
  );

  it('custom-landmark overlays scale through the same derivation', () => {
    const custom = { quads: { mev: 9, mav: 15, mrv: 21 } };
    const enhanced = resolveVolumeLandmarks('intermediate', custom, true);
    expect(enhanced.quads).toEqual(
      applyRecoveryProfileToLandmarks(custom.quads, 'quads', { recoveryProfile: 'enhanced' })
    );
  });
});

describe('the derivation is arithmetically tied to getEffectiveBand', () => {
  it('scaling the standard band through the landmark derivation reproduces the enhanced band, every coarse muscle', () => {
    for (const muscle of COARSE_MUSCLES) {
      const standardBand = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhancedBand = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      const viaLandmarks = applyRecoveryProfileToLandmarks(
        { mev: standardBand.mev, mav: standardBand.mev, mrv: standardBand.mrv },
        muscle,
        { recoveryProfile: 'enhanced' }
      );
      // Same multiplier table, same rounding — a second table breaks this.
      expect(viaLandmarks.mrv).toBe(enhancedBand.mrv);
      expect(viaLandmarks.mev).toBe(enhancedBand.mev);
    }
  });

  it('per-standard-muscle scaling matches the fine effective bands too', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const standardBand = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhancedBand = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      const viaLandmarks = applyRecoveryProfileToLandmarks(
        { mev: standardBand.mev, mav: standardBand.mev, mrv: standardBand.mrv },
        muscle,
        { recoveryProfile: 'enhanced' }
      );
      expect(viaLandmarks.mrv).toBe(enhancedBand.mrv);
      expect(viaLandmarks.mev).toBe(enhancedBand.mev);
    }
  });
});

describe('fatigue-integrated generator respects the effective ceilings (live path)', () => {
  // sessionBuilderWithFatigue used to carry its own (dead, silently-fallback)
  // DEFAULT_VOLUME_LANDMARKS read; it is deleted, and the live volume source
  // (mesocycleBuilder.calculateVolumeDistribution) is pinned here by VALUE:
  // weekly per-muscle sets never exceed getEffectiveBand's MRV, both profiles.
  const profiles: Array<['standard' | 'enhanced', boolean]> = [
    ['standard', false],
    ['enhanced', true],
  ];

  // The credited-currency check (Codex review, 48c5cbe): volumePerMuscle
  // respecting the ceiling is necessary but not sufficient — the BUILT
  // sessions' credited totals (primary splits + 0.5 secondary credit, the
  // currency the tracking card counts in) must also stay at or under the
  // effective group MRV, else a fresh plan starts in the red zone.
  const creditedGroupTotals = (
    sessions: Array<{ exercises: Array<{ exercise: { primaryMuscle: string; secondaryMuscles?: string[] }; sets: number }> }>
  ): Map<string, number> => {
    const { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } = require('@/services/volumeTracker');
    const { resolveMuscleToStandard } = require('@/types/schema');
    const { STANDARD_TO_COARSE } = require('@/services/volumeBands');
    const totals = new Map<string, number>();
    const add = (std: string, v: number) => {
      const coarse = STANDARD_TO_COARSE[std];
      if (!coarse) return;
      totals.set(coarse, (totals.get(coarse) ?? 0) + v);
    };
    for (const session of sessions) {
      for (const ex of session.exercises) {
        const credits = resolvePrimaryMuscleCredits(ex.exercise.primaryMuscle) as Array<{ muscle: string; weight: number }>;
        const primarySet = new Set(credits.map((c) => c.muscle));
        for (const { muscle, weight } of credits) add(muscle, ex.sets * weight);
        for (const secondary of ex.exercise.secondaryMuscles ?? []) {
          const standards = resolveMuscleToStandard(secondary) as string[];
          if (standards.length === 0) continue;
          const per = SECONDARY_MUSCLE_CREDIT / standards.length;
          for (const std of standards) {
            if (primarySet.has(std)) continue;
            add(std, ex.sets * per);
          }
        }
      }
    }
    return totals;
  };

  const DAYS: number[] = [4, 6];

  it.each(profiles.flatMap(([p, e]) => DAYS.map((d): ['standard' | 'enhanced', boolean, number] => [p, e, d])))(
    '%s profile (enhanced=%s), %i-day: built week-1 sessions credit ≤ effective group MRV',
    (recoveryProfile, enhancedAthleteMode, daysPerWeek) => {
      const { generateFullMesocycleWithFatigue } = require('@/services/sessionBuilderWithFatigue');
      const profile = {
        goal: 'bulk',
        experience: 'intermediate',
        heightCm: 175,
        latestDexa: null,
        age: 30,
        sleepQuality: 3,
        stressLevel: 3,
        trainingAge: 2,
        availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'],
        injuryHistory: [],
        enhancedAthleteMode,
      };
      const program = generateFullMesocycleWithFatigue(daysPerWeek, profile, 60);
      const totals = creditedGroupTotals(program.sessions);
      const overCeiling: Array<{ group: string; credited: number; mrv: number }> = [];
      for (const [group, credited] of Array.from(totals.entries())) {
        const band = getEffectiveBand(group as Parameters<typeof getEffectiveBand>[0], { recoveryProfile });
        // Same tolerance as the equilibrium gate: overshoot < 1 credited set
        // is rounding noise, >= 1 is a real over-ceiling start.
        if (credited - band.mrv >= 1) overCeiling.push({ group, credited, mrv: band.mrv });
      }
      expect(overCeiling).toEqual([]);
    }
  );

  it.each(profiles)('%s profile: volumePerMuscle ≤ effective MRV per coarse muscle', (recoveryProfile, enhancedAthleteMode) => {
    // Lazy require keeps the heavy generator out of the suites above.
    const { generateFullMesocycleWithFatigue } = require('@/services/sessionBuilderWithFatigue');
    const profile = {
      goal: 'bulk',
      experience: 'intermediate',
      heightCm: 175,
      latestDexa: null,
      age: 30,
      sleepQuality: 3,
      stressLevel: 3,
      trainingAge: 2,
      availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'],
      injuryHistory: [],
      enhancedAthleteMode,
    };
    const program = generateFullMesocycleWithFatigue(4, profile, 60);
    const overCeiling: Array<{ muscle: string; sets: number; mrv: number }> = [];
    for (const [muscle, vol] of Object.entries(program.volumePerMuscle) as Array<
      [Parameters<typeof getEffectiveBand>[0], { sets: number }]
    >) {
      const band = getEffectiveBand(muscle, { recoveryProfile });
      if (vol.sets > band.mrv) overCeiling.push({ muscle, sets: vol.sets, mrv: band.mrv });
    }
    expect(overCeiling).toEqual([]);
  });
});

describe('base landmark tables stay self-consistent', () => {
  it('DEFAULT_VOLUME_LANDMARKS: mev ≤ mav ≤ mrv everywhere', () => {
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        const lm = DEFAULT_VOLUME_LANDMARKS[experience][muscle];
        expect(lm.mev).toBeLessThanOrEqual(lm.mav);
        expect(lm.mav).toBeLessThanOrEqual(lm.mrv);
      }
    }
  });
});
