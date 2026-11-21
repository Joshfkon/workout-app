/**
 * The "Log set" payload, built in ONE place.
 *
 * The phone's logger row (`components/workout/SetLoggerRow.tsx`) and the
 * Apple Watch (`lib/watch/*`) both turn "weight shown × reps shown + an RIR
 * chip" into the object `ExerciseCard.completeLoggedSet` hands to the
 * persistence path (`onSetComplete` → `handleSetComplete` → `logSet`). Keeping
 * the conversion here means a set logged from the wrist is byte-for-byte the
 * set the phone would have logged for the same inputs: weight converted to kg,
 * RPE derived from the chip, bodyweight load resolved the same way.
 *
 * Pure: no React, no I/O.
 */
import type {
  BodyweightData,
  FormRating,
  RepsInTank,
  SetDiscomfort,
  SetFeedback,
  SetType,
  WeightUnit,
} from '@/types/schema';
import { calculateEffectiveLoad, rirToRpe } from '@/types/schema';
import { convertWeight, inputWeightToKg, roundToIncrement } from '@/lib/utils';

export type LoggerWeightMode = 'bodyweight' | 'weighted' | 'assisted';

export interface SetLogData {
  weightKg: number;
  reps: number;
  rpe: number;
  note?: string;
  feedback: SetFeedback;
  bodyweightData?: BodyweightData;
  setType: SetType;
}

export interface BuildSetLogDataInput {
  /** Weight in DISPLAY units (for weighted/assisted bodyweight: the added/assistance load). NaN = blank. */
  weight: number;
  /** Reps (seconds for duration-based exercises). */
  reps: number;
  rir: RepsInTank;
  unit: WeightUnit;
  form?: FormRating | null;
  discomfort?: SetDiscomfort;
  /** The RIR is an untouched motion-capture prefill. */
  rirFromSensor?: boolean;
  note?: string;
  setType?: SetType;
  isBodyweight?: boolean;
  weightMode?: LoggerWeightMode;
  userBodyweightKg?: number;
}

/** Upper bound on the reps field (seconds for holds). */
export function maxRepsFor(isDurationBased: boolean): number {
  return isDurationBased ? 600 : 100;
}

/**
 * Weight step in DISPLAY units, derived from the exercise's minimum kg
 * increment. For lb users the converted step snaps to real 2.5 lb plate math
 * (2.5 kg -> 5 lb, 1.25 kg -> 2.5 lb) instead of 5.51 lb.
 */
export function weightStepForDisplay(minIncrementKg: number | undefined, unit: WeightUnit): number {
  const incKg = minIncrementKg && minIncrementKg > 0 ? minIncrementKg : 2.5;
  if (unit === 'lb') {
    const lbs = convertWeight(incKg, 'kg', 'lb');
    return Math.max(2.5, roundToIncrement(lbs, 2.5));
  }
  return incKg;
}

export function buildSetLogData(input: BuildSetLogDataInput): SetLogData {
  const {
    weight,
    reps,
    rir,
    unit,
    form,
    discomfort,
    rirFromSensor,
    note,
    setType = 'normal',
    isBodyweight = false,
    weightMode = 'bodyweight',
    userBodyweightKg,
  } = input;
  const isPlainBodyweight = isBodyweight && weightMode === 'bodyweight';

  const feedback: SetFeedback = {
    repsInTank: rir,
    form: form ?? 'clean',
    discomfort,
    ...(rirFromSensor ? { rirSource: 'sensor' as const } : {}),
  };
  const rpe = rirToRpe(rir);

  let weightKg: number;
  let bodyweightData: BodyweightData | undefined;

  if (isBodyweight && userBodyweightKg) {
    if (weightMode === 'weighted') {
      const addedKg = inputWeightToKg(isNaN(weight) ? 0 : weight, unit);
      bodyweightData = {
        userBodyweightKg,
        modification: 'weighted',
        addedWeightKg: addedKg,
        effectiveLoadKg: calculateEffectiveLoad(userBodyweightKg, 'weighted', addedKg),
      };
    } else if (weightMode === 'assisted') {
      const assistKg = inputWeightToKg(isNaN(weight) ? 0 : weight, unit);
      bodyweightData = {
        userBodyweightKg,
        modification: 'assisted',
        assistanceWeightKg: assistKg,
        assistanceType: 'machine',
        effectiveLoadKg: calculateEffectiveLoad(userBodyweightKg, 'assisted', undefined, assistKg),
      };
    } else {
      bodyweightData = {
        userBodyweightKg,
        modification: 'none',
        effectiveLoadKg: userBodyweightKg,
      };
    }
    weightKg = bodyweightData.effectiveLoadKg;
  } else if (isPlainBodyweight) {
    // Bodyweight movement with no weigh-in on record: there is no load to
    // resolve and no field to type one into. Log the set at 0 rather than
    // handing the persistence path a NaN it silently drops — the card's
    // "log your bodyweight" hint is what fixes the missing load.
    weightKg = 0;
  } else {
    weightKg = inputWeightToKg(weight, unit);
  }

  return {
    weightKg,
    reps,
    rpe,
    note: note?.trim() || undefined,
    feedback,
    bodyweightData,
    setType,
  };
}
