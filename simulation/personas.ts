/**
 * The seven personas.
 *
 * Each one exists to stress a specific class of engine behaviour, named in its
 * `targets` field. They model BEHAVIOUR only — none of them computes what the
 * app should prescribe (see simulation/persona.ts for why that line matters).
 *
 * All randomness comes from the injected `Rng`, and every persona draws in a
 * fixed order, so a run replays exactly from its seed.
 */
import type { Rng } from './rng';
import {
  clampReportedRir,
  fatigueCost,
  fatiguedE1RM,
  honestAttempt,
  repsToFailure,
  type Persona,
  type PerformanceOutcome,
  type PersonaState,
  type SessionContext,
  type SetContext,
} from './persona';

/** Starting strength by exercise, with a fallback for anything unseeded. */
function startingE1RM(base: Record<string, number>, fallback: number) {
  return (exerciseId: string) => base[exerciseId] ?? fallback;
}

/** Multiply every tracked lift by `factor` (growth, stagnation or decay). */
function scaleAll(state: PersonaState, factor: number): void {
  state.trueE1RM.forEach((value, key) => state.trueE1RM.set(key, value * factor));
}

const DEFAULT_START = { 'ex-bench': 100, 'ex-row': 90, 'ex-squat': 130 };

// ---------------------------------------------------------------------------
// 1. Linear novice
// ---------------------------------------------------------------------------

/**
 * The baseline. Shows up, hits targets, gets stronger every session.
 *
 * If an invariant fails here the engine is broken, full stop — there is no
 * "well, the user was erratic" explanation available.
 */
