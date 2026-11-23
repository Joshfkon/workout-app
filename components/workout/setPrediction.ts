/**
 * Predict, then score (UX panel: a Hevy switcher who "never saw why it
 * suggested 140 × 9" and so never trusted it). Before a working set the strip
 * says what the app expects at the suggested load; after the set it says how
 * that went; over time a quiet tally shows how often it was right.
 *
 * Wording only. The expected reps are the number the suggestion strip
 * already shows (the reps that land on the target effort, from the
 * prescription engine's own rep-max curve — ExerciseCard's bannerRepsLabel);
 * nothing here forecasts anything. The prediction rides on the logged set's
 * feedback JSON (SetFeedback.prediction) so the score survives a reload.
 */

/** What the app expected for a set, captured when it was logged. */
export interface SetPrediction {
  repCount: number;
  weightKg: number;
}

/**
 * The expected reps from the strip's reps label: "6–8" → 8 (the top of a
 * widened label is the count that lands on the target effort), "9" → 9.
 * Null for anything else (timed sets, "—").
 */
export function expectedRepsFromLabel(label: string): number | null {
  const m = /^(\d+)(?:\s*[–-]\s*(\d+))?$/.exec(label.trim());
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  return n > 0 ? n : null;
}

/** "Expect about 9 reps at 140 lbs" */
export function expectLine(reps: number, weightLabel: string): string {
  return `Expect about ${reps} rep${reps === 1 ? '' : 's'} at ${weightLabel}`;
}

/** Loads closer than this (kg) count as "the predicted load". */
const SAME_LOAD_KG = 0.3;

export interface PredictionOutcome {
  /** Within one rep of the prediction. */
  hit: boolean;
  text: string;
}

/**
 * The logged set against its prediction. Null when there was no prediction
 * or the set was done at a different load (the prediction was for the
 * suggested load only).
 */
export function predictionOutcome(input: {
  prediction: SetPrediction | null | undefined;
  loggedReps: number;
  loggedWeightKg: number;
  /** Another set of this exercise follows today ("next set adjusts"). */
  hasNextSet: boolean;
}): PredictionOutcome | null {
  const p = input.prediction;
  if (!p || !(p.repCount > 0)) return null;
  if (Math.abs(p.weightKg - input.loggedWeightKg) > SAME_LOAD_KG) return null;
  const diff = input.loggedReps - p.repCount;
  const did = `You did ${input.loggedReps}`;
  if (Math.abs(diff) <= 1) return { hit: true, text: `${did} ✓` };
  const next = input.hasNextSet ? 'next set adjusts' : 'next time adjusts';
  return diff < 0
    ? { hit: false, text: `${did} — harder than expected; ${next}` }
    : { hit: false, text: `${did} — easier than expected; ${next}` };
}

/**
 * Running accuracy over logged sets that carried a prediction at the load
 * they were done at. Null until there is at least one.
 */
export function predictionAccuracy(
  sets: ReadonlyArray<{ prediction: SetPrediction | null | undefined; loggedReps: number; loggedWeightKg: number }>
): { hits: number; total: number } | null {
  let hits = 0;
  let total = 0;
  for (const s of sets) {
    const o = predictionOutcome({ ...s, hasNextSet: false });
    if (!o) continue;
    total += 1;
    if (o.hit) hits += 1;
  }
  return total > 0 ? { hits, total } : null;
}

/**
 * "Predictions within 1 rep: 7 of 8 sets". `scope` names what was counted
 * ("on this lift today") so the tally never claims more than it saw.
 */
export function accuracyLine(acc: { hits: number; total: number } | null, scope?: string): string | null {
  if (!acc) return null;
  return `Predictions within 1 rep${scope ? ` ${scope}` : ''}: ${acc.hits} of ${acc.total} set${acc.total === 1 ? '' : 's'}`;
}

/**
 * "Hit 140 lbs × 10 next time → 145 lbs": the progression rule, previewed
 * from the engine's own answer (the caller asks recommendSessionStart what
 * it would prescribe after the top of the range at the target effort). Null
 * when that answer is not a heavier load as displayed — no rule invented.
 */
export function nextTimeLine(input: {
  /** Today's suggested load as displayed (e.g. 140). */
  weight: number;
  topReps: number;
  /** The engine's next-session load for that outcome, as displayed. */
  nextWeight: number;
  unitLabel: string;
}): string | null {
  if (!(input.weight > 0) || !(input.nextWeight > input.weight) || !(input.topReps > 0)) return null;
  return `Hit ${input.weight} ${input.unitLabel} × ${input.topReps} next time → ${input.nextWeight} ${input.unitLabel}`;
}
