/**
 * Target ≤ MRV invariant between the generator's volume presets
 * (mesocycleBuilder.recommendVolume) and the tracking card's coarse bands
 * (RESEARCH_VOLUME_BANDS) — the guard demanded by the convention-conversion
 * review: a preset target above the band's MRV recreates the
 * "target-above-zone" contradiction the shoulders audit started from, except
 * for real (the card would show a red bar at the program's own prescription).
 *
 * Scope: raw presets per muscle × experience (the tables as written). Goal
 * multipliers are covered separately below — bulk ×1.1 currently pushes ONE
 * cell over the ceiling (a live pre-existing violation, pinned exactly); the
 * conversion pass retires it by clamping the goal-adjusted target to the
 * band MRV, at which point the exception pin below must be replaced with a
 * universal assertion.
 */

import { recommendVolume } from '@/services/mesocycleBuilder';
import { RESEARCH_VOLUME_BANDS, COARSE_MUSCLES } from '../weeklyVolume';
import type { Experience, Goal } from '@/types/schema';

/** The muscles recommendVolume carries presets for (its baseVolumes keys). */
const PRESET_MUSCLES = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
] as const;
const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];
const GOALS: Goal[] = ['cut', 'maintenance', 'bulk'];

describe('preset target ≤ band MRV (muscle × experience)', () => {
  it.each(
    PRESET_MUSCLES.flatMap((m) => EXPERIENCES.map((e): [string, Experience] => [m, e]))
  )('%s @ %s: raw preset fits inside the tracking band', (muscle, experience) => {
    // 'maintenance' applies no goal multiplier — this is the raw table value.
    const preset = recommendVolume(experience, 'maintenance', muscle);
    const band = RESEARCH_VOLUME_BANDS[muscle as keyof typeof RESEARCH_VOLUME_BANDS];
    expect(band).toBeDefined();
    expect(preset).toBeLessThanOrEqual(band.mrv);
    // NOTE: no preset ≥ band.MEV assertion yet — shoulders' band is already
    // total-inclusive ({12,26}) while its preset is still a direct number
    // (novice 10), so a low-side check only becomes coherent once the
    // conversion pass moves the presets into the same currency. Add it then.
  });
});

describe('goal-adjusted targets vs the band ceiling', () => {
  const violations = PRESET_MUSCLES.flatMap((muscle) =>
    EXPERIENCES.flatMap((experience) =>
      GOALS.filter(
        (goal) =>
          recommendVolume(experience, goal, muscle) >
          RESEARCH_VOLUME_BANDS[muscle as keyof typeof RESEARCH_VOLUME_BANDS].mrv
      ).map((goal) => `${muscle}/${experience}/${goal}`)
    )
  );

  it('exactly one KNOWN pre-existing violation: glutes advanced ×1.1 bulk (18 > band 16) — retired by the conversion-time clamp, at which point this pin must become an empty-list assertion', () => {
    expect(violations).toEqual(['glutes/advanced/bulk']);
    expect(recommendVolume('advanced', 'bulk', 'glutes')).toBe(18);
  });
});

describe('band self-consistency', () => {
  it.each(COARSE_MUSCLES.map((m): [string] => [m]))('%s: MEV < MRV', (muscle) => {
    const band = RESEARCH_VOLUME_BANDS[muscle as keyof typeof RESEARCH_VOLUME_BANDS];
    expect(band.mev).toBeLessThan(band.mrv);
  });
});
