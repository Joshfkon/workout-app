/**
 * Persona contract — the simulated human.
 *
 * THE GOVERNING RULE
 * ------------------
 * A persona models USER BEHAVIOUR. It must never model what HyperTracker
 * should prescribe. It is handed a prescription and answers one question:
 * "given this ask, what would this person actually do?"
 *
 * That line matters more than it sounds. The moment a persona computes an
 * expected target and compares it to the engine's, the harness stops being a
 * state-integrity checker and becomes a second, unvalidated prescription
 * engine — and every disagreement becomes a bug report about the harness.
 *
 * WHAT THE ENGINE SEES, AND WHAT IT DOES NOT
 * ------------------------------------------
 * The simulator keeps hidden ground truth: true strength per exercise,
 * accumulated fatigue, detraining, and the person's ACTUAL proximity to
 * failure. The engine only ever receives what a real user would type:
 * `repsAchieved` and `reportedRIR`.
 *
 * `actualRIR` is simulator-only. It exists so a persona can lie consistently
 * (the ego lifter) and so assertions can ask "was the engine's picture of this
 * lifter ever right?" without leaking the answer into the engine's inputs.
 * If `actualRIR` ever reaches a production function, that is a harness bug.
 *
 * MODELLING A BODY IS ALLOWED
 * ---------------------------
 * Inverting a strength curve to decide how many reps a body can do at a load
 * is modelling the PERSON, not the engine, and it is the only way a persona
 * can respond to a prescription it has never seen before. Epley is used here
 * for the same reason the app uses it — it is a reasonable, invertible
 * approximation — and NOT because the engine uses it. The two are independent
 * on purpose: if the engine's estimator changed tomorrow, this would not.
 */
import type { Rng } from './rng';

/** What a simulated user did with one prescribed set. */
export interface PerformanceOutcome {
  repsAchieved: number;
  /** Ground truth proximity to failure. SIMULATOR ONLY — never given to the engine. */
  actualRIR: number;
  /** The only RIR the engine ever sees. */
  reportedRIR: number;
  disposition: 'completed' | 'skipped' | 'abandoned';
}

/** The engine's ask, as the persona receives it. */
export interface PrescribedSet {
  weightKg: number;
  reps: number;
  /** Target reps-in-reserve for the set. */
  rir: number;
  /** Which set of the exercise this is (1-based). */
  setNumber: number;
  exerciseId: string;
}

/**
 * Hidden state carried across a simulated lifetime. Mutable by design — a
 * persona's body changes as it trains, rests and detrains.
 */
export interface PersonaState {
  /** True e1RM per exercise (kg). The number the engine is trying to discover. */
  trueE1RM: Map<string, number>;
  /** Within-session accumulated fatigue, 0 = fresh. Reset at session start. */
  sessionFatigue: number;
  /** Completed sessions, all time. */
  sessionsCompleted: number;
  /** Local day of the last completed session, or null before the first. */
  lastTrainedDay: string | null;
  /** Consecutive days without training, updated at session start. */
  daysSinceLastSession: number;
}

export function createPersonaState(initialE1RM: Record<string, number> = {}): PersonaState {
  return {
    trueE1RM: new Map(Object.entries(initialE1RM)),
    sessionFatigue: 0,
    sessionsCompleted: 0,
    lastTrainedDay: null,
    daysSinceLastSession: 0,
  };
}

/** Everything a persona needs to decide one set. */
export interface SetContext {
  prescribed: PrescribedSet;
  state: PersonaState;
  rng: Rng;
}

/** Everything a persona needs to decide whether to train today. */
export interface SessionContext {
  state: PersonaState;
  rng: Rng;
  /** Local `YYYY-MM-DD` of the day being considered. */
  today: string;
}

export interface Persona {
  readonly name: string;
  /** One line on what this persona is FOR — which bug class it targets. */
  readonly targets: string;

  /** Starting true strength, per exercise id. */
  initialE1RM(exerciseId: string): number;

  /** Whether the user shows up at all today. */
  attendSession(ctx: SessionContext): boolean;

