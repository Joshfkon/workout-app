/**
 * Reachability gating + fractional-credit agreement for the weekly-volume
 * warning pipeline (bug: warnings claimed 0 sets for trained muscles, and
 * nagged permanently about fine muscles no logged exercise could feed).
 *
 * Covers the ticket's test matrix:
 *   1. Back-extension set (glutes primary, hams+erectors secondary) credits
 *      glutes 1.0 / hamstrings 0.5 / erectors 0.5 in the shared counter.
 *   2. A coarse "back" exercise never leaves erectors permanently at 0.
 *   3. No target muscle warns if unreachable by the user's exercise tagging.
 *   4. Every surface (widget / readiness / progress / warning) that shares the
 *      counter reports the SAME per-muscle sets on one fixture.
 */

import {
  accumulateExerciseVolume,
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  computeWeeklyMevSummary,
  summarizeWeeklyVolume,
  isMuscleWarnable,
  FINE_MUSCLES,
  type VolumeAccumulator,
  type WeeklyVolumeBlockRow,
} from '../weeklyVolume';
import type { StandardMuscleGroup } from '@/types/schema';

/** Build a weekly-volume block row with `workingSets` non-warmup sets. */
function block(
  id: string,
  primary: string | null,
  secondary: string[],
  workingSets: number,
  name = id
): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    set_logs: Array.from({ length: workingSets }, (_, i) => ({ id: `${id}-s${i}`, is_warmup: false })),
  };
}

describe('fractional set credit (shared counter — every surface)', () => {
  it('back-extension set credits glutes 1.0, hamstrings 0.5, erectors 0.5', () => {
    const acc: VolumeAccumulator = {};
    accumulateExerciseVolume(
      acc,
      { id: 'be', name: 'Back Extension', primary_muscle: 'glutes', secondary_muscles: ['hamstrings', 'erectors'] },
      1
    );

    expect(acc.glutes.sets).toBeCloseTo(1.0, 6);
    expect(acc.hamstrings.sets).toBeCloseTo(0.5, 6);
    expect(acc.erectors.sets).toBeCloseTo(0.5, 6);
    // The debug breakdown records the exercise that fed each muscle.
    expect(Array.from(acc.erectors.exercises.values())[0]).toMatchObject({ name: 'Back Extension' });
  });

  it('scales linearly with working sets (3 sets → 1.5 secondary credit)', () => {
    const acc: VolumeAccumulator = {};
    accumulateExerciseVolume(
      acc,
      { id: 'be', name: 'Back Extension', primary_muscle: 'glutes', secondary_muscles: ['hamstrings', 'erectors'] },
      3
    );
    expect(acc.glutes.sets).toBeCloseTo(3.0, 6);
    expect(acc.hamstrings.sets).toBeCloseTo(1.5, 6);
    expect(acc.erectors.sets).toBeCloseTo(1.5, 6);
  });
});

