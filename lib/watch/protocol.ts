/**
 * Apple Watch ⇄ phone protocol (pure — no React, no Capacitor).
 *
 * The phone is the source of truth. It pushes a `WatchWorkoutState` snapshot
 * of the active set to the watch (WatchConnectivity application context), and
 * the watch sends back small commands. A logged set from the wrist is NOT a
 * separate write: the workout page hands it to the active ExerciseCard, which
 * logs it through the same `completeLoggedSet` → `onSetComplete` →
 * `handleSetComplete` → `logSet` (durable outbox) path as a tap on the phone.
 *
 * Message shapes are mirrored in Swift by `ios/App/HyperTrackWatch/WatchModels.swift`;
 * bump `WATCH_PROTOCOL_VERSION` when either side changes incompatibly.
 */
import type { RepsInTank, WeightUnit } from '@/types/schema';
import type { BuildSetLogDataInput, LoggerWeightMode } from '@/lib/workout/setLogData';
import { maxRepsFor, weightStepForDisplay } from '@/lib/workout/setLogData';

export const WATCH_PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Phone → watch
// ---------------------------------------------------------------------------

export interface WatchRestState {
  /** Epoch ms the rest ends (the watch counts down to it locally). */
  endsAt: number;
  totalSeconds: number;
}

export interface WatchActiveState {
  v: typeof WATCH_PROTOCOL_VERSION;
  active: true;
  sessionId: string;
  blockId: string;
  exerciseName: string;
  /** 1-based position of this exercise in the session, for "2 of 6". */
  exerciseNumber: number;
  exerciseCount: number;
  /**
   * The phone's logger row is showing, so the watch can log. False when every
   * planned set is done (`allSetsDone`) or the phone is mid-flow on something
   * the watch doesn't do (a dropset prompt): the watch then offers Next /
   * "continue on iPhone" instead of a logger.
   */
  canLog: boolean;
  allSetsDone: boolean;
  /**
   * Whether the watch may log this exercise's next set before the phone
   * answers (phone app closed, logs queued). False when the phone decides what
   * comes next itself — a superset rotates to the other exercise, a dropset
   * prompt follows the set — so a queued "next set here" would be refused as
   * stale and silently lost.
   */
  canQueueNext: boolean;
  setNumber: number;
  targetSets: number;
  /** Weight in DISPLAY units; null when the exercise has no load to enter (plain bodyweight). */
  weight: number | null;
  weightStep: number;
  unit: WeightUnit;
  reps: number;
  repsStep: number;
  maxReps: number;
  repsLabel: 'reps' | 'sec';
  targetRir: RepsInTank;
  canPrev: boolean;
  canNext: boolean;
  rest: WatchRestState | null;
  /** Prescribed rest for this exercise; the watch starts it locally on Done until the phone's timer arrives. */
  defaultRestSeconds: number;
}

export interface WatchInactiveState {
  v: typeof WATCH_PROTOCOL_VERSION;
  active: false;
}

export type WatchWorkoutState = WatchActiveState | WatchInactiveState;

export const WATCH_INACTIVE_STATE: WatchInactiveState = { v: WATCH_PROTOCOL_VERSION, active: false };

/**
 * What the active ExerciseCard publishes about its logger row: the exact
 * strings in the phone's steppers, so the watch starts from what the phone
 * shows (the suggestion engine's prescription, or the lifter's own edit).
 */
export interface ActiveLoggerSnapshot {
  blockId: string;
  setNumber: number;
  targetSets: number;
  /** Weight field in display units (for weighted/assisted bodyweight: the added/assistance load). */
  weight: string;
  reps: string;
  targetRir: number;
  unit: WeightUnit;
  minIncrementKg?: number;
  isDurationBased: boolean;
  isBodyweight: boolean;
  weightMode: LoggerWeightMode;
  userBodyweightKg?: number;
  /** The phone moves somewhere else after this set (superset rotation, dropset prompt). */
  nextSetElsewhere?: boolean;
}

/** Clamp a prescribed RIR to the 0-4 chip range (same rule as SetLoggerRow). */
export function clampRirToChip(rir: number): RepsInTank {
  const rounded = Math.round(rir);
  return Math.max(0, Math.min(4, Number.isFinite(rounded) ? rounded : 2)) as RepsInTank;
}