export function linearNovice(): Persona {
  return {
    name: 'linear-novice',
    targets: 'baseline — any invariant failure here is unambiguous',
    initialE1RM: startingE1RM(DEFAULT_START, 60),
    attendSession: () => true,
    performSet: (ctx) => honestAttempt(ctx, { repNoise: 0.5 }),
    adaptAfterSession(state) {
      // ~1.5% per session: fast, steady novice gains.
      scaleAll(state, 1.015);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Chaotic intermediate
// ---------------------------------------------------------------------------

/**
 * ~70% adherence, ragged performance, sometimes walks out mid-session.
 *
 * Targets gap handling, partial sessions, and any assumption that sessions
 * arrive evenly spaced or complete.
 */
export function chaoticIntermediate(): Persona {
  return {
    name: 'chaotic-intermediate',
    targets: 'training gaps, abandoned sessions, uneven session spacing',
    initialE1RM: startingE1RM(DEFAULT_START, 70),
    attendSession: (ctx: SessionContext) => ctx.rng.bool(0.7),
    performSet(ctx: SetContext): PerformanceOutcome {
      // Abandonment is decided BEFORE the attempt, and only from set 2 on —
      // walking out before the first set of the session is a skip, not an
      // abandon, and the two must stay distinguishable in the trace.
      if (ctx.prescribed.setNumber > 1 && ctx.rng.bool(0.08)) {
        return { repsAchieved: 0, actualRIR: 0, reportedRIR: 0, disposition: 'abandoned' };
      }
      const outcome = honestAttempt(ctx, { repNoise: 1.4 });
      // Occasionally just stops 2–3 short of the ask for no physical reason.
      if (ctx.rng.bool(0.18) && outcome.repsAchieved > 3) {
        const short = ctx.rng.int(2, 3);
        return {
          ...outcome,
          repsAchieved: outcome.repsAchieved - short,
          actualRIR: outcome.actualRIR + short,
          reportedRIR: clampReportedRir(outcome.actualRIR + short),
        };
      }
      return outcome;
    },
    adaptAfterSession(state, rng) {
      scaleAll(state, 1 + rng.float(-0.004, 0.012));
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Detrainer
// ---------------------------------------------------------------------------

const DETRAINER_TRAIN_SESSIONS = 12; // ~4 weeks at 3x/week
const DETRAINER_LAYOFF_DAYS = 21;

/**
 * Trains four weeks, disappears three, comes back genuinely weaker.
 *
 * Targets staleness thresholds, trend gaps, and the post-inactivity
 * prescription — the engine must not treat a 3-week gap as uninterrupted
 * progression.
 */
export function detrainer(): Persona {
  let onLayoff = false;

  return {
    name: 'detrainer',
    targets: 'staleness windows, trend gaps, post-layoff prescriptions',
    initialE1RM: startingE1RM(DEFAULT_START, 80),
    attendSession(ctx: SessionContext) {
      if (onLayoff) {
        // The layoff ends when enough calendar time has passed, not after a
        // set number of skipped sessions — the engine's staleness rules are
        // keyed on days, so the persona must be too.
        if (ctx.state.daysSinceLastSession >= DETRAINER_LAYOFF_DAYS) {
          onLayoff = false;
          return true;
        }
        return false;
      }
      return true;
    },
    performSet: (ctx) => honestAttempt(ctx, { repNoise: 0.7 }),
    onSessionStart(state) {
      // Detraining lands on RETURN, before a single set — proportional to the
      // gap actually taken (~4% of capacity per week away). Applying it after
      // the comeback session would hand the engine a lifter still at their
      // pre-layoff strength on exactly the session this persona exists to test.
      if (state.daysSinceLastSession > 7) {
        const weeksOff = state.daysSinceLastSession / 7;
        scaleAll(state, Math.max(0.7, 1 - 0.04 * weeksOff));
      }
    },
    adaptAfterSession(state) {
      if (state.sessionsCompleted % DETRAINER_TRAIN_SESSIONS === 0) {
        onLayoff = true;
      } else {
        scaleAll(state, 1.008);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Ego lifter
// ---------------------------------------------------------------------------

/**
 * Grinds every set to failure and then claims two in the tank.
 *
 * Targets autoregulation robustness to systematically biased input: the engine
 * only ever sees `reportedRIR`, so it should keep pushing a lifter who is
 * already maxed. Whether that is a BUG is a product question — the harness's
 * job is to make the behaviour visible and reproducible.
 */
export function egoLifter(): Persona {
  return {
    name: 'ego-lifter',
    targets: 'autoregulation under systematically over-reported RIR',
    initialE1RM: startingE1RM(DEFAULT_START, 90),
    attendSession: () => true,
    performSet(ctx: SetContext): PerformanceOutcome {
      const honest = honestAttempt(ctx, { repNoise: 0.6 });
      // Pushes closer to failure than asked...
      const actualRIR = Math.max(0, honest.actualRIR - ctx.rng.int(1, 2));
      // ...and then reports the target back regardless.
      return {
        ...honest,
        actualRIR,
        reportedRIR: clampReportedRir(actualRIR + ctx.rng.int(1, 2)),
      };
    },
    adaptAfterSession(state) {
      // Training near failure constantly: real but slow progress.
      scaleAll(state, 1.004);
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Plateauer
// ---------------------------------------------------------------------------

/**
 * Underlying strength dead flat for months, with ordinary day-to-day noise.
 *
 * Targets runaway ratcheting: a good day must not be read as progress and
 * compounded, because the next session's noise will not sustain it.
 */
export function plateauer(): Persona {
  return {
    name: 'plateauer',
    targets: 'ratcheting from noise; progression against flat true capacity',
    initialE1RM: startingE1RM(DEFAULT_START, 110),
    attendSession: () => true,
    performSet: (ctx) => honestAttempt(ctx, { repNoise: 1.1 }),
    adaptAfterSession(state, rng) {
      // Mean-reverting jitter, zero drift: individual sessions vary, the
      // underlying capacity does not move.
      scaleAll(state, 1 + rng.float(-0.006, 0.006));
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Short-set specialist
// ---------------------------------------------------------------------------

/**
 * Consistently falls short of the rep target, at genuine max effort — NOT
 * sandbagging. Reported RIR is honest and low.
 *
 * This is the persona aimed squarely at the Set-3 contract: a set that misses
 * the target at or below the target RIR must not be answered with the same
 * unattained (load, reps) again.
 */
export function shortSetSpecialist(): Persona {
  return {
    name: 'short-set-specialist',
    targets: 'REGRESSION_SET3_UNATTAINED_TARGET — repeated unattainable targets',
    initialE1RM: startingE1RM(DEFAULT_START, 100),
    attendSession: () => true,
    performSet(ctx: SetContext): PerformanceOutcome {
      const { prescribed, state, rng } = ctx;
      const capacity = fatiguedE1RM(state, prescribed.exerciseId);
      const ceiling = repsToFailure(capacity, prescribed.weightKg) + rng.normal(0, 0.5);

      // Takes every set to genuine failure and lands short of the ask.
      const maxReps = Math.max(0, Math.round(ceiling));
      const repsAchieved = Math.min(prescribed.reps, maxReps);
      const actualRIR = 0;

      state.sessionFatigue += fatigueCost(actualRIR);

      return {
        repsAchieved,
        actualRIR,
        // Honest: they really were at zero in the tank.
        reportedRIR: 0,
        disposition: 'completed',
      };
    },
    adaptAfterSession(state) {
      scaleAll(state, 1.002);
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Messy editor
// ---------------------------------------------------------------------------

/**
 * Trains normally but constantly revises the log: edits sets after the fact,
 * deletes them, abandons and resumes.
 *
 * Targets stale references, aggregate recalculation, event ordering and
 * idempotency. Behaviourally near-linear on purpose — the interesting variable
 * is the mutation pattern, not the lifting, and mixing both would make a
 * failure ambiguous.
 */
export function messyEditor(): Persona {
  return {
    name: 'messy-editor',
    targets: 'stale references, recalculation, event ordering, idempotency',
    initialE1RM: startingE1RM(DEFAULT_START, 85),
    attendSession: () => true,
    performSet: (ctx) => honestAttempt(ctx, { repNoise: 0.9 }),
    adaptAfterSession(state) {
      scaleAll(state, 1.008);
    },
    editsSets: true,
  };
}

// ---------------------------------------------------------------------------

export const PERSONAS = {
  'linear-novice': linearNovice,
  'chaotic-intermediate': chaoticIntermediate,
  detrainer,
  'ego-lifter': egoLifter,
  plateauer,
  'short-set-specialist': shortSetSpecialist,
  'messy-editor': messyEditor,
} as const;

export type PersonaName = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as PersonaName[];

export function createPersona(name: PersonaName): Persona {
  const factory = PERSONAS[name];
  if (!factory) throw new Error(`Unknown persona: ${name}`);
  return factory();
}
