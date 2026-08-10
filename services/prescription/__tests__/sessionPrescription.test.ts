/**
 * Tests for the extracted prescription assembly (services/prescription).
 *
 * The centrepiece is the EQUIVALENCE suite: `nextSetPrescription` must produce
 * byte-identical output to the assembly that used to live inline in
 * ExerciseCard, which is reproduced verbatim below as `legacyRecommendNext`.
 *
 * That framing is deliberate. Asserting specific weights and reps here would
 * mostly re-test `recommendSet`, which has its own suites and its own pinned
 * regression baseline. What this extraction could plausibly break is the
 * ASSEMBLY — a dropped input, an RIR resolved from the wrong source, a
 * position offset applied to the wrong count — and every one of those shows up
 * as a divergence from the legacy copy across enough scenarios.
 *
 * If a future engine change makes both sides move together, these still pass;
 * that is correct, because this file is about the wiring, not the rules.
 */
import {
  nextSetPrescription,
  sessionBestE1RM,
  lastSessionE1RM,
  coldStartE1RM,
  toPrevSessionSets,
  repTotalNextSetAt,
  type PrescriptionSet,
  type PrescriptionExercise,
} from '@/services/prescription/sessionPrescription';
import { recommendSet, resolveLastRir } from '@/services/setRecommender';
import {
  recommendRepTotalSessionStart,
  recommendRepTotalNextSet,
} from '@/services/suggestionEngine/repTotalPolicy';
import { rpeToRir, type ExerciseType, type SetFeedback } from '@/types/schema';

// ---------------------------------------------------------------------------
// The pre-extraction assembly, copied verbatim from ExerciseCard.
// ---------------------------------------------------------------------------

function legacySessionBestE1RM(
  completedSets: PrescriptionSet[],
  effectiveTargetRir: number,
  exerciseType?: ExerciseType
) {
  if (exerciseType === 'duration_based') return undefined;
  let best = 0;
  for (const s of completedSets) {
    if (s.weightKg > 0 && s.reps > 0) {
      const rir = resolveLastRir(s, effectiveTargetRir);
      const e = s.weightKg * (1 + (s.reps + rir) / 30);
      if (e > best) best = e;
    }
  }
  return best > 0 ? best : undefined;
}

function legacyRecommendNext(args: {
  last: PrescriptionSet;
  positionOffset?: number;
  completedSets: PrescriptionSet[];
  previousSets: PrescriptionSet[];
  targetRepRange: [number, number];
  effectiveTargetRir: number;
  exercise: PrescriptionExercise;
  isColdStartExercise: boolean;
  plannedSetCount: number;
}) {
  const {
    last,
    positionOffset = 0,
    completedSets,
    previousSets,
    targetRepRange,
    effectiveTargetRir,
    exercise,
    isColdStartExercise,
    plannedSetCount,
  } = args;

  const prevSessionSetsForGating = previousSets
    .filter((s) => s.weightKg > 0 && s.reps > 0)
    .map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : undefined,
    }));

  return recommendSet({
    lastWeightKg: last.weightKg,
    lastReps: last.reps,
    lastRir: resolveLastRir(last, effectiveTargetRir),
    setsCompletedThisExercise: completedSets.length + positionOffset,
    sessionBestE1RMKg: legacySessionBestE1RM(
      completedSets,
      effectiveTargetRir,
      exercise.exerciseType
    ),
    targetRepRange,
    targetRir: effectiveTargetRir,
    minIncrementKg: exercise.minWeightIncrementKg,
    availableIncrementsKg: exercise.availableIncrementsKg ?? undefined,
    coldStart: isColdStartExercise,
    exerciseType: exercise.exerciseType,
    isBodyweight: exercise.isBodyweight,
    sessionObservedSets: completedSets.map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: resolveLastRir(s, effectiveTargetRir),
    })),
    positionContext: {
      prevSessionSets: prevSessionSetsForGating,
      todaySets: completedSets.map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
      plannedSetCount,
    },
  });
}

// ---------------------------------------------------------------------------
// Scenario matrix
// ---------------------------------------------------------------------------

const barbell: PrescriptionExercise = { minWeightIncrementKg: 2.5 };
const dumbbell: PrescriptionExercise = { availableIncrementsKg: [2, 1] };
const bodyweight: PrescriptionExercise = { isBodyweight: true, minWeightIncrementKg: 2.5 };