export function buildWatchState(input: {
  sessionId: string;
  exerciseName: string;
  exerciseNumber: number;
  exerciseCount: number;
  canPrev: boolean;
  canNext: boolean;
  /** The current block, for when its logger row isn't showing. */
  block: { id: string; targetSets: number; completedSets: number };
  unit: WeightUnit;
  /** Null when the current card shows no logger row. */
  logger: ActiveLoggerSnapshot | null;
  rest: WatchRestState | null;
  defaultRestSeconds: number;
}): WatchActiveState {
  const { logger, block } = input;
  const common = {
    v: WATCH_PROTOCOL_VERSION,
    active: true as const,
    sessionId: input.sessionId,
    blockId: block.id,
    exerciseName: input.exerciseName,
    exerciseNumber: input.exerciseNumber,
    exerciseCount: input.exerciseCount,
    canPrev: input.canPrev,
    canNext: input.canNext,
    rest: input.rest,
    defaultRestSeconds: Math.max(0, Math.round(input.defaultRestSeconds)),
  };

  if (!logger || logger.blockId !== block.id) {
    return {
      ...common,
      canLog: false,
      canQueueNext: false,
      allSetsDone: block.completedSets >= block.targetSets,
      setNumber: Math.min(block.completedSets + 1, Math.max(block.targetSets, 1)),
      targetSets: block.targetSets,
      weight: null,
      weightStep: weightStepForDisplay(undefined, input.unit),
      unit: input.unit,
      reps: 1,
      repsStep: 1,
      maxReps: maxRepsFor(false),
      repsLabel: 'reps',
      targetRir: 2,
    };
  }

  const plainBodyweight = logger.isBodyweight && logger.weightMode === 'bodyweight';
  const parsedWeight = parseFloat(logger.weight);
  const parsedReps = parseInt(logger.reps, 10);
  const maxReps = maxRepsFor(logger.isDurationBased);
  return {
    ...common,
    canLog: true,
    canQueueNext: !logger.nextSetElsewhere,
    allSetsDone: false,
    setNumber: logger.setNumber,
    targetSets: logger.targetSets,
    weight: plainBodyweight ? null : Number.isFinite(parsedWeight) ? parsedWeight : 0,
    weightStep: weightStepForDisplay(logger.minIncrementKg, logger.unit),
    unit: logger.unit,
    reps: Number.isFinite(parsedReps) ? Math.min(maxReps, Math.max(1, parsedReps)) : 1,
    repsStep: logger.isDurationBased ? 5 : 1,
    maxReps,
    repsLabel: logger.isDurationBased ? 'sec' : 'reps',
    targetRir: clampRirToChip(logger.targetRir),
  };
}

/**
 * Stable key for change detection: two states with the same key need no
 * resend. Rest `endsAt` is rounded to the second so a re-render that recomputes
 * it a few ms differently doesn't spam the watch.
 */
export function watchStateKey(state: WatchWorkoutState): string {
  if (!state.active) return 'inactive';
  const rest = state.rest
    ? { endsAt: Math.round(state.rest.endsAt / 1000), totalSeconds: state.rest.totalSeconds }
    : null;
  return JSON.stringify({ ...state, rest });
}

// ---------------------------------------------------------------------------
// Watch → phone
// ---------------------------------------------------------------------------

export interface WatchLogSetCommand {
  type: 'logSet';
  id: string;
  sessionId: string;
  blockId: string;
  setNumber: number;
  /** Display units; null for plain bodyweight. */
  weight: number | null;
  reps: number;
  rir: RepsInTank;
}

export interface WatchNavigateCommand {
  type: 'navigate';
  id: string;
  sessionId: string;
  blockId: string;
  direction: 'next' | 'prev';
}

export interface WatchFinishCommand {
  type: 'finish';
  id: string;
  sessionId: string;
}

export interface WatchRequestStateCommand {
  type: 'requestState';
  id: string;
}

export type WatchCommand =
  | WatchLogSetCommand
  | WatchNavigateCommand
  | WatchFinishCommand
  | WatchRequestStateCommand;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isPositiveInt = (v: unknown): v is number =>
  isFiniteNumber(v) && Number.isInteger(v) && v >= 1;

function parseLogSet(raw: Record<string, unknown>, id: string): WatchLogSetCommand | null {
  const { sessionId, blockId, setNumber, weight, reps, rir } = raw;
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(blockId) || !isPositiveInt(setNumber)) return null;
  const weightOk = weight === null || (isFiniteNumber(weight) && weight >= 0 && weight <= 2000);
  const repsOk = isPositiveInt(reps) && reps <= maxRepsFor(true);
  const rirOk = isFiniteNumber(rir) && Number.isInteger(rir) && rir >= 0 && rir <= 4;
  if (!weightOk || !repsOk || !rirOk) return null;
  return {
    type: 'logSet',
    id,
    sessionId,
    blockId,
    setNumber,
    weight: weight as number | null,
    reps,
    rir: rir as RepsInTank,
  };
}

