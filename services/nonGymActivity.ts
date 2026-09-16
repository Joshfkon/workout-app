/**
 * nonGymActivity.ts — maps user-logged NON-GYM activities (bike rides, runs,
 * hikes, sports) into the muscle recovery model.
 *
 * The contract: an activity becomes a SYNTHETIC `RecoverySession` — the same
 * shape a completed training session feeds `computeMuscleRecovery` — so the
 * existing dose → window math handles it with zero engine changes. The
 * activity's perceived effort (light / moderate / hard) and duration are
 * converted into an effective-set dose per affected muscle; the recovery
 * heuristic does everything else (per-muscle windows, capacity normalization,
 * sleep/wearable/learned multipliers, clamps).
 *
 * What this file deliberately does NOT do:
 *  - feed weekly training volume (MEV/MAV/MRV counting) — an activity is
 *    recovery debt, not sets toward a muscle's weekly target;
 *  - touch progression or the weekly volume recommendation
 *    (weeklyProgressionEngine);
 *  - read a clock or a database — pure functions only, per /services rules.
 *
 * The dose numbers below are TUNABLE HEURISTIC STARTS, not physiology — the
 * same posture as RECOVERY_CONFIG in muscleRecovery.ts. Every tunable lives in
 * NON_GYM_ACTIVITY_CONFIG so the whole mapping can be re-tuned in one place.
 */

import {
  STANDARD_MUSCLE_GROUPS,
  type StandardMuscleGroup,
} from '@/types/schema';
import type { RecoverySession, RecoveryExercise } from '@/services/muscleRecovery';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Perceived effort of the activity itself — NOT a soreness report. */
export type ActivityIntensity = 'light' | 'moderate' | 'hard';

export type ActivityType = 'bike' | 'run' | 'swim' | 'hike' | 'sport' | 'other';

/** A non_gym_activities row, app-shaped. */
export interface NonGymActivity {
  id: string;
  /** When the activity happened — the recovery-debt clock. */
  performedAt: Date;
  activityType: ActivityType;
  /** Optional free-text label ("pickup basketball"). */
  name: string | null;
  durationMinutes: number | null;
  intensity: ActivityIntensity;
  muscleGroups: StandardMuscleGroup[];
}

// ---------------------------------------------------------------------------
// Tunables — edit here to re-tune the whole activity → fatigue mapping.
// ---------------------------------------------------------------------------

export interface NonGymActivityConfig {
  /**
   * Effective working sets a 60-minute activity contributes to EACH affected
   * muscle, by perceived effort. Calibrated against the recovery dose model
   * (muscleRecovery.computeDoseScale, capacity ≈ MRV / planned frequency):
   *  - light    → ~1 set: window lands on/near the 24h floor — "recovering
   *    today, fresh tomorrow";
   *  - moderate → ~3 sets: roughly half a focused session's dose — a large
   *    muscle reads recovering into the next day;
   *  - hard     → ~5 sets (2 of them "hard"): comparable to a solid training
   *    session — a Sunday hard ride keeps quads from reading Fresh until
   *    midweek, which is the pitch's motivating case.
   */
  setsByIntensity: Record<ActivityIntensity, number>;
  /** Of those sets, how many count as HARD (RIR ≤ hardRirThreshold). */
  hardSetsByIntensity: Record<ActivityIntensity, number>;
  /** RIR stamped on non-hard synthetic sets, by intensity. */
  easyRirByIntensity: Record<ActivityIntensity, number>;
  /** RIR stamped on hard synthetic sets — must be ≤ the recovery model's
   *  hardRirThreshold (1) or "hard" silently stops meaning anything. */
  hardSetRir: number;
  /** Duration that maps to exactly the base set counts above. */
  referenceDurationMinutes: number;
  /**
   * Duration scales the set counts linearly around the reference, clamped so
   * a 15-minute spin can't vanish (× min) and a 4-hour ride can't explode the
   * window beyond what one activity plausibly costs (× max). Missing duration
   * reads as the reference (scale 1).
   */
  durationScale: { min: number; max: number };
}

export const NON_GYM_ACTIVITY_CONFIG: NonGymActivityConfig = {
  setsByIntensity: { light: 1, moderate: 3, hard: 5 },
  hardSetsByIntensity: { light: 0, moderate: 0, hard: 2 },
  easyRirByIntensity: { light: 4, moderate: 2, hard: 2 },
  hardSetRir: 1,
  referenceDurationMinutes: 60,
  durationScale: { min: 0.5, max: 1.5 },
};

