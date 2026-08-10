/**
 * Session prescription — "what should my next set be?", assembled.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `services/setRecommender.recommendSet` is the engine, and it is pure. But it
 * takes a dozen assembled inputs — the session's e1RM anchor, today's observed
 * sets at their logged effort, last session's sets for the bump gate, the
 * position-matching context — and until now that assembly lived in a closure
 * inside `components/workout/ExerciseCard.tsx` (4705 lines). `recommendSet` had
 * exactly ONE caller in the whole repo, and it was a React component.
 *
 * So there was no way to ask the app "what would you prescribe here?" without
 * mounting a component tree, which is precisely what a headless simulated user
 * needs to do a few thousand times. Reimplementing the assembly in the harness
 * would mean the harness verified its own copy of the engine's contract rather
 * than the engine's.
 *
 * This module is that assembly, and nothing else. It computes NO prescription
 * rules of its own: every number it returns comes from `recommendSet` or, on
 * the rep_total path, from `recommendRepTotalNextSet`. If you find yourself
 * adding a heuristic here, it belongs in the engine.
 *
 * TWO PATHS, ONE CONTRACT
 * -----------------------
 * `e1rm`      — the default. Load/rep decisions run through the canonical
 *               estimator and the deadband rules in setRecommender.
 * `rep_total` — exercises whose reps aren't crisp units (high-rep machine
 *               work, most bodyweight accessories). NO e1RM is computed,
 *               displayed, or fed to calibration on this path; progression is
 *               rep-space against last session's total.
 *
 * Both return the same `SetRecommendation` shape on purpose — every caller
 * narrows on it, and an extra field on one branch would break that.
 */
import {
  recommendSet,
  resolveLastRir,
  type SetRecommendation,
  type PrevSessionSet,
} from '@/services/setRecommender';
import {
  recommendRepTotalNextSet,
  type RepTotalSessionStart,
  type RepTotalObservedSet,
} from '@/services/suggestionEngine/repTotalPolicy';
import { rpeToRir, type ExerciseType, type SetFeedback } from '@/types/schema';

/** The fields of a logged set this module reads. */
export interface PrescriptionSet {
  weightKg: number;
  reps: number;
  rpe?: number;
  feedback?: SetFeedback;
}

/** Exercise attributes that shape a prescription. */
export interface PrescriptionExercise {
  exerciseType?: ExerciseType;
  isBodyweight?: boolean;
  minWeightIncrementKg?: number;
  availableIncrementsKg?: number[] | null;
}

// ---------------------------------------------------------------------------
// e1RM ladder rungs
// ---------------------------------------------------------------------------

/**
 * Best e1RM demonstrated in THIS session — the capacity anchor, so late-set
 * predictions aren't double-fatigued.
 *
 * Returns undefined for duration exercises: their `reps` field carries SECONDS,
 * and Epley on seconds fabricates an e1RM roughly 2.5× the load.
 */
export function sessionBestE1RM(
  completedSets: PrescriptionSet[],
  targetRir: number,
  exerciseType?: ExerciseType
): number | undefined {
  if (exerciseType === 'duration_based') return undefined;
  let best = 0;
  for (const s of completedSets) {
    if (s.weightKg > 0 && s.reps > 0) {
      const rir = resolveLastRir(s, targetRir);
      const e = s.weightKg * (1 + (s.reps + rir) / 30);
      if (e > best) best = e;
    }
  }
  return best > 0 ? best : undefined;
}

/**
 * Best e1RM from the PREVIOUS session's sets at their logged effort — rung 2
 * of the prescription ladder, used when nothing has been logged today yet.
 */
export function lastSessionE1RM(
  previousSets: PrescriptionSet[],
  targetRir: number,
  exerciseType?: ExerciseType
): number | undefined {
  if (exerciseType === 'duration_based') return undefined;
  let best = 0;
  for (const s of previousSets) {
    if (s.weightKg > 0 && s.reps > 0) {
      const rir = s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : targetRir;
      const e = s.weightKg * (1 + (s.reps + rir) / 30);
      if (e > best) best = e;
    }
  }
  return best > 0 ? best : undefined;
}

/**
 * The e1RM implied by a cold-start weight estimate at the MID of the rep range
 * — rung 3, the only rung available on an exercise's first-ever session.
 */
export function coldStartE1RM(
  coldStartWeightKg: number | undefined,
  targetRepRange: [number, number],
  targetRir: number,
  exerciseType?: ExerciseType
): number | undefined {
  if (exerciseType === 'duration_based') return undefined;
  if (!coldStartWeightKg || !(coldStartWeightKg > 0)) return undefined;
  const mid = Math.round((targetRepRange[0] + targetRepRange[1]) / 2);
  return coldStartWeightKg * (1 + (mid + targetRir) / 30);
}

/**
 * Last session's sets in the shape the session-to-session bump gate wants.
 *
 * The gate exists because a load increase must be EARNED by every working set
 * clearing the top of the range, not by one strong set — so sets with no
 * usable load or reps are dropped rather than counted as failures.
 */
export function toPrevSessionSets(previousSets: PrescriptionSet[]): PrevSessionSet[] {
  return previousSets
    .filter((s) => s.weightKg > 0 && s.reps > 0)
    .map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : undefined,
    }));
}

// ---------------------------------------------------------------------------
// rep_total path
// ---------------------------------------------------------------------------

export interface RepTotalContext {
  /** Session plan from `recommendRepTotalSessionStart`. Null = no history. */
  plan: RepTotalSessionStart | null;
}