  /**
   * Called once when a session begins, BEFORE any set is performed.
   *
   * This is where anything that changes the body between sessions belongs —
   * detraining above all. Applying a layoff's cost after the comeback session
   * would let the engine meet a lifter who is still at their pre-layoff
   * strength, which is precisely the case the detrainer persona exists to
   * probe. Fatigue reset is handled by `beginSession`, not here.
   */
  onSessionStart?(state: PersonaState, rng: Rng): void;

  /** What the user does with one prescribed set. */
  performSet(ctx: SetContext): PerformanceOutcome;

  /**
   * Applied once per completed session: how the hidden body changes. Growth,
   * stagnation and detraining all live here.
   */
  adaptAfterSession(state: PersonaState, rng: Rng): void;

  /** Whether the user messes with already-logged sets. Default: never. */
  editsSets?: boolean;
}

// ---------------------------------------------------------------------------
// The body model (simulator-side, deliberately independent of the engine)
// ---------------------------------------------------------------------------

const EPLEY_DIVISOR = 30;

/**
 * Reps this body could complete at `weightKg` before true failure, given its
 * current true e1RM. Inverted Epley: reps = 30 · (E/W − 1).
 *
 * Returns 0 when the load meets or exceeds true capacity — the load simply
 * cannot be moved. A caller must handle that as a failed set, not as a
 * negative rep count.
 */
export function repsToFailure(trueE1RMKg: number, weightKg: number): number {
  if (weightKg <= 0) return 0;
  if (trueE1RMKg <= weightKg) return trueE1RMKg === weightKg ? 1 : 0;
  return EPLEY_DIVISOR * (trueE1RMKg / weightKg - 1);
}

/**
 * Fatigue cost of one working set, as a fraction of capacity.
 *
 * Deliberately crude and monotonic: harder sets cost more, and the cost
 * accumulates within a session. Its exact shape is not a claim about exercise
 * science — it exists so late sets in a session are genuinely harder than
 * early ones, which is the property the prescription engine's per-set rep
 * decline is supposed to anticipate.
 */
export function fatigueCost(actualRIR: number): number {
  return 0.012 + 0.008 * Math.max(0, 3 - actualRIR);
}

/** Effective capacity right now, after within-session fatigue. */
export function fatiguedE1RM(state: PersonaState, exerciseId: string): number {
  const base = state.trueE1RM.get(exerciseId) ?? 0;
  return base * (1 - Math.min(0.25, state.sessionFatigue));
}

/**
 * The default "honest lifter" response to a prescription.
 *
 * Attempts the prescribed reps, stops there if they were reachable, and falls
 * short if they were not. Reported RIR equals actual (honest reporting);
 * personas that bias reporting override that themselves.
 *
 * `repNoise` is day-to-day variation — sleep, caffeine, whether the bar felt
 * right — applied to how many reps the body has today.
 */
export function honestAttempt(ctx: SetContext, opts: { repNoise?: number } = {}): PerformanceOutcome {
  const { prescribed, state, rng } = ctx;
  const capacity = fatiguedE1RM(state, prescribed.exerciseId);
  const noise = opts.repNoise ?? 0.8;

  const ceiling = repsToFailure(capacity, prescribed.weightKg) + rng.normal(0, noise);
  const maxReps = Math.max(0, Math.round(ceiling));

  const repsAchieved = Math.min(prescribed.reps, maxReps);
  const actualRIR = Math.max(0, maxReps - repsAchieved);

  state.sessionFatigue += fatigueCost(actualRIR);

  return {
    repsAchieved,
    actualRIR,
    reportedRIR: actualRIR,
    disposition: 'completed',
  };
}

/**
 * Start a session: clear within-session fatigue, then let the persona apply
 * anything that happened since last time. Always use this rather than resetting
 * fatigue by hand, so the ordering stays the same everywhere.
 */
export function beginSession(persona: Persona, state: PersonaState, rng: Rng): void {
  state.sessionFatigue = 0;
  persona.onSessionStart?.(state, rng);
}

/** RIR as the app records it: an integer chip in 0..4. */
export function clampReportedRir(rir: number): number {
  return Math.max(0, Math.min(4, Math.round(rir)));
}

/** The RPE the engine stores for a reported RIR. */
export function rirToReportedRpe(reportedRIR: number): number {
  return Math.max(1, Math.min(10, 10 - reportedRIR));
}