describe('reachability gating (never warn on an unsatisfiable muscle)', () => {
  it('a coarse "back" exercise never leaves erectors stuck below MEV at 0', () => {
    // A user whose only back work is a coarse 'back'-tagged exercise: the
    // resolver credits lats + upper_back, never erectors.
    const blocks = [block('row', 'back', [], 6, 'Barbell Row')];
    const reachable = computeReachableMuscles(blocks);

    expect(reachable.has('lats')).toBe(true);
    expect(reachable.has('upper_back')).toBe(true);
    expect(reachable.has('erectors')).toBe(false);

    const summary = summarizeWeeklyVolume(blocks)!;
    // erectors must NOT appear as a permanently-un-clearable 0/4 warning.
    expect(summary.entries.some((e) => e.muscle === 'erectors')).toBe(false);
  });

  it('drops every unreachable fine muscle from the summary', () => {
    // Purely coarse data: 'glutes', 'abs', 'back' — none feed glute_med /
    // obliques / erectors.
    const blocks = [
      block('ht', 'glutes', ['hamstrings'], 4, 'Hip Thrust'),
      block('cr', 'abs', [], 4, 'Cable Crunch'),
      block('row', 'back', [], 6, 'Barbell Row'),
    ];
    const reachable = computeReachableMuscles(blocks);
    const summary = summarizeWeeklyVolume(blocks)!;

    for (const fine of FINE_MUSCLES) {
      if (!reachable.has(fine)) {
        expect(summary.entries.some((e) => e.muscle === fine)).toBe(false);
      }
    }
  });

  it('KEEPS a fine muscle when the user has a fine-tagged exercise for it', () => {
    // Same coarse work PLUS one direct glute-med exercise → glute_med becomes
    // reachable and its below-MEV warning is legitimate again.
    const blocks = [
      block('ht', 'glutes', ['hamstrings'], 4, 'Hip Thrust'),
      block('ab', 'glute_med', [], 1, 'Cable Hip Abduction'),
    ];
    const reachable = computeReachableMuscles(blocks);
    expect(reachable.has('glute_med')).toBe(true);

    const summary = summarizeWeeklyVolume(blocks)!;
    const gm = summary.entries.find((e) => e.muscle === 'glute_med');
    expect(gm).toBeDefined();
    // 1 set < MEV(2) → still flagged, but now it's clearable.
    expect(gm).toMatchObject({ sets: 1, belowMev: true });
  });

  it('coarse muscles are always warnable; fine muscles gate on reachability', () => {
    const reachable = new Set<StandardMuscleGroup>(['lats', 'glutes']);
    expect(isMuscleWarnable('quads', reachable)).toBe(true); // coarse-reachable always
    expect(isMuscleWarnable('erectors', reachable)).toBe(false); // fine + unreachable
    expect(isMuscleWarnable('glute_med', new Set<StandardMuscleGroup>(['glute_med']))).toBe(true);
    // No reachability info → preserve legacy "warn on all" behaviour.
    expect(isMuscleWarnable('erectors', undefined)).toBe(true);
  });
});

describe('cross-surface agreement on one fixture', () => {
  // One week: an RDL and a back extension. Both credit erectors as secondary.
  const blocks = [
    block('rdl', 'hamstrings', ['glutes', 'erectors', 'forearms', 'traps'], 2, 'Romanian Deadlift'),
    block('be', 'glutes', ['hamstrings', 'erectors'], 3, 'Back Extension'),
  ];

  /** Readiness-sheet counting: the hook folds the SAME blocks through the SAME
   *  shared accumulator (see useMuscleReadiness.weeklySetsByMuscle). */
  function readinessSetsByMuscle(rows: WeeklyVolumeBlockRow[]): Record<string, number> {
    const acc: VolumeAccumulator = {};
    for (const b of rows) {
      const ex = b.exercises!;
      const working = (b.set_logs || []).filter((s) => !s.is_warmup).length;
      accumulateExerciseVolume(acc, ex, working);
    }
    const out: Record<string, number> = {};
    for (const [m, data] of Object.entries(acc)) out[m] = Math.round(data.sets);
    return out;
  }

  it('widget/warning stats and readiness counts report identical per-muscle sets', () => {
    const stats = computeWeeklyMuscleVolume(blocks); // widget + warning source
    const statsByMuscle: Record<string, number> = {};
    for (const s of stats) statsByMuscle[s.muscle] = s.sets;

    const readiness = readinessSetsByMuscle(blocks);

    // Every muscle either surface reports must match the other exactly.
    const muscles = Array.from(new Set([...Object.keys(statsByMuscle), ...Object.keys(readiness)]));
    for (const m of muscles) {
      expect(readiness[m] ?? 0).toBe(statsByMuscle[m] ?? 0);
    }

    // And the summary the warning renders carries those same trained counts.
    const summary = computeWeeklyMevSummary(stats, computeReachableMuscles(blocks))!;
    for (const s of stats) {
      const entry = summary.entries.find((e) => e.muscle === s.muscle)!;
      expect(entry.sets).toBe(s.sets);
    }
  });

  it('erectors is credited (not 0) and its warning lists the exercises that fed it', () => {
    const summary = summarizeWeeklyVolume(blocks)!;
    const erectors = summary.entries.find((e) => e.muscle === 'erectors');
    expect(erectors).toBeDefined();
    // 2×0.5 + 3×0.5 = 2.5 → rounds to 3 credited sets, NOT 0.
    expect(erectors!.sets).toBeGreaterThan(0);
    // Breakdown names both contributors so a miscount is visible.
    const names = erectors!.exercises.map((e) => e.name).sort();
    expect(names).toEqual(['Back Extension', 'Romanian Deadlift']);
  });
});