// ---------------------------------------------------------------------------
// Muscle picker options + presets — the one-tap entries in the logger UI.
// ---------------------------------------------------------------------------

/**
 * The region-level chips the logger offers. Users think "legs were trashed",
 * not "tibialis anterior" — each chip maps to the region's dominant movers,
 * and every mapped muscle takes the FULL per-muscle dose, so the lists stay
 * deliberately short.
 */
export interface ActivityMuscleOption {
  key: string;
  label: string;
  muscles: StandardMuscleGroup[];
}

export const ACTIVITY_MUSCLE_OPTIONS: ActivityMuscleOption[] = [
  { key: 'quads', label: 'Quads', muscles: ['quads'] },
  { key: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'] },
  { key: 'glutes', label: 'Glutes', muscles: ['glutes'] },
  { key: 'calves', label: 'Calves', muscles: ['calves'] },
  { key: 'back', label: 'Back', muscles: ['lats', 'upper_back'] },
  { key: 'lower_back', label: 'Lower back', muscles: ['erectors'] },
  { key: 'chest', label: 'Chest', muscles: ['chest_upper', 'chest_lower'] },
  { key: 'shoulders', label: 'Shoulders', muscles: ['front_delts', 'lateral_delts', 'rear_delts'] },
  { key: 'arms', label: 'Arms', muscles: ['biceps', 'triceps', 'forearms'] },
  { key: 'core', label: 'Core', muscles: ['abs', 'obliques'] },
];

export interface ActivityPreset {
  type: ActivityType;
  label: string;
  /** ACTIVITY_MUSCLE_OPTIONS keys pre-selected on tap (user can edit). */
  defaultOptionKeys: string[];
}

/**
 * Defaults are the regions the activity plainly taxes for a typical
 * recreational bout. 'sport' defaults to legs (most field and court sports
 * are leg-dominant); 'other' asserts nothing and makes the user choose.
 */
export const ACTIVITY_PRESETS: ActivityPreset[] = [
  { type: 'bike', label: 'Bike', defaultOptionKeys: ['quads', 'calves'] },
  { type: 'run', label: 'Run', defaultOptionKeys: ['quads', 'hamstrings', 'calves'] },
  { type: 'swim', label: 'Swim', defaultOptionKeys: ['back', 'shoulders'] },
  { type: 'hike', label: 'Hike', defaultOptionKeys: ['quads', 'glutes', 'calves'] },
  { type: 'sport', label: 'Sport', defaultOptionKeys: ['quads', 'hamstrings', 'calves'] },
  { type: 'other', label: 'Other', defaultOptionKeys: [] },
];

/** Flatten a set of option keys to the (deduped) muscles they cover. */
export function musclesForOptionKeys(keys: Iterable<string>): StandardMuscleGroup[] {
  const wanted = new Set(keys);
  const out = new Set<StandardMuscleGroup>();
  for (const option of ACTIVITY_MUSCLE_OPTIONS) {
    if (!wanted.has(option.key)) continue;
    for (const muscle of option.muscles) out.add(muscle);
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Activity → synthetic RecoverySession
// ---------------------------------------------------------------------------

const STANDARD_MUSCLE_SET: ReadonlySet<string> = new Set(STANDARD_MUSCLE_GROUPS);

/** Keep only tokens that are live StandardMuscleGroup values — a stale or
 *  hand-edited DB row must degrade to "fewer muscles", never corrupt doses. */
export function sanitizeMuscleGroups(tokens: readonly string[]): StandardMuscleGroup[] {
  const seen = new Set<StandardMuscleGroup>();
  for (const token of tokens) {
    if (STANDARD_MUSCLE_SET.has(token)) seen.add(token as StandardMuscleGroup);
  }
  return Array.from(seen);
}

/** Linear duration scale around the reference, clamped; null → 1. */
export function durationScaleFor(
  durationMinutes: number | null,
  config: NonGymActivityConfig = NON_GYM_ACTIVITY_CONFIG
): number {
  if (durationMinutes === null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return 1;
  }
  const raw = durationMinutes / config.referenceDurationMinutes;
  return Math.min(config.durationScale.max, Math.max(config.durationScale.min, raw));
}

/**
 * The synthetic set list for one affected muscle: total and hard counts scale
 * with duration (total never below 1 — the user logged SOMETHING), hard sets
 * carry `hardSetRir`, the rest the intensity's easy RIR.
 */
function syntheticSets(
  intensity: ActivityIntensity,
  scale: number,
  config: NonGymActivityConfig
): { repsInTank: number }[] {
  const total = Math.max(1, Math.round(config.setsByIntensity[intensity] * scale));
  const hard = Math.min(total, Math.round(config.hardSetsByIntensity[intensity] * scale));
  const easyRir = config.easyRirByIntensity[intensity];
  return Array.from({ length: total }, (_, i) => ({
    repsInTank: i < hard ? config.hardSetRir : easyRir,
  }));
}

/**
 * Map one activity to a synthetic completed session for the recovery model,
 * or null when it names no (valid) muscles — an activity that claims nothing
 * must not fabricate a zero-muscle session.
 *
 * Each affected muscle gets its own single-primary-muscle pseudo-exercise so
 * every listed muscle takes the full per-muscle dose; cross-muscle spillover
 * (e.g. a 'calves' tag partially reaching gastrocnemius/soleus) stays the
 * recovery model's business via its own family-flow rules.
 */
export function activityToRecoverySession(
  activity: Pick<NonGymActivity, 'performedAt' | 'durationMinutes' | 'intensity' | 'muscleGroups'>,
  config: NonGymActivityConfig = NON_GYM_ACTIVITY_CONFIG
): RecoverySession | null {
  const muscles = sanitizeMuscleGroups(activity.muscleGroups);
  if (muscles.length === 0) return null;

  const scale = durationScaleFor(activity.durationMinutes, config);
  const sets = syntheticSets(activity.intensity, scale, config);

  const exercises: RecoveryExercise[] = muscles.map((muscle) => ({
    primaryMuscle: muscle,
    secondaryMuscles: [],
    // Fresh copy per muscle — RecoverySets are plain data, but shared array
    // identity across exercises invites accidental mutation downstream.
    sets: sets.map((s) => ({ ...s })),
  }));

  return { performedAt: activity.performedAt, exercises };
}

// ---------------------------------------------------------------------------
// cardio_log bridge — existing Zone-2 tracker entries also create fatigue.
// ---------------------------------------------------------------------------

/**
 * Muscles a cardio_log modality taxes. The tracker's stated purpose is Zone-2
 * work, so bridged entries are ALWAYS treated as 'light' — a genuinely hard
 * ride belongs in the activity logger, where the user says so. 'other' is
 * deliberately absent: it claims no muscles, so it creates no fatigue.
 */
export const CARDIO_MODALITY_MUSCLES: Partial<Record<string, StandardMuscleGroup[]>> = {
  incline_walk: ['calves', 'glutes'],
  bike: ['quads', 'calves'],
  elliptical: ['quads', 'glutes'],
  rower: ['upper_back', 'lats', 'quads'],
};

export const CARDIO_BRIDGE_INTENSITY: ActivityIntensity = 'light';

/** The cardio_log columns the bridge needs. */
export interface CardioLogForRecovery {
  /** DATE-only local day ('YYYY-MM-DD'). */
  logged_at: string;
  minutes: number;
  modality: string;
  /** Row creation timestamp, when the caller selected it. */
  created_at?: string | null;
}

/**
 * `performed_at` for a date-only cardio row: the row's `created_at` when it
 * falls on the same LOCAL day as `logged_at` (the common log-it-right-after
 * case), else noon local on the logged day — a neutral midpoint that avoids
 * pinning a back-dated entry to the moment it was typed in.
 */
export function cardioPerformedAt(row: CardioLogForRecovery): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.logged_at);
  if (!match) return null;
  const [, y, m, d] = match;
  const noonLocal = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);

  if (row.created_at) {
    const created = new Date(row.created_at);
    if (
      !Number.isNaN(created.getTime()) &&
      created.getFullYear() === noonLocal.getFullYear() &&
      created.getMonth() === noonLocal.getMonth() &&
      created.getDate() === noonLocal.getDate()
    ) {
      return created;
    }
  }
  return noonLocal;
}

/**
 * Map one cardio_log row to a synthetic recovery session, or null for
 * modalities with no muscle mapping ('other', unknown) or unparseable dates.
 */
export function cardioLogToRecoverySession(
  row: CardioLogForRecovery,
  config: NonGymActivityConfig = NON_GYM_ACTIVITY_CONFIG
): RecoverySession | null {
  const muscles = CARDIO_MODALITY_MUSCLES[row.modality];
  if (!muscles || muscles.length === 0) return null;

  const performedAt = cardioPerformedAt(row);
  if (!performedAt) return null;

  return activityToRecoverySession(
    {
      performedAt,
      durationMinutes: Number.isFinite(row.minutes) && row.minutes > 0 ? row.minutes : null,
      intensity: CARDIO_BRIDGE_INTENSITY,
      muscleGroups: muscles,
    },
    config
  );
}
