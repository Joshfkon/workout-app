/**
 * Allocator × rollover equilibrium (close-out item 4).
 *
 * The generator's indirect-aware allocator and the weekly rollover must not
 * churn: a program the allocator just converged (credited totals at their
 * targets) fed back through the rollover as a completed NO-PROGRESS week
 * (all sets done, no feedback logged, no landmark changes) must produce
 * ZERO volume additions or reductions — otherwise the pair add/trim the same
 * sets week over week. Verified across all three representative templates.
 *
 * The second block PINS a known, real disagreement (reported, not papered
 * over): with positive recovery feedback the rollover ramps PER-STANDARD
 * muscles against PER-STANDARD landmarks, with no group-level band budget —
 * so side delts +1 AND rear delts +1 in the same week push the shoulders
 * group's credited total to 26.5, past the band MRV 26 the generator just
 * clamped to (U/L 4d and PPL 6d; Full Body 3d stays inside). Fixing it means
 * giving planWeeklySetAdjustments a group-aware add budget (collective adds
 * capped at the coarse band MRV) — a behavior change requiring sign-off.
 * When that lands, the pins below must become empty-list assertions.
 */

import { generateFullProgram } from '@/services/mesocycleBuilder';
import {
  computeWeeklySetsByMuscle,
  planWeeklySetAdjustments,
  resolveVolumeLandmarks,
  type RolloverSession,
} from '../weeklyRollover';
import {
  getEffectiveBand,
  STANDARD_TO_COARSE,
  type CoarseMuscle,
} from '@/services/volumeBands';
import type { MuscleWeekFeedback } from '@/services/weeklyProgressionEngine';
import type { ExtendedUserProfile, Rating, StandardMuscleGroup } from '@/types/schema';

function profileFor(enhanced: boolean): ExtendedUserProfile {
  return {
    goal: 'bulk',
    experience: 'intermediate',
    heightCm: 175,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: 2,
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'],
    injuryHistory: [],
    enhancedAthleteMode: enhanced,
  };
}

function generatedWeek(days: number, enhanced: boolean): RolloverSession[] {
  return generateFullProgram(days, profileFor(enhanced), 60).sessions.map((s) => ({
    exercises: s.exercises.map((e) => ({
      exerciseName: e.exercise.name,
      primaryMuscle: e.exercise.primaryMuscle,
      secondaryMuscles: e.exercise.secondaryMuscles ?? [],
      sets: e.sets,
    })),
  }));
}

describe.each([
  ['standard', 3], ['standard', 4], ['standard', 6],
  ['enhanced', 3], ['enhanced', 4], ['enhanced', 6],
] as ['standard' | 'enhanced', number][])('%s / %sd template', (recoveryProfile, days) => {
  const enhanced = recoveryProfile === 'enhanced';
  const weekSessions = generatedWeek(days, enhanced);
  const landmarks = resolveVolumeLandmarks('intermediate', null, enhanced);

  it('fixed point: a completed no-progress week produces zero adjustments', () => {
    const plan = planWeeklySetAdjustments({
      weekSessions,
      feedbackByMuscle: new Map(),
      trendByMuscle: new Map(),
      landmarksByMuscle: landmarks,
      weekInMeso: 2,
      isDeloadWeek: false,
      enhancedAthleteMode: enhanced,
    });
    expect(plan.byExercise.size).toBe(0);
    expect(plan.summary.every((s) => s.action === 'hold')).toBe(true);
  });

  it('pinned disagreement: with positive feedback, per-standard adds have no group band budget (shoulders on 4d/6d)', () => {
    const good: MuscleWeekFeedback = { sorenessBefore: 1, pump: 2, workload: 1 };
    const counted = computeWeeklySetsByMuscle(weekSessions);
    const feedbackByMuscle = new Map<StandardMuscleGroup, MuscleWeekFeedback[]>();
    for (const muscle of Array.from(counted.keys())) feedbackByMuscle.set(muscle, [good]);

    const plan = planWeeklySetAdjustments({
      weekSessions,
      feedbackByMuscle,
      trendByMuscle: new Map(),
      landmarksByMuscle: landmarks,
      weekInMeso: 2,
      isDeloadWeek: false,
      enhancedAthleteMode: enhanced,
    });

    const deltaByGroup = new Map<CoarseMuscle, number>();
    for (const adj of Array.from(plan.byExercise.values())) {
      const coarse = STANDARD_TO_COARSE[adj.muscle];
      deltaByGroup.set(coarse, (deltaByGroup.get(coarse) ?? 0) + adj.delta);
    }
    const totalByGroup = new Map<CoarseMuscle, number>();
    for (const [std, sets] of Array.from(counted.entries())) {
      const coarse = STANDARD_TO_COARSE[std];
      if (coarse) totalByGroup.set(coarse, (totalByGroup.get(coarse) ?? 0) + sets);
    }
    const groupsPushedPastBand = Array.from(deltaByGroup.entries())
      .filter(
        ([group, delta]) =>
          (totalByGroup.get(group) ?? 0) + delta >
          getEffectiveBand(group, { recoveryProfile }).mrv
      )
      .map(([group]) => group)
      .sort();

    // Pins: STANDARD 4d/6d push shoulders past the band (side +1 AND rear +1
    // in one week, no group budget); the ENHANCED shoulders ceiling (×1.35 →
    // 35) absorbs the same adds, so no bust in that profile. The group-aware
    // add budget (awaiting sign-off) flips these to empty lists.
    const expected = !enhanced && days !== 3 ? ['shoulders'] : [];
    expect(groupsPushedPastBand).toEqual(expected);
  });
});