function parseNavigate(raw: Record<string, unknown>, id: string): WatchNavigateCommand | null {
  const { sessionId, blockId, direction } = raw;
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(blockId)) return null;
  if (direction !== 'next' && direction !== 'prev') return null;
  return { type: 'navigate', id, sessionId, blockId, direction };
}

function parseFinish(raw: Record<string, unknown>, id: string): WatchFinishCommand | null {
  return isNonEmptyString(raw.sessionId) ? { type: 'finish', id, sessionId: raw.sessionId } : null;
}

/**
 * Validate a raw message from the native bridge. Anything malformed, from a
 * newer protocol, or out of range returns null and is ignored — the watch is
 * trusted no more than a form field.
 */
export function parseWatchCommand(raw: unknown): WatchCommand | null {
  if (!isObj(raw)) return null;
  if (raw.v !== undefined && raw.v !== WATCH_PROTOCOL_VERSION) return null;
  const { type, id } = raw;
  if (!isNonEmptyString(id)) return null;
  switch (type) {
    case 'logSet':
      return parseLogSet(raw, id);
    case 'navigate':
      return parseNavigate(raw, id);
    case 'finish':
      return parseFinish(raw, id);
    case 'requestState':
      return { type, id };
    default:
      return null;
  }
}

/**
 * Remembers recently handled message ids. WatchConnectivity may deliver a
 * queued `transferUserInfo` again after a relaunch, and the watch retries a
 * log it got no reply for — the same id must never log a second set.
 */
export function createMessageDeduper(capacity = 200) {
  const seen = new Set<string>();
  const order: string[] = [];
  return {
    /** True the first time an id is seen; false for a repeat. */
    accept(id: string): boolean {
      if (seen.has(id)) return false;
      seen.add(id);
      order.push(id);
      if (order.length > capacity) {
        const evicted = order.shift();
        if (evicted !== undefined) seen.delete(evicted);
      }
      return true;
    },
  };
}

export type WatchLogResolution =
  | { ok: true; input: BuildSetLogDataInput }
  | { ok: false; reason: 'wrong-session' | 'no-active-set' | 'stale' | 'invalid-weight' };

/**
 * Decide whether a watch "log set" still applies to what the phone shows, and
 * turn it into the shared payload-builder input. A command for another block
 * or an already-logged set number is STALE (the lifter logged on the phone in
 * the meantime, or the watch's snapshot is old) and is refused rather than
 * logged as an extra set; the phone then resends its state.
 */
export function resolveWatchLog(
  command: WatchLogSetCommand,
  context: { sessionId: string; logger: ActiveLoggerSnapshot | null }
): WatchLogResolution {
  if (command.sessionId !== context.sessionId) return { ok: false, reason: 'wrong-session' };
  const { logger } = context;
  if (!logger) return { ok: false, reason: 'no-active-set' };
  if (command.blockId !== logger.blockId || command.setNumber !== logger.setNumber) {
    return { ok: false, reason: 'stale' };
  }
  const plainBodyweight = logger.isBodyweight && logger.weightMode === 'bodyweight';
  if (!plainBodyweight && command.weight === null) return { ok: false, reason: 'invalid-weight' };
  if (
    !plainBodyweight &&
    !logger.isBodyweight &&
    !logger.isDurationBased &&
    (command.weight ?? 0) <= 0
  ) {
    // Same rule as the phone row: a weighted set needs a load (> 0).
    return { ok: false, reason: 'invalid-weight' };
  }
  return {
    ok: true,
    input: {
      weight: plainBodyweight ? NaN : (command.weight as number),
      reps: Math.min(command.reps, maxRepsFor(logger.isDurationBased)),
      rir: command.rir,
      unit: logger.unit,
      form: null,
      setType: 'normal',
      isBodyweight: logger.isBodyweight,
      weightMode: logger.weightMode,
      userBodyweightKg: logger.userBodyweightKg,
    },
  };
}

/**
 * Index of the neighbouring exercise for the watch's Next / Previous, in list
 * order, skipping blocks the lifter skipped today. -1 when there is none.
 */
export function neighborBlockIndex(
  blocks: ReadonlyArray<{ id: string }>,
  currentIndex: number,
  direction: 'next' | 'prev',
  skippedIds: ReadonlySet<string>
): number {
  const step = direction === 'next' ? 1 : -1;
  for (let i = currentIndex + step; i >= 0 && i < blocks.length; i += step) {
    if (!skippedIds.has(blocks[i].id)) return i;
  }
  return -1;
}
