/**
 * workoutDurationEstimator.ts
 *
 * "How long is this workout going to take?" — one model, shared by every
 * surface that asks the question: the blank-workout builder (as exercises are
 * picked), the add-exercise picker (what does this add?), and the live session
 * header (how much is left?).
 *
 * Before this existed the only duration math lived inside mesocycle program
 * generation (`mesocycleBuilder`, `sessionBuilderWithFatigue`) in three
 * inconsistent copies, and none of it was reachable at workout time.
 *
 * The model is deliberately simple and legible:
 *
 *     work + rest + warmups + transitions between exercises
 *
 * Rest is counted BETWEEN sets of an exercise (n sets → n-1 rests); the gap
 * after an exercise's last set is the transition to the next one. Supersets
 * are cheaper by construction: members of a group alternate with only a short
 * changeover, and the group rests once per round (matching the round-robin in
 * `_lib/supersetFlow.ts`, which rests after the group's LAST member).
 *
 * Mid-session the model is calibrated against what the user is ACTUALLY doing:
 * once a few sets are logged, observed seconds-per-set vs modelled
 * seconds-per-set gives a pace factor that scales the remaining estimate. A
 * user who chats between sets sees a bigger number than one who supersets
 * through — and both see their own truth rather than a textbook average.
 *
 * Pure: no DB, no clock, no I/O. Callers pass blocks and (optionally) the
 * elapsed time their timer already tracks.
 */

export type SetMechanic = 'compound' | 'isolation';

/**
 * Tunable model constants. Exported so tests pin behaviour to named knobs
 * rather than magic numbers, and so a future "learn my pace" feature has one
 * obvious place to override.
 */
export const DURATION_MODEL = {
  /** Time under the bar for one working set, including getting into position. */
  workSecondsCompound: 45,
  workSecondsIsolation: 30,
  /** Timed holds (planks, dead hangs) run longer than a rep-based set. */
  workSecondsDurationHold: 60,
  /** A warmup set is quicker than a working set, and rests less. */
  warmupWorkSeconds: 25,
  defaultWarmupRestSeconds: 45,
  /** Used when a block carries no rest prescription. */
  defaultRestSeconds: 120,
  /** Walking to the next station, adjusting the machine, loading plates. */
  transitionSeconds: 75,
  /** Superset changeover — a few steps, no real rest. */
  supersetChangeoverSeconds: 20,
  /** Sets needed before observed pace is trusted over the model. */
  minSetsForPace: 3,
  /** Pace calibration is a correction, not a takeover. */
  minPaceFactor: 0.6,
  maxPaceFactor: 2,
} as const;

export interface DurationBlockInput {
  /** Stable id — only used to keep superset members together. */
  id: string;
  /** Planned working sets. */
  targetSets: number;
  /** Working sets already logged (0 / omitted when planning). */
  completedSets?: number;
  /** Prescribed rest between working sets, in seconds. */
  restSeconds?: number | null;
  mechanic?: SetMechanic | null;
  /** 'duration_based' exercises are timed holds, not reps. */
  exerciseType?: 'rep_based' | 'duration_based' | null;
  /** Warmup sets still to be performed for this exercise. */
  warmupSetsRemaining?: number;
  /**
   * Warmup sets already logged. The workout timer anchors to the first logged
   * set of ANY kind, so warmups the user actually performed have to be in the
   * completed-work baseline or pace calibration reads them as slowness.
   */
  warmupSetsCompleted?: number;
  /** Rest between those warmup sets (warmups rest less than working sets). */
  warmupRestSeconds?: number | null;
  /** Members of the same group are supersetted (see supersetFlow). */
  supersetGroupId?: string | null;
  /** Skipped blocks contribute nothing. */
  skipped?: boolean;
}

export interface WorkoutDurationEstimate {
  /** Whole session, every planned set, as if starting fresh. */
  totalSeconds: number;
  /** Work still ahead, pace-adjusted when calibrated. */
  remainingSeconds: number;
  /**
   * Best available answer to "when do I walk out?": elapsed + remaining once
   * the session is underway, otherwise the same as `totalSeconds`.
   */
  projectedTotalSeconds: number;
  /** Planned working sets (skipped blocks excluded). */
  totalSets: number;
  /** Working sets already logged. */
  completedSets: number;
  /** Working sets still to do. */
  remainingSets: number;
  /** Exercises counted (skipped excluded). */
  exerciseCount: number;
  /** Multiplier applied from observed pace; 1 when uncalibrated. */
  paceFactor: number;
  /** True once observed pace has adjusted the estimate. */
  isCalibrated: boolean;
}

