/**
 * Target ≤ MRV invariants between the generator's volume presets
 * (mesocycleBuilder.recommendVolume) and the effective bands
 * (volumeBands.getEffectiveBand) — parametrized across the FULL
 * muscle × experience × goal × recovery-profile matrix (close-out 3d).
 *
 * History: before the convention conversion, glutes/advanced/bulk shipped a
 * live 18 > 16 violation; the goal-clamp retired it and this suite keeps the
 * whole class extinct — in both recovery profiles.
 */

import { recommendVolume } from '@/services/mesocycleBuilder';
import {
  COARSE_MUSCLES,
  getEffectiveBand,
  ENHANCED_MRV_MULTIPLIERS,
  type CoarseMuscle,
  type RecoveryProfile,
} from '@/services/volumeBands';
import { STANDARD_MUSCLE_GROUPS } from '@/types/schema';
import type { Experience, Goal } from '@/types/schema';

/** The muscles recommendVolume carries presets for (its baseVolumes keys). */
const PRESET_MUSCLES = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'traps',
] as const;
const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];
const GOALS: Goal[] = ['cut', 'maintenance', 'bulk'];
const PROFILES: RecoveryProfile[] = ['standard', 'enhanced'];

describe.each(PROFILES.map((p): [RecoveryProfile] => [p]))('profile: %s', (profile) => {
  const enhanced = profile === 'enhanced';
  const ctx = { recoveryProfile: profile };

  it.each(
    PRESET_MUSCLES.flatMap((m) => EXPERIENCES.map((e): [string, Experience] => [m, e]))
  )('%s @ %s: preset sits inside the effective band', (muscle, experience) => {
    // 'maintenance' applies no goal multiplier — the profile-adjusted table value.
    const preset = recommendVolume(experience, 'maintenance', muscle, enhanced);
    const band = getEffectiveBand(muscle as CoarseMuscle, ctx);
    expect(preset).toBeLessThanOrEqual(band.mrv);
    // Low-side: a MAV-ish target below the band's own MEV is equally incoherent.
    expect(preset).toBeGreaterThanOrEqual(band.mev);
  });

  it('NO muscle × experience × goal combination exceeds the effective band ceiling', () => {
    const violations = PRESET_MUSCLES.flatMap((muscle) =>
      EXPERIENCES.flatMap((experience) =>
        GOALS.filter(
          (goal) =>
            recommendVolume(experience, goal, muscle, enhanced) >
            getEffectiveBand(muscle as CoarseMuscle, ctx).mrv
        ).map((goal) => `${muscle}/${experience}/${goal}`)
      )
    );
    expect(violations).toEqual([]);
  });

  it('bands are self-consistent (MEV < MRV) for every coarse and standard muscle', () => {
    for (const muscle of COARSE_MUSCLES) {
      const band = getEffectiveBand(muscle, ctx);
      expect(band.mev).toBeLessThan(band.mrv);
    }
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const band = getEffectiveBand(muscle, ctx);
      expect(band.mev).toBeLessThan(band.mrv);
    }
  });
});

describe('enhanced-profile invariants (3c pins)', () => {
  it('enhanced MEV NEVER exceeds standard MEV — any muscle, coarse or standard', () => {
    for (const muscle of [...COARSE_MUSCLES, ...STANDARD_MUSCLE_GROUPS]) {
      const standard = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhanced = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      expect(enhanced.mev).toBeLessThanOrEqual(standard.mev);
      // Stronger: the tiers scale MRV only, so MEVs are identical.
      expect(enhanced.mev).toBe(standard.mev);
    }
  });

  it('enhanced MRV = tier × standard MRV at 0.5-set granularity, and never below standard', () => {
    for (const muscle of COARSE_MUSCLES) {
      const standard = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhanced = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      const tier = ENHANCED_MRV_MULTIPLIERS[muscle];
      expect(enhanced.mrv).toBe(Math.round(standard.mrv * tier * 2) / 2);
      expect(enhanced.mrv).toBeGreaterThanOrEqual(standard.mrv);
      // 0.5-set granularity max.
      expect(enhanced.mrv * 2).toBe(Math.round(enhanced.mrv * 2));
    }
  });

  it('enhanced preset shift is at most +10% — always less than the smallest MRV tier (1.15)', () => {
    for (const muscle of PRESET_MUSCLES) {
      for (const experience of EXPERIENCES) {
        const standard = recommendVolume(experience, 'maintenance', muscle, false);
        const enhanced = recommendVolume(experience, 'maintenance', muscle, true);
        expect(enhanced).toBeLessThanOrEqual(Math.round(standard * 1.1));
        expect(enhanced).toBeGreaterThanOrEqual(standard);
      }
    }
  });
});
