// ============================================================
// INTAKE PACING ENGINE
//
// One source of truth for "is my intake on pace for this time of day".
// Shared by the Home dashboard's Nutrition glance tile / meal hero and the
// Log page's Today So Far macro grid, so both surfaces always agree.
//
// Model (linear, v1): expected-by-now = daily target x the fraction of the
// eating window that has elapsed. A learned intraday curve (median cumulative
// intake once >= 28 days of timestamped logs exist) is a planned follow-up
// behind a flag; food_log rows are date-keyed today, so linear ships first.
//
// Pure functions only — no database calls (see CLAUDE.md /services rule).
// ============================================================

/** Training phase, normalized to the three pacing directions. */
export type PacingPhase = 'bulk' | 'cut' | 'maintenance';

export type PaceMacro = 'calories' | 'protein' | 'carbs' | 'fat';

/** One-word status shown under the tile numbers (never color alone). */
export type PaceStatus = 'on pace' | 'behind' | 'ahead';

/**
 * Color band for the tile. `neutral` = no judgment (pre-window, no target,
 * or the phase says this direction is fine); `green` = on pace / desirable;
 * `yellow` / `orange` = increasingly off pace in a direction the phase warns
 * about.
 */
export type PaceTone = 'neutral' | 'green' | 'yellow' | 'orange';

/** Eating window in minutes-from-midnight (default 07:00-21:00). */
export interface EatingWindow {
  startMinutes: number;
  endMinutes: number;
}

export const DEFAULT_EATING_WINDOW: EatingWindow = {
  startMinutes: 7 * 60,
  endMinutes: 21 * 60,
};

/**
 * No pacing judgment before the window starts or within its first hour —
 * "behind" at 6 a.m. is noise, not signal.
 */
export const PACING_GRACE_MINUTES = 60;

/**
 * Deviation bands relative to expected-by-now, per macro. Within +/-inner
 * reads on-pace; between inner and mid is a gentle warn (yellow); beyond mid
 * is a strong warn (orange). Carbs/fat are the flexible macros, so their
 * bands are twice as wide as calories/protein.
 */
const PACE_BANDS: Record<PaceMacro, { inner: number; mid: number }> = {
  calories: { inner: 0.1, mid: 0.25 },
  protein: { inner: 0.1, mid: 0.25 },
  carbs: { inner: 0.2, mid: 0.35 },
  fat: { inner: 0.2, mid: 0.35 },
};

/** Bulking: over the daily TOTAL target by more than this reads gentle yellow. */
const BULK_OVER_TOTAL_TOLERANCE = 0.15;

export interface PaceVerdict {
  status: PaceStatus;
  tone: PaceTone;
  /** Target x elapsed window fraction — what "on pace" consumption looks like now. */
  expected: number;
  /** Elapsed fraction of the eating window, clamped to [0, 1]. */
  fraction: number;
  /** True when judgment was suppressed (pre-window / first hour / no target). */
  suppressed: boolean;
}

export interface AssessIntakePaceInput {
  macro: PaceMacro;
  consumed: number;
  /** Daily target; null/0 yields a neutral verdict. */
  target: number | null | undefined;
  phase: PacingPhase;
  now?: Date;
  window?: EatingWindow;
}

/**
 * Map the app's goal vocabularies (users.goal 'bulk'|'cut'|'maintenance',
 * plus legacy 'maintain'/'recomp') onto the three pacing directions.
 */
export function normalizePacingPhase(goal: string | null | undefined): PacingPhase {
  if (goal === 'bulk' || goal === 'cut') return goal;
  return 'maintenance';
}

/** Minutes from midnight in local time. */
function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Elapsed fraction of the eating window at `now`, clamped to [0, 1]. */
export function eatingWindowFraction(
  now: Date,
  window: EatingWindow = DEFAULT_EATING_WINDOW
): number {
  const span = window.endMinutes - window.startMinutes;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (minutesOfDay(now) - window.startMinutes) / span));
}

/**
 * Assess whether intake of one macro is on pace for the current time of day.
 *
 * Band logic (deviation = (consumed - expected) / expected):
 *   within +/-inner  -> 'on pace', green
 *   short by inner..mid -> 'behind', yellow*   (orange beyond mid)
 *   over by inner..mid  -> 'ahead',  yellow*   (orange beyond mid)
 * ...where * is then filtered by phase direction:
 *   bulk        — behind warns; ahead is green unless consumed exceeds the
 *                 DAILY total target by >15% (gentle yellow, never orange).
 *   cut         — ahead warns; behind is neutral (undereating pace is fine).
 *   maintenance — symmetric: both directions warn.
 *   protein     — behind ALWAYS warns, regardless of phase.
 */
export function assessIntakePace(input: AssessIntakePaceInput): PaceVerdict {
  const {
    macro,
    consumed,
    target,
    phase,
    now = new Date(),
    window = DEFAULT_EATING_WINDOW,
  } = input;

  const fraction = eatingWindowFraction(now, window);

  if (target == null || target <= 0) {
    return { status: 'on pace', tone: 'neutral', expected: 0, fraction, suppressed: true };
  }

  const expected = target * fraction;

  // Pre-window / first-hour grace: everything reads neutral.
  if (minutesOfDay(now) < window.startMinutes + PACING_GRACE_MINUTES) {
    return { status: 'on pace', tone: 'neutral', expected, fraction, suppressed: true };
  }

  const bands = PACE_BANDS[macro];
  const deviation = (consumed - expected) / expected;

  if (Math.abs(deviation) <= bands.inner) {
    return { status: 'on pace', tone: 'green', expected, fraction, suppressed: false };
  }

  const severity: PaceTone = Math.abs(deviation) <= bands.mid ? 'yellow' : 'orange';

  if (deviation < 0) {
    // Behind pace. Protein always warns; otherwise only phases where a
    // shortfall works against the goal (bulk) or off-plan (maintenance).
    const warns = macro === 'protein' || phase === 'bulk' || phase === 'maintenance';
    return {
      status: 'behind',
      tone: warns ? severity : 'neutral',
      expected,
      fraction,
      suppressed: false,
    };
  }

  // Ahead of pace.
  if (phase === 'bulk') {
    // Surplus is the goal; only flag blowing past the daily TOTAL target.
    const overTotal = consumed > target * (1 + BULK_OVER_TOTAL_TOLERANCE);
    return {
      status: 'ahead',
      tone: overTotal ? 'yellow' : 'green',
      expected,
      fraction,
      suppressed: false,
    };
  }
  return { status: 'ahead', tone: severity, expected, fraction, suppressed: false };
}