export interface EstimateOptions {
  /**
   * Seconds the workout timer has counted. The timer is anchored to the FIRST
   * logged set (see `useWorkoutTimer`), so this is time spent on everything
   * after set 1 — the model's completed-work figure is offset to match.
   */
  elapsedSeconds?: number;
}

/** Seconds of actual work for one set of this exercise. */
function workSecondsPerSet(block: DurationBlockInput): number {
  if (block.exerciseType === 'duration_based') return DURATION_MODEL.workSecondsDurationHold;
  return block.mechanic === 'isolation'
    ? DURATION_MODEL.workSecondsIsolation
    : DURATION_MODEL.workSecondsCompound;
}

function restSecondsFor(block: DurationBlockInput): number {
  const rest = block.restSeconds;
  return typeof rest === 'number' && rest > 0 ? rest : DURATION_MODEL.defaultRestSeconds;
}

/** Sets of this block that count toward the segment being measured. */
type SetCounter = (block: DurationBlockInput) => number;

const remainingWorkingSets: SetCounter = (b) =>
  Math.max(0, b.targetSets - Math.max(0, b.completedSets ?? 0));
const allWorkingSets: SetCounter = (b) => Math.max(0, b.targetSets);
const completedWorkingSets: SetCounter = (b) =>
  Math.min(Math.max(0, b.completedSets ?? 0), Math.max(0, b.targetSets));

/** Which of a block's warmup sets count toward the segment being measured. */
type WarmupCounter = (block: DurationBlockInput) => number;

const remainingWarmups: WarmupCounter = (b) => Math.max(0, b.warmupSetsRemaining ?? 0);
const completedWarmups: WarmupCounter = (b) => Math.max(0, b.warmupSetsCompleted ?? 0);
/** Every warmup the session involves — those done plus those still owed. */
const allWarmups: WarmupCounter = (b) => remainingWarmups(b) + completedWarmups(b);

/**
 * Warmup cost for `count` sets: each is work plus a short rest. The rest after
 * the LAST warmup is kept — that's the gap before the first working set.
 */
function warmupSeconds(block: DurationBlockInput, count: number): number {
  if (count <= 0) return 0;
  const rest =
    typeof block.warmupRestSeconds === 'number' && block.warmupRestSeconds > 0
      ? block.warmupRestSeconds
      : DURATION_MODEL.defaultWarmupRestSeconds;
  return count * (DURATION_MODEL.warmupWorkSeconds + rest);
}

/**
 * Order-preserving grouping into "units": a standalone block, or a superset
 * group (its members collapse into one unit that rests once per round). A
 * group's position is that of its first member, so unit order still mirrors
 * the workout order the user sees.
 */
function toUnits(blocks: DurationBlockInput[]): DurationBlockInput[][] {
  const units: DurationBlockInput[][] = [];
  const groupUnit = new Map<string, DurationBlockInput[]>();

  for (const block of blocks) {
    const group = block.supersetGroupId;
    if (!group) {
      units.push([block]);
      continue;
    }
    const existing = groupUnit.get(group);
    if (existing) {
      existing.push(block);
    } else {
      const unit = [block];
      groupUnit.set(group, unit);
      units.push(unit);
    }
  }
  return units;
}

/**
 * Seconds for one unit's counted sets: work for every set, rest between sets,
 * and — for a superset — one rest per completed round plus a changeover for
 * each set that follows another inside the same round.
 */
function unitSeconds(unit: DurationBlockInput[], countSets: SetCounter): number {
  if (unit.length === 1) {
    const block = unit[0];
    const sets = countSets(block);
    if (sets === 0) return 0;
    return sets * workSecondsPerSet(block) + (sets - 1) * restSecondsFor(block);
  }

  // Superset group (v1 is pairs, but this holds for any size).
  let work = 0;
  let totalSets = 0;
  let rounds = 0;
  for (const block of unit) {
    const sets = countSets(block);
    work += sets * workSecondsPerSet(block);
    totalSets += sets;
    rounds = Math.max(rounds, sets);
  }
  if (totalSets === 0) return 0;

  // The group rests after its LAST member each round (supersetFlow), so the
  // rest that matters is that member's.
  const groupRest = restSecondsFor(unit[unit.length - 1]);
  const changeovers = totalSets - rounds;
  return (
    work +
    Math.max(0, rounds - 1) * groupRest +
    changeovers * DURATION_MODEL.supersetChangeoverSeconds
  );
}