const set = (weightKg: number, reps: number, rpe?: number): PrescriptionSet => ({
  weightKg,
  reps,
  ...(rpe != null ? { rpe } : {}),
});

interface Scenario {
  name: string;
  last: PrescriptionSet;
  completedSets: PrescriptionSet[];
  previousSets: PrescriptionSet[];
  targetRepRange: [number, number];
  effectiveTargetRir: number;
  exercise: PrescriptionExercise;
  isColdStartExercise: boolean;
  plannedSetCount: number;
}

const scenarios: Scenario[] = [
  {
    name: 'first working set, normal history',
    last: set(100, 10, 8),
    completedSets: [],
    previousSets: [set(100, 10, 8), set(100, 9, 8.5), set(100, 8, 9)],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'mid-session hold after an on-target set',
    last: set(100, 10, 8),
    completedSets: [set(100, 10, 8)],
    previousSets: [set(100, 10, 8), set(100, 9, 8.5)],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'clearly too light — cleared the top with RIR to spare',
    last: set(60, 14, 6),
    completedSets: [set(60, 14, 6)],
    previousSets: [set(60, 12, 7)],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'missed the floor at max effort — the Set-3 shape',
    last: set(100, 7, 10),
    completedSets: [set(100, 10, 8), set(100, 9, 9), set(100, 7, 10)],
    previousSets: [set(100, 10, 8), set(100, 10, 8), set(100, 10, 8)],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'cold start — first ever session',
    last: set(40, 12, 6),
    completedSets: [set(40, 12, 6)],
    previousSets: [],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: true,
    plannedSetCount: 3,
  },
  {
    name: 'no history at all',
    last: set(50, 10, 8),
    completedSets: [],
    previousSets: [],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'fine-grained dumbbell increment grid',
    last: set(22, 11, 7),
    completedSets: [set(22, 11, 7)],
    previousSets: [set(20, 12, 8), set(20, 11, 8.5)],
    targetRepRange: [10, 15],
    effectiveTargetRir: 2,
    exercise: dumbbell,
    isColdStartExercise: false,
    plannedSetCount: 4,
  },
  {
    name: 'bodyweight exercise',
    last: set(0, 12, 8),
    completedSets: [set(0, 12, 8)],
    previousSets: [set(0, 11, 8), set(0, 10, 9)],
    targetRepRange: [8, 15],
    effectiveTargetRir: 1,
    exercise: bodyweight,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'sets logged without an RPE (falls back to target RIR)',
    last: set(80, 10),
    completedSets: [set(80, 10)],
    previousSets: [set(80, 10), set(80, 10)],
    targetRepRange: [8, 12],
    effectiveTargetRir: 3,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
  {
    name: 'deep into a long session (fatigue accumulation)',
    last: set(100, 8, 9),
    completedSets: [set(100, 11, 7), set(100, 10, 8), set(100, 9, 8.5), set(100, 8, 9)],
    previousSets: [set(100, 11, 7), set(100, 10, 8), set(100, 9, 9)],
    targetRepRange: [8, 12],
    effectiveTargetRir: 2,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 5,
  },
  {
    name: 'zero target RIR (taken to failure)',
    last: set(100, 6, 10),
    completedSets: [set(100, 8, 10)],
    previousSets: [set(100, 7, 10)],
    targetRepRange: [5, 8],
    effectiveTargetRir: 0,
    exercise: barbell,
    isColdStartExercise: false,
    plannedSetCount: 3,
  },
];

describe('nextSetPrescription matches the pre-extraction assembly', () => {
  describe.each(scenarios)('$name', (scenario) => {
    it.each([0, 1, 2])('positionOffset %i', (positionOffset) => {
      const extracted = nextSetPrescription({
        last: scenario.last,
        positionOffset,
        targetRepRange: scenario.targetRepRange,
        targetRir: scenario.effectiveTargetRir,
        completedSets: scenario.completedSets,
        previousSets: scenario.previousSets,
        plannedSetCount: scenario.plannedSetCount,
        exercise: scenario.exercise,
        coldStart: scenario.isColdStartExercise,
      });

      expect(extracted).toEqual(legacyRecommendNext({ ...scenario, positionOffset }));
    });
  });

  it('reads effort from the feedback chip, not just RPE — same as the legacy path', () => {
    // resolveLastRir prefers feedback.repsInTank over the RPE-derived value.
    // Dropping `feedback` from the assembly would silently grade every set
    // against the wrong effort, and nothing else in the suite would notice.
    const last: PrescriptionSet = {
      weightKg: 100,
      reps: 10,
      rpe: 8,
      feedback: { repsInTank: 0, form: 'clean' } as SetFeedback,
    };
    const shared = {
      completedSets: [last],
      previousSets: [set(100, 10, 8)],
      targetRepRange: [8, 12] as [number, number],
      exercise: barbell,
      plannedSetCount: 3,
    };

    const extracted = nextSetPrescription({
      ...shared,
      last,
      targetRir: 2,
      coldStart: false,
    });
    expect(extracted).toEqual(
      legacyRecommendNext({ ...shared, last, effectiveTargetRir: 2, isColdStartExercise: false })
    );

    // And the chip really is what moved it: the same set without feedback
    // grades as an easier effort and cannot produce the same answer.
    const withoutChip = nextSetPrescription({
      ...shared,
      last: { weightKg: 100, reps: 10, rpe: 8 },
      completedSets: [{ weightKg: 100, reps: 10, rpe: 8 }],
      targetRir: 2,
      coldStart: false,
    });
    expect(withoutChip).not.toEqual(extracted);
  });
});

describe('e1RM ladder rungs', () => {
  it('sessionBestE1RM takes the best set of the session, not the last', () => {
    const best = sessionBestE1RM([set(100, 10, 8), set(120, 5, 9), set(80, 12, 7)], 2);
    const only120 = sessionBestE1RM([set(120, 5, 9)], 2);
    expect(best).toBe(only120);
  });

  it('sessionBestE1RM ignores sets with no load or no reps', () => {
    expect(sessionBestE1RM([set(0, 10, 8), set(100, 0, 8)], 2)).toBeUndefined();
  });

  it('no rung is computed for duration exercises — seconds are not reps', () => {
    // Epley on a 60-second plank fabricates an e1RM about 2.5x the load.
    expect(sessionBestE1RM([set(20, 60, 8)], 2, 'duration_based')).toBeUndefined();
    expect(lastSessionE1RM([set(20, 60, 8)], 2, 'duration_based')).toBeUndefined();
    expect(coldStartE1RM(20, [30, 60], 2, 'duration_based')).toBeUndefined();
  });

  it('lastSessionE1RM falls back to the target RIR when a set has no RPE', () => {
    expect(lastSessionE1RM([set(100, 10)], 2)).toBe(lastSessionE1RM([set(100, 10, 8)], 2));
  });

  it('coldStartE1RM prices the estimate at the MID of the rep range', () => {
    // 8-12 -> mid 10; at target RIR 2 that is 12 effective reps.
    expect(coldStartE1RM(100, [8, 12], 2)).toBeCloseTo(100 * (1 + 12 / 30), 6);
  });

  it('coldStartE1RM is undefined without a usable estimate', () => {
    expect(coldStartE1RM(undefined, [8, 12], 2)).toBeUndefined();
    expect(coldStartE1RM(0, [8, 12], 2)).toBeUndefined();
  });
});

describe('toPrevSessionSets', () => {
  it('drops unusable sets rather than counting them as failures', () => {
    // The bump gate requires EVERY working set to clear the top of the range,
    // so a 0-rep row left in would permanently deny an earned increase.
    expect(toPrevSessionSets([set(100, 10, 8), set(0, 10, 8), set(100, 0, 8)])).toEqual([
      { weightKg: 100, reps: 10, rir: 2 },
    ]);
  });

  it('leaves rir undefined when the set carried no RPE', () => {
    expect(toPrevSessionSets([set(100, 10)])).toEqual([
      { weightKg: 100, reps: 10, rir: undefined },
    ]);
  });
});

describe('rep_total path', () => {
  // Non-null asserted: this fixture always has comparable history, and the
  // null case has its own test below.
  const plan = () =>
    recommendRepTotalSessionStart({
      prevSessionSets: toPrevSessionSets([set(50, 20, 8), set(50, 18, 8.5), set(50, 16, 9)]),
      targetRepRange: [15, 25],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 3,
    })!;

  const repTotalArgs = {
    targetRepRange: [15, 25] as [number, number],
    targetRir: 2,
    exercise: { minWeightIncrementKg: 2.5 } as PrescriptionExercise,
  };

  it('matches a direct recommendRepTotalNextSet call at offset 0', () => {
    const p = plan();
    const completedSets = [set(50, 20, 8)];
    const viaModule = repTotalNextSetAt(p, 0, { ...repTotalArgs, completedSets });
    const direct = recommendRepTotalNextSet({
      sessionPlan: p,
      observedSets: completedSets.map((s) => ({
        weightKg: s.weightKg,
        reps: s.reps,
        rir: resolveLastRir(s, 2),
      })),
      targetRepRange: [15, 25],
      targetRir: 2,
      minIncrementKg: 2.5,
      availableIncrementsKg: undefined,
    });
    expect(viaModule).toEqual(direct);
  });

  it('prices a later slot by assuming the intervening set is met exactly', () => {
    const p = plan();
    const completedSets = [set(50, 20, 8)];
    const atNext = repTotalNextSetAt(p, 0, { ...repTotalArgs, completedSets });

    // Offset 1 must equal "log the offset-0 target, then ask again".
    const projected = repTotalNextSetAt(p, 1, { ...repTotalArgs, completedSets });
    const manual = recommendRepTotalNextSet({
      sessionPlan: p,
      observedSets: [
        ...completedSets.map((s) => ({ weightKg: s.weightKg, reps: s.reps, rir: resolveLastRir(s, 2) })),
        { weightKg: atNext.weightKg, reps: atNext.reps, rir: 2 },
      ],
      targetRepRange: [15, 25],
      targetRir: 2,
      minIncrementKg: 2.5,
      availableIncrementsKg: undefined,
    });
    expect(projected).toEqual(manual);
  });

  it('routes through the rep_total engine, never the e1RM one', () => {
    const p = plan();
    const completedSets = [set(50, 20, 8)];
    const rx = nextSetPrescription({
      last: set(50, 20, 8),
      targetRepRange: [15, 25],
      targetRir: 2,
      completedSets,
      previousSets: [set(50, 20, 8)],
      plannedSetCount: 3,
      exercise: { minWeightIncrementKg: 2.5 },
      coldStart: false,
      repTotal: { plan: p },
    });
    const expected = repTotalNextSetAt(p, 0, { ...repTotalArgs, completedSets });
    expect(rx.weightKg).toBe(expected.weightKg);
    expect(rx.reps).toBe(expected.reps);
  });

  it('with NO plan it echoes the last set, clamped into the range', () => {
    // Not a derived prescription — the banner is responsible for saying so.
    // Reps below the floor are lifted to it; above the ceiling, clamped down.
    const echo = (reps: number) =>
      nextSetPrescription({
        last: set(50, reps, 8),
        targetRepRange: [15, 25],
        targetRir: 2,
        completedSets: [],
        previousSets: [],
        plannedSetCount: 3,
        exercise: { minWeightIncrementKg: 2.5 },
        coldStart: false,
        repTotal: { plan: null },
      });

    expect(echo(20)).toEqual({
      weightKg: 50,
      reps: 20,
      rir: 2,
      rationale: 'maintain',
      effortVsTarget: 'on_target',
    });
    expect(echo(9).reps).toBe(15);
    expect(echo(40).reps).toBe(25);
  });

  it('never computes an e1RM on the rep_total path', () => {
    // The load is held verbatim from the plan; nothing here may be derived
    // from a canonical estimate (ADD 2 — reps on these exercises are not
    // crisp units, so an e1RM would be fiction).
    const rx = nextSetPrescription({
      last: set(50, 20, 8),
      targetRepRange: [15, 25],
      targetRir: 2,
      completedSets: [set(50, 20, 8)],
      previousSets: [set(50, 20, 8)],
      plannedSetCount: 3,
      exercise: { minWeightIncrementKg: 2.5 },
      coldStart: false,
      repTotal: { plan: plan() },
    });
    expect(rx.rir).toBe(2);
    expect(['maintain', 'reduce_load']).toContain(rx.rationale);
  });
});