/**
 * Re-derive the rep_total target for a pending slot from the sets actually
 * logged today — planner parity with `recommendSet`, so a set that contradicts
 * the session-start plan moves the next prescription instead of the plan being
 * re-served verbatim.
 *
 * `positionOffset` prices a LATER pending slot by assuming each intervening
 * prescription is met exactly — the same assumption the e1RM path makes when
 * it advances `setsCompletedThisExercise`. Before this existed, the rep_total
 * branch ignored the offset and painted one number across every pending row.
 */
export function repTotalNextSetAt(
  plan: RepTotalSessionStart,
  positionOffset: number,
  args: {
    completedSets: PrescriptionSet[];
    targetRepRange: [number, number];
    targetRir: number;
    exercise: PrescriptionExercise;
  }
) {
  const observedSets: RepTotalObservedSet[] = args.completedSets.map((s) => ({
    weightKg: s.weightKg,
    reps: s.reps,
    rir: resolveLastRir(s, args.targetRir),
  }));
  const base = {
    sessionPlan: plan,
    targetRepRange: args.targetRepRange,
    targetRir: args.targetRir,
    minIncrementKg: args.exercise.minWeightIncrementKg,
    availableIncrementsKg: args.exercise.availableIncrementsKg ?? undefined,
  };

  let rx = recommendRepTotalNextSet({ ...base, observedSets });
  for (let i = 0; i < positionOffset; i++) {
    // The rep read here is the engine's rep TARGET, not a SetLog — the
    // modality accessors take a set and don't apply. rep_total also excludes
    // duration exercises outright, so `reps` can never be seconds.
    observedSets.push({ weightKg: rx.weightKg, reps: rx.reps, rir: args.targetRir });
    rx = recommendRepTotalNextSet({ ...base, observedSets });
  }
  return rx;
}

// ---------------------------------------------------------------------------
// The prescription
// ---------------------------------------------------------------------------

export interface NextSetPrescriptionInput {
  /** The reference set the next one is graded against — usually the last logged. */
  last: PrescriptionSet;
  /**
   * Which pending slot is being priced, relative to the next set (0 = next).
   * Position matching targets each slot from the SAME set position last
   * session, so later slots get their own target rather than a copy.
   */
  positionOffset?: number;
  targetRepRange: [number, number];
  /** Calibration- and readiness-adjusted target RIR, not the raw block value. */
  targetRir: number;
  /** Working sets logged for this exercise TODAY, in order. */
  completedSets: PrescriptionSet[];
  /** Last session's sets, for the bump gate and position matching. */
  previousSets: PrescriptionSet[];
  /** Sets planned for this exercise this session. */
  plannedSetCount: number;
  exercise: PrescriptionExercise;
  /**
   * True on the exercise's FIRST-EVER session. The starting weight was an
   * estimate expected to be wrong low, so within-session adaptation widens.
   */
  coldStart: boolean;
  /**
   * Present only on the rep_total path. When `plan` is null the caller has no
   * comparable history: the last set is echoed back unchanged, and the UI is
   * expected to say so rather than present it as a derived prescription.
   */
  repTotal?: RepTotalContext;
}

/**
 * The next set's prescription.
 *
 * Every number returned comes from the engine. This function's job is to hand
 * the engine the right inputs — which is exactly the part that used to be
 * impossible to call from outside a React tree.
 */
export function nextSetPrescription(input: NextSetPrescriptionInput): SetRecommendation {
  const {
    last,
    positionOffset = 0,
    targetRepRange,
    targetRir,
    completedSets,
    previousSets,
    plannedSetCount,
    exercise,
    coldStart,
    repTotal,
  } = input;

  if (repTotal) {
    const next = repTotal.plan
      ? repTotalNextSetAt(repTotal.plan, positionOffset, {
          completedSets,
          targetRepRange,
          targetRir,
          exercise,
        })
      : null;

    // A null `next` means there is no session plan and these values are just
    // the last set echoed back — NOT a derived prescription. The shape stays
    // structurally assignable to SetRecommendation on purpose (an extra marker
    // field here would break the union narrowing every e1RM-branch caller
    // depends on), so the disclosure belongs in the banner, which tests the
    // plan directly.
    return {
      weightKg: next?.weightKg ?? last.weightKg,
      reps:
        next?.reps ?? Math.min(Math.max(last.reps, targetRepRange[0]), targetRepRange[1]),
      rir: targetRir,
      rationale: (next?.rationale === 'reduce_load' ? 'reduce_load' : 'maintain') as
        | 'reduce_load'
        | 'maintain',
      effortVsTarget: next?.effortVsTarget ?? ('on_target' as const),
    };
  }

  return recommendSet({
    lastWeightKg: last.weightKg,
    lastReps: last.reps,
    lastRir: resolveLastRir(last, targetRir),
    setsCompletedThisExercise: completedSets.length + positionOffset,
    sessionBestE1RMKg: sessionBestE1RM(completedSets, targetRir, exercise.exerciseType),
    targetRepRange,
    targetRir,
    minIncrementKg: exercise.minWeightIncrementKg,
    availableIncrementsKg: exercise.availableIncrementsKg ?? undefined,
    coldStart,
    exerciseType: exercise.exerciseType,
    isBodyweight: exercise.isBodyweight,
    // Today's completed sets at their LOGGED effort — the ceiling no
    // prescription may imply more capacity than.
    sessionObservedSets: completedSets.map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: resolveLastRir(s, targetRir),
    })),
    // Set-position matching: when last session is comparable, the next set's
    // target is what the SAME position did last time rather than a
    // re-derivation from the session-start anchor.
    positionContext: {
      prevSessionSets: toPrevSessionSets(previousSets),
      todaySets: completedSets.map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
      plannedSetCount,
    },
  });
}