/** Sum a segment across units, adding a transition between active units. */
function segmentSeconds(
  units: DurationBlockInput[][],
  countSets: SetCounter,
  countWarmups: WarmupCounter
): number {
  let seconds = 0;
  let activeUnits = 0;

  for (const unit of units) {
    const unitTotal = unitSeconds(unit, countSets);
    const warmup = unit.reduce(
      (sum, block) => sum + warmupSeconds(block, countWarmups(block)),
      0
    );
    if (unitTotal === 0 && warmup === 0) continue;
    seconds += unitTotal + warmup;
    activeUnits += 1;
  }

  return seconds + Math.max(0, activeUnits - 1) * DURATION_MODEL.transitionSeconds;
}

/**
 * Work time of the first thing the user logged — the workout timer's anchor.
 * It's a warmup set when the exercise's warmups were logged, otherwise the
 * first working set. Subtracted from the completed-work model so the model and
 * the timer measure the same span.
 */
function anchorWorkSeconds(active: DurationBlockInput[]): number {
  for (const block of active) {
    if (completedWarmups(block) > 0) return DURATION_MODEL.warmupWorkSeconds;
    if (completedWorkingSets(block) > 0) return workSecondsPerSet(block);
  }
  return 0;
}

/**
 * Observed-vs-modelled pace for the work already done. Returns 1 (no
 * correction) until enough sets are logged for the ratio to mean anything.
 */
export function computePaceFactor(
  modelSeconds: number,
  observedSeconds: number,
  completedSets: number
): number {
  if (completedSets < DURATION_MODEL.minSetsForPace) return 1;
  if (modelSeconds <= 0 || observedSeconds <= 0) return 1;
  const raw = observedSeconds / modelSeconds;
  return Math.min(DURATION_MODEL.maxPaceFactor, Math.max(DURATION_MODEL.minPaceFactor, raw));
}

/**
 * Estimate how long a workout takes, and how much of it is left.
 *
 * Works for a session that hasn't started (`completedSets` omitted → remaining
 * equals total) and for one in progress (pass `elapsedSeconds` to calibrate).
 */
export function estimateWorkoutDuration(
  blocks: DurationBlockInput[],
  options: EstimateOptions = {}
): WorkoutDurationEstimate {
  const active = blocks.filter((b) => !b.skipped && b.targetSets > 0);
  const units = toUnits(active);

  const totalSets = active.reduce((sum, b) => sum + allWorkingSets(b), 0);
  const completedSets = active.reduce((sum, b) => sum + completedWorkingSets(b), 0);
  const remainingSets = active.reduce((sum, b) => sum + remainingWorkingSets(b), 0);

  const baseTotalSeconds = segmentSeconds(units, allWorkingSets, allWarmups);
  const completedSeconds = segmentSeconds(units, completedWorkingSets, completedWarmups);

  // Remaining is the WHOLE session minus what's been done — never a fresh count
  // of the unlogged sets. Recounting silently drops the gap the user is sitting
  // in right now: mid-exercise every remaining set has a rest in front of it
  // (not n-1 of them), and an exercise just finished owes the transition to the
  // next one. Subtraction gets both for free.
  const baseRemainingSeconds = Math.max(0, baseTotalSeconds - completedSeconds);

  // Modelled cost of everything logged so far. The timer anchors to the first
  // logged set's completion, so drop that set's work to compare like with like.
  const completedModelSeconds = Math.max(0, completedSeconds - anchorWorkSeconds(active));

  const elapsedSeconds = Math.max(0, options.elapsedSeconds ?? 0);
  const paceFactor = computePaceFactor(completedModelSeconds, elapsedSeconds, completedSets);
  const isCalibrated = paceFactor !== 1;

  const remainingSeconds = Math.round(baseRemainingSeconds * paceFactor);
  const projectedTotalSeconds =
    elapsedSeconds > 0 ? elapsedSeconds + remainingSeconds : Math.round(baseTotalSeconds);

  return {
    totalSeconds: Math.round(baseTotalSeconds),
    remainingSeconds,
    projectedTotalSeconds,
    totalSets,
    completedSets,
    remainingSets,
    exerciseCount: active.length,
    paceFactor,
    isCalibrated,
  };
}

/**
 * Format an estimate for display: "45 min", "1h 15m", "2h".
 *
 * Rounded to 5-minute granularity by default — a duration estimate that reads
 * "1h 13m" claims a precision the model does not have, and a minute-by-minute
 * countdown would jitter on every logged set.
 */
export function formatDurationEstimate(
  seconds: number,
  options: { roundToMinutes?: number } = {}
): string {
  const step = Math.max(1, options.roundToMinutes ?? 5);
  const rawMinutes = Math.max(0, seconds) / 60;
  const minutes = Math.max(step, Math.round(rawMinutes / step) * step);

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Shorthand for "+12 min" style deltas (e.g. what an added exercise costs). */
export function formatDurationDelta(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  return `${sign}${formatDurationEstimate(Math.abs(seconds))}`;
}
