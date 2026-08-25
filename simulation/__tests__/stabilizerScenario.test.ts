/**
 * STABILIZER_WARNING — deterministic acceptance scenario (approved spec).
 *
 *   Day 1: heavy back extensions (erectors loaded as a secondary mover).
 *   Day 2: barbell row at 90% of its reference load → the erector stabilizer
 *          warning FIRES.
 *          barbell row at 60%                        → no warning.
 *          curls                                     → no warning (no
 *          stabilizer requirement — prime-mover fatigue alone never warns).
 *
 * Harness rules respected: every number comes from production —
 * exercise tags from the seeded catalog (SEED_EXERCISE_TAGS /
 * stabilizersForExerciseName), recovery + trigger from
 * services/muscleRecovery. The test contributes composition and primitive
 * assertions only.
 */
import {
  computeStabilizerRecovery,
  evaluateStabilizerWarning,
  requiredStabilizersFor,
  stabilizerReferenceLoadKg,
  RECOVERY_CONFIG,
  type RecoverySession,
} from '@/services/muscleRecovery';
import { stabilizersForExerciseName } from '@/services/shared/stabilizerTags';
import { SEED_EXERCISE_TAGS } from '@/services/generated/seedExerciseTags';

const DAY1 = new Date('2026-04-06T09:00:00.000Z');
const DAY2 = new Date('2026-04-07T09:00:00.000Z');

/** A logged exercise shaped exactly as the recovery feed shapes it, with tags
 *  taken from the seeded catalog rather than restated here. */
function loggedExercise(name: string, sets: number, repsInTank: number) {
  const tags = SEED_EXERCISE_TAGS[name];
  if (!tags) throw new Error(`not a stock exercise: ${name}`);
  return {
    primaryMuscle: tags.primary,
    secondaryMuscles: tags.secondaries,
    stabilizers: stabilizersForExerciseName(name) ?? [],
    sets: Array.from({ length: sets }, () => ({ repsInTank })),
  };
}

const heavyBackExtensionDay: RecoverySession = {
  performedAt: DAY1,
  exercises: [loggedExercise('Back Extension', 5, 1)],
};

/** The row's reference: its previous top working set. */
const ROW_REFERENCE_KG = stabilizerReferenceLoadKg(100, null);

describe('STABILIZER_WARNING scenario', () => {
  const erectorsOnDay2 = computeStabilizerRecovery([heavyBackExtensionDay], 'erectors', DAY2);

  it('setup: the day-1 hinge leaves the erector stabilizer channel fatigued on day 2', () => {
    expect(erectorsOnDay2.status).toBe('fatigued');
    expect(erectorsOnDay2.readinessRatio).toBeLessThan(
      RECOVERY_CONFIG.stabilizerReadinessThreshold
    );
  });

  it('setup: the seeded catalog says a barbell row requires erectors + forearms', () => {
    expect(
      requiredStabilizersFor({ stabilizers: stabilizersForExerciseName('Barbell Row') })
    ).toEqual(['erectors', 'forearms']);
  });

  it('row at 90% on day 2 → the erector warning fires', () => {
    const warning = evaluateStabilizerWarning({
      muscle: 'erectors',
      recovery: erectorsOnDay2,
      plannedLoadKg: 90,
      referenceLoadKg: ROW_REFERENCE_KG,
    });
    expect(warning).not.toBeNull();
    expect(warning!.muscle).toBe('erectors');
    expect(warning!.intensityRatio).toBeCloseTo(0.9);
  });

  it('row at 60% on day 2 → silent (intensity gate)', () => {
    expect(
      evaluateStabilizerWarning({
        muscle: 'erectors',
        recovery: erectorsOnDay2,
        plannedLoadKg: 60,
        referenceLoadKg: ROW_REFERENCE_KG,
      })
    ).toBeNull();
  });

  it('the untouched forearm stabilizer never warns, even on a heavy row', () => {
    const forearmsOnDay2 = computeStabilizerRecovery([heavyBackExtensionDay], 'forearms', DAY2);
    expect(forearmsOnDay2.status).toBe('fresh');
    expect(
      evaluateStabilizerWarning({
        muscle: 'forearms',
        recovery: forearmsOnDay2,
        plannedLoadKg: 90,
        referenceLoadKg: ROW_REFERENCE_KG,
      })
    ).toBeNull();
  });

  it('curls on day 2 → no warning: no stabilizer requirement exists to evaluate', () => {
    // The seeded catalog deliberately leaves curls without stabilizer tags
    // (the standing-barbell question is on the unsure list), so the warning
    // pipeline never evaluates them — prime-mover fatigue alone cannot warn.
    for (const curl of ['Dumbbell Curl', 'Barbell Curl', 'Machine Bicep Curl']) {
      expect(
        requiredStabilizersFor({ stabilizers: stabilizersForExerciseName(curl) ?? [] })
      ).toEqual([]);
    }
  });

  it('a brand-new exercise (no reference load) never warns — missing-anchor rule', () => {
    expect(stabilizerReferenceLoadKg(null, null)).toBeNull();
    expect(
      evaluateStabilizerWarning({
        muscle: 'erectors',
        recovery: erectorsOnDay2,
        plannedLoadKg: 90,
        referenceLoadKg: null,
      })
    ).toBeNull();
  });
});
