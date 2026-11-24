/**
 * Lift-trend summary for the home "Lifts" glance tile: which of the user's
 * main lifts are rising / flat / declining, plus the longest-running stall.
 *
 * Shared by the dashboard's server initial-data path, the client full-fetch
 * path, AND the Progress (analytics) Strength tab's lift-trend detail list
 * (same pattern as weeklyVolume.ts) — the tile's aggregate and the detail
 * view are both derived from this one function so they can never disagree.
 * Pure: no React, no Supabase client — callers pass the queried session
 * rows in, selected with LIFT_TREND_SESSION_SELECT.
 *
 * Machine lifts (progression scope `local`) trained at more than one gym in
 * the window are trended PER GYM (services/locationTracks): machines read
 * differently, and a single fitted line across them turns a gym switch into
 * a fake regression or a fake "equipment change".
 */

import { getLocalDateString } from '@/lib/utils';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';
import {
  analyzeExerciseTrend,
  detectPlateau,
  MIN_SESSIONS_AFTER_DISCONTINUITY,
  MIN_TREND_SPAN_DAYS,
  type PlateauDetectionResult,
  type PlateauGoal,
} from '@/services/plateauDetector';
import type { ExercisePerformanceSnapshot } from '@/types/schema';
import { deriveProgressionScope, resolveEffectiveLocation } from '@/services/progressionScope';
import {
  locationIdForTrack as locationIdFromTrack,
  trackKeyFor,
  trackLabel,
} from '@/services/locationTracks';

export type LiftDirection = 'rising' | 'flat' | 'down';

/** One top-set E1RM point per completed session (for sparklines/detail). */
export interface LiftTrendPoint {
  /** Local session date, YYYY-MM-DD. */
  date: string;
  /** Estimated 1RM of the session's top set, in kg. */
  e1rmKg: number;
  /** The top set itself (the one `e1rmKg` came from): load in kg… */
  topSetWeightKg: number;
  /** …and reps, as logged. */
  topSetReps: number;
  /**
   * …and its logged RPE (null = none logged, which the estimator counts as
   * taken to failure). Absent on summaries persisted before it was carried.
   */
  topSetRpe?: number | null;
}

export interface LiftTrend {
  exerciseId: string;
  /**
   * Unique per row: the exercise id, suffixed with the gym track when this
   * lift is split by gym. Use as the React key.
   */
  seriesKey: string;
  name: string;
  /**
   * Gym this trend is computed within, when the lift is split by gym (machine
   * lift trained at 2+ gyms in the window); null for a single combined trend.
   */
  locationId: string | null;
  /** Display name for `locationId`; null when not split. */
  locationLabel: string | null;
  direction: LiftDirection;
  /** Weekly E1RM change as % of current E1RM (regression slope). */
  weeklyChangePct: number;
  /** Latest session's top-set E1RM in kg. */
  currentE1RMKg: number;
  /** Completed sessions with working sets inside the window. */
  sessionCount: number;
  /** Per-session top-set E1RM history, oldest first. */
  history: LiftTrendPoint[];
  /**
   * True when the lift's recent sessions span a program/mesocycle boundary
   * and it has fewer than MIN_SESSIONS_FOR_TREND sessions since the switch —
   * new exercise selection, rep ranges, and fatigue make the fitted trend
   * noise until a few sessions rebuild it. Same confidence-gating idea as
   * AMRAP calibration: show the data, don't shout a verdict. Also true while
   * the trend rebuilds after a data discontinuity (equipment change) — see
   * calibrationReason.
   */
  lowConfidence: boolean;
  /** Why the lift is calibrating, when lowConfidence is true. */
  calibrationReason: 'program_change' | 'equipment_change' | null;
  /**
   * Session dates the robust fit rejected as outliers — surfaced so the UI
   * can mark them instead of silently dropping data.
   */
  excludedDates: string[];
  /** Session date the current calibration segment starts at, if any. */
  discontinuityDate: string | null;
  /**
   * The plateau verdict (with its suggestions) when this lift is stalled;
   * null when it isn't, or while it is calibrating — the same detector run
   * that feeds `stalled`, kept per lift for the lift's own screen.
   */
  plateau: PlateauDetectionResult | null;
  /**
   * Set when the lift has its MIN_SESSIONS_FOR_TREND workouts but the fit
   * still can't give a real weekly rate — too short a span (three workouts
   * in a few days, or all on one day, fit a slope of exactly 0) or too few
   * usable points. The UI shows "Not enough data yet" and what's needed,
   * never a %/week; the lift is not counted rising/flat/down and gets no
   * stall verdict. Null when the rate is real. Optional: summaries persisted
   * before it was added lack it.
   */
  notEnoughData?: LiftNotEnoughData | null;
}

/** Why a lift with enough workouts still has no weekly rate. */
export interface LiftNotEnoughData {
  /**
   * 'short_span': the workouts are too close together in time.
   * 'few_workouts': too few usable workouts (after outliers / a reset).
   */
  reason: 'short_span' | 'few_workouts';
  /** More workouts with this lift needed (at least 1). */
  workoutsNeeded: number;
  /** Days between the first and last workout the fit used. */
  spanDays: number;
  /**
   * 'short_span' only: the first local day (YYYY-MM-DD) a workout with this
   * lift makes the span long enough. Null for 'few_workouts'.
   */
  readyOn: string | null;
}

/** A lift trained in the window without enough sessions for a trend yet. */
export interface EarlyLift {
  name: string;
  sessions: number;
  /** Heaviest top set in the window (load in kg, reps as logged). */
  bestWeightKg: number;
  bestReps: number;
  /**
   * The first and the most recent session's top set (the set with the highest
   * estimated max that session), so the card can show "first → latest"
   * before a trend exists. Optional: older persisted summaries lack them.
   */
  firstWeightKg?: number;
  firstReps?: number;
  latestWeightKg?: number;
  latestReps?: number;
  /**
   * Each workout's top set, oldest first (1–2 of them), so the card can
   * draw the sessions that exist instead of no chart until a trend (UX panel
   * r22, Maya: "only a basic comparison and no chart"). Optional: older
   * persisted summaries lack it.
   */
  points?: EarlyLiftPoint[];
}

/** One workout's top set for an early (pre-trend) lift. */
export interface EarlyLiftPoint {
  /** Local day, YYYY-MM-DD. */
  date: string;
  weightKg: number;
  /** Lift trends skip duration exercises, so these are real reps. */
  topSetReps: number;
  /** Estimated max of that set (kg), what the chart plots. */
  e1rmKg: number;
}

export interface LiftTrendsSummary {
  /** Tracked lifts, ordered rising → flat → down (for the dot strip). */
  lifts: LiftTrend[];
  /** Confident (not lowConfidence) lifts only — the headline counts. */
  rising: number;
  flat: number;
  down: number;
  /** Classified lifts currently low-confidence (program just changed). */
  rebuilding: number;
  /**
   * Lifts with enough workouts whose rate isn't real yet (`notEnoughData`):
   * not in rising/flat/down, not in `rebuilding`. Optional: older persisted
   * summaries lack it.
   */
  tooEarly?: number;
  /**
   * Lifts trained in the window that don't yet have enough sessions
   * (< MIN_SESSIONS_FOR_TREND) to classify at all.
   */
  insufficientData: number;
  /**
   * Completed sessions the summary was computed over (the caller's window).
   * Home uses 0 to tell a food-only user from a lifter. Optional: older
   * persisted summaries predate it.
   */
  sessionsInWindow?: number;
  /**
   * Those not-yet-trended lifts with their best recent set, so the Strength
   * tab can show real numbers before a trend exists (heaviest top set in the
   * window; most-trained first, capped at MAX_TRACKED_LIFTS).
   */
  earlyLifts?: EarlyLift[];
  /** Longest-running plateaued lift, e.g. Bench stalled 3 wks. */
  stalled: { name: string; weeks: number } | null;
  /** Days of history the summary was computed over. */
  windowDays: number;
  /**
   * The per-lift series behind `lifts` (every lift in the window, not only
   * the tracked ten), for the Strength tab's "Strength by muscle" rollup —
   * so that card rolls up EXACTLY these lifts, window and e1RMs instead of a
   * second fetch that could disagree. Only present when requested
   * (`includeRollup`); older persisted summaries lack it.
   */
  rollup?: LiftRollupInput;
}

/** One trended series (a lift, or a machine lift at one gym). */
export interface LiftRollupSeries {
  /** Same as LiftTrend.seriesKey. */
  key: string;
  exerciseId: string;
  /** Display name, with the gym when the lift is split by gym. */
  name: string;
  /** The exercise's primary muscle; null when unknown (skipped by the rollup). */
  muscle: string | null;
  snapshots: ExercisePerformanceSnapshot[];
  /** User-marked "different equipment" session dates on this series. */
  boundaries: string[];
}

export interface LiftRollupInput {
  series: LiftRollupSeries[];
  goal?: PlateauGoal;
  /** Program start as a local YYYY-MM-DD (already normalized). */
  programStartDate: string | null;
}

/**
 * Plain inputs for services/progressionInsights.getMuscleGroupProgression,
 * keyed by series key (so a lift split by gym rolls up per gym, as it trends).
 */
export function muscleProgressionInputFromRollup(rollup: LiftRollupInput): {
  snapshotsByExercise: Map<string, ExercisePerformanceSnapshot[]>;
  muscleByExercise: Map<string, string>;
  exerciseNames: Map<string, string>;
  discontinuitiesByExercise: Map<string, string[]>;
} {
  const snapshotsByExercise = new Map<string, ExercisePerformanceSnapshot[]>();
  const muscleByExercise = new Map<string, string>();
  const exerciseNames = new Map<string, string>();
  const discontinuitiesByExercise = new Map<string, string[]>();
  for (const s of rollup.series) {
    snapshotsByExercise.set(s.key, s.snapshots);
    if (s.muscle) muscleByExercise.set(s.key, s.muscle);
    exerciseNames.set(s.key, s.name);
    if (s.boundaries.length > 0) discontinuitiesByExercise.set(s.key, s.boundaries);
  }
  return { snapshotsByExercise, muscleByExercise, exerciseNames, discontinuitiesByExercise };
}

/**
 * The ONE select every caller must use, so the home tile, the dashboard's
 * client refresh and the Progress tab compute over identical data.
 */
export const LIFT_TREND_SESSION_SELECT = `id, completed_at, location_id, gym_locations (name),
  exercise_blocks (id, equipment_changed, location_id, gym_locations (name),
    exercises (id, name, primary_muscle, exercise_type, equipment_required, is_bodyweight, progression_scope_override),
    set_logs (weight_kg, reps, rpe, is_warmup))`;

/** Completed-session row shape expected from the workout_sessions query. */
export interface LiftTrendSessionRow {
  id: string;
  completed_at: string | null;
  /** Gym the session happened at (null = legacy / not recorded). */
  location_id?: string | null;
  gym_locations?: { name: string | null } | null;
  exercise_blocks: {
    /** Block id — lets sets still queued in the offline outbox join their block. */
    id?: string;
    exercises: {
      id: string;
      name: string;
      /** Feeds the Strength tab's "Strength by muscle" rollup. */
      primary_muscle?: string | null;
      exercise_type?: string | null;
      equipment_required?: string[] | null;
      is_bodyweight?: boolean | null;
      progression_scope_override?: 'global' | 'local' | null;
    } | null;
    /** Per-exercise location override (null = follows the session). */
    location_id?: string | null;
    gym_locations?: { name: string | null } | null;
    /** User marked this session's equipment as different (segment boundary). */
    equipment_changed?: boolean | null;
    set_logs: {
      weight_kg: number | null;
      reps: number | null;
      rpe?: number | null;
      is_warmup: boolean | null;
    }[] | null;
  }[] | null;
}

/** Sessions of history required before a lift is classified. */
export const MIN_SESSIONS_FOR_TREND = 3;

/** At most this many lifts feed the tile (the user's most-trained ones). */
export const MAX_TRACKED_LIFTS = 10;

/** History window every caller must query with (keeps tile and detail views
 *  computing over identical data). */
export const LIFT_TREND_WINDOW_DAYS = 84;

/**
 * Weekly E1RM change (%/wk) within ±this band counts as "flat". Exported so
 * the Progress copy states the real threshold (components/analytics/trendHelp).
 */
export const FLAT_BAND_PCT = 0.15;

/** Local YYYY-MM-DD `days` after a local YYYY-MM-DD day (calendar days). */
function addLocalDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + days);
  return getLocalDateString(d);
}

/**
 * Whether a fitted e1RM trend gives a real weekly rate, and if not, what is
 * missing. Pure; exported for tests. `usedDates` are the dates the fit used
 * (oldest first) — the span counts from the first of them.
 */
export function liftRateReadiness(
  trend: { confidence?: 'high' | 'low' | 'insufficient'; pointsUsed?: number; spanDays?: number },
  usedDates: readonly string[]
): LiftNotEnoughData | null {
  const points = trend.pointsUsed ?? usedDates.length;
  if (trend.confidence === 'insufficient' || points < 2) {
    return {
      reason: 'few_workouts',
      workoutsNeeded: Math.max(1, MIN_SESSIONS_FOR_TREND - points),
      spanDays: Math.round(trend.spanDays ?? 0),
      readyOn: null,
    };
  }
  const span = trend.spanDays;
  if (span !== undefined && span < MIN_TREND_SPAN_DAYS) {
    const first = usedDates[0];
    return {
      reason: 'short_span',
      workoutsNeeded: 1,
      spanDays: Math.round(span),
      readyOn: first ? addLocalDays(first, MIN_TREND_SPAN_DAYS) : null,
    };
  }
  return null;
}

interface SeriesAccumulator {
  trackKey: string;
  label: string | null;
  snapshots: ExercisePerformanceSnapshot[];
  /** User-marked "different equipment" session dates on this track. */
  boundaries: string[];
}

interface TrendSeries {
  exerciseId: string;
  seriesKey: string;
  locationId: string | null;
  locationLabel: string | null;
  snapshots: ExercisePerformanceSnapshot[];
  boundaries: string[];
}

export interface ComputeLiftTrendsOptions {
  /**
   * Start date (YYYY-MM-DD or ISO) of the active program/mesocycle. Lifts
   * whose in-window sessions straddle this boundary with fewer than
   * MIN_SESSIONS_FOR_TREND sessions after it are flagged lowConfidence.
   */
  programStartDate?: string | null;
  /** Also return the per-lift series for the muscle rollup (`rollup`). */
  includeRollup?: boolean;
  /**
   * Days the caller fetched sessions over, reported back as `windowDays`
   * (the sentences say "over the last N weeks" from it). The sessions are
   * already bounded by the caller's query; this does not filter them.
   * Defaults to LIFT_TREND_WINDOW_DAYS (Home's tile and Progress's default).
   */
  windowDays?: number;
}

/**
 * Build per-exercise top-set E1RM snapshots (one per session) and classify
 * each frequently-trained lift's trend. Bodyweight/empty sets (no load) are
 * skipped — a 0 kg top set would zero the E1RM trend, not inform it.
 */
export function computeLiftTrends(
  sessions: LiftTrendSessionRow[],
  goal?: PlateauGoal,
  referenceDate: Date = new Date(),
  options: ComputeLiftTrendsOptions = {}
): LiftTrendsSummary {
  // Collected per (exercise, gym track). Free-weight lifts use one track
  // (GLOBAL_TRACK) whatever the gym; machine lifts one per gym. Whether a
  // machine lift is actually SPLIT is decided after collection — only when it
  // was trained at more than one gym in the window.
  const GLOBAL_TRACK = '*';
  const tracksByExercise = new Map<string, Map<string, SeriesAccumulator>>();
  const nameByExercise = new Map<string, string>();
  const muscleByExercise = new Map<string, string>();
  const trackFor = (exerciseId: string, trackKey: string, label: string | null) => {
    let tracks = tracksByExercise.get(exerciseId);
    if (!tracks) {
      tracks = new Map();
      tracksByExercise.set(exerciseId, tracks);
    }
    let acc = tracks.get(trackKey);
    if (!acc) {
      acc = { trackKey, label, snapshots: [], boundaries: [] };
      tracks.set(trackKey, acc);
    }
    return acc;
  };

  for (const session of sessions) {
    if (!session.completed_at || !session.exercise_blocks) continue;
    const sessionDate = getLocalDateString(new Date(session.completed_at));

    for (const block of session.exercise_blocks) {
      const exercise = block.exercises;
      if (!exercise) continue;
      // Duration exercises store seconds in reps — an "E1RM trend" over hold
      // times is fiction, so timed work never feeds the lift-trend tile.
      if (exercise.exercise_type === 'duration_based') continue;
      const isLocal =
        deriveProgressionScope({
          equipmentRequired: exercise.equipment_required,
          isBodyweight: exercise.is_bodyweight,
          name: exercise.name,
          scopeOverride: exercise.progression_scope_override ?? null,
        }) === 'local';
      // Where this exercise was performed: block override, else session gym.
      const locationId = resolveEffectiveLocation(block.location_id, session.location_id);
      const locationName = block.location_id
        ? block.gym_locations?.name
        : session.gym_locations?.name;
      const track = isLocal
        ? trackFor(
            exercise.id,
            trackKeyFor(locationId),
            trackLabel(locationId, locationId && locationName ? { [locationId]: locationName } : {})
          )
        : trackFor(exercise.id, GLOBAL_TRACK, null);
      // Record explicit equipment markers BEFORE any estimability skips: a
      // marked session whose sets are outside the estimator's domain (e.g. a
      // 20-rep day) contributes no e1RM point, but its boundary must still
      // segment the trend — computeTrend anchors at the first point at/after
      // the boundary date, so the boundary works without a point on it.
      if (block.equipment_changed) {
        track.boundaries.push(sessionDate);
      }
      const workingSets = (block.set_logs || []).filter(
        (s) => !s.is_warmup && (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0
      );
      if (workingSets.length === 0) continue;

      let topE1RM = 0;
      let topWeight = 0;
      let topReps = 0;
      let topRpe: number | null = null;
      for (const set of workingSets) {
        // Canonical RPE-aware estimator: same load/reps at a lower RPE is a
        // HIGHER estimate (set-level progress an RPE-blind compare discards).
        // Returns 0 for "no estimate" (>15 effective reps) — such sets never
        // enter the trend.
        const e1rm = e1rmValueFromRpe(
          set.weight_kg as number,
          set.reps as number,
          set.rpe ?? null
        );
        if (e1rm > topE1RM) {
          topE1RM = e1rm;
          topWeight = set.weight_kg as number;
          topReps = set.reps as number;
          topRpe = set.rpe ?? null;
        }
      }
      if (topE1RM <= 0) continue;

      nameByExercise.set(exercise.id, exercise.name);
      if (exercise.primary_muscle) muscleByExercise.set(exercise.id, exercise.primary_muscle);
      track.snapshots.push({
        id: `${session.id}-${exercise.id}`,
        userId: '',
        exerciseId: exercise.id,
        sessionDate,
        topSetWeightKg: topWeight,
        topSetReps: topReps,
        topSetRpe: topRpe ?? 10,
        totalWorkingSets: workingSets.length,
        estimatedE1RM: topE1RM,
      });
    }
  }

  // Flatten to trend series: one per exercise, except a machine lift trained
  // at 2+ gyms, which gets one per gym. Tracks that collected only boundary
  // markers (no estimable sets) carry no series of their own.
  const series: TrendSeries[] = [];
  for (const [exerciseId, tracks] of Array.from(tracksByExercise.entries())) {
    const withData = Array.from(tracks.values()).filter((t) => t.snapshots.length > 0);
    if (withData.length === 0) continue;
    if (withData.length > 1) {
      for (const t of withData) {
        series.push({
          exerciseId,
          seriesKey: `${exerciseId}@${t.trackKey}`,
          locationId: t.trackKey === GLOBAL_TRACK ? null : locationIdFromTrack(t.trackKey),
          locationLabel: t.label,
          snapshots: t.snapshots,
          boundaries: t.boundaries,
        });
      }
    } else {
      // A marker recorded at a gym with no estimable sets in the window
      // belongs to that gym's machine, not this one — only this track's count.
      series.push({
        exerciseId,
        seriesKey: exerciseId,
        locationId: null,
        locationLabel: null,
        snapshots: withData[0].snapshots,
        boundaries: withData[0].boundaries,
      });
    }
  }
  const seriesByKey = new Map(series.map((s) => [s.seriesKey, s]));
  const snapshotsBySeries = new Map(series.map((s) => [s.seriesKey, s.snapshots]));

  // Lifts seen in the window without enough sessions to fit a trend at all
  // (typical right after a program switch introduces new exercises).
  const insufficientData = Array.from(snapshotsBySeries.values()).filter(
    (snapshots) => snapshots.length < MIN_SESSIONS_FOR_TREND
  ).length;
  const earlyLifts = Array.from(snapshotsBySeries.entries())
    .filter(([, snapshots]) => snapshots.length > 0 && snapshots.length < MIN_SESSIONS_FOR_TREND)
    .map(([seriesKey, snapshots]) => {
      const meta = seriesByKey.get(seriesKey) as TrendSeries;
      const best = snapshots.reduce((a, b) =>
        b.topSetWeightKg > a.topSetWeightKg || (b.topSetWeightKg === a.topSetWeightKg && b.topSetReps > a.topSetReps) ? b : a
      );
      const base = nameByExercise.get(meta.exerciseId) ?? 'Exercise';
      const byDate = [...snapshots].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
      const first = byDate[0];
      const latest = byDate[byDate.length - 1];
      const early: EarlyLift = {
        name: meta.locationLabel ? `${base} (${meta.locationLabel})` : base,
        sessions: snapshots.length,
        bestWeightKg: best.topSetWeightKg,
        bestReps: best.topSetReps,
        firstWeightKg: first.topSetWeightKg,
        firstReps: first.topSetReps,
        latestWeightKg: latest.topSetWeightKg,
        latestReps: latest.topSetReps,
        points: byDate.map((snap) => ({
          date: snap.sessionDate,
          weightKg: snap.topSetWeightKg,
          topSetReps: snap.topSetReps,
          e1rmKg: snap.estimatedE1RM,
        })),
      };
      return early;
    })
    .sort((a, b) => b.sessions - a.sessions || b.bestWeightKg - a.bestWeightKg)
    .slice(0, MAX_TRACKED_LIFTS);

  // The user's main lifts: most sessions first (ties broken by heavier E1RM),
  // classified only with enough history to fit a trend.
  const ranked = Array.from(snapshotsBySeries.entries())
    .filter(([, snapshots]) => snapshots.length >= MIN_SESSIONS_FOR_TREND)
    .sort((a, b) => {
      const bySessions = b[1].length - a[1].length;
      if (bySessions !== 0) return bySessions;
      const lastE1RM = (s: ExercisePerformanceSnapshot[]) => s[s.length - 1].estimatedE1RM;
      return lastE1RM(b[1]) - lastE1RM(a[1]);
    })
    .slice(0, MAX_TRACKED_LIFTS);

  // Program boundary as a local date string, comparable to sessionDate.
  // Date-only strings (mesocycles.start_date) are used verbatim — parsing
  // them through Date() would shift the boundary a day in UTC-negative zones.
  const programStart = options.programStartDate
    ? /^\d{4}-\d{2}-\d{2}$/.test(options.programStartDate)
      ? options.programStartDate
      : getLocalDateString(new Date(options.programStartDate))
    : null;

  const lifts: LiftTrend[] = [];
  let stalled: { name: string; weeks: number } | null = null;

  for (const [seriesKey, snapshots] of ranked) {
    const meta = seriesByKey.get(seriesKey) as TrendSeries;
    const exerciseId = meta.exerciseId;
    const knownDiscontinuities = meta.boundaries.length > 0 ? meta.boundaries : undefined;
    const displayName = meta.locationLabel
      ? `${nameByExercise.get(exerciseId) ?? 'Exercise'} (${meta.locationLabel})`
      : nameByExercise.get(exerciseId) ?? 'Exercise';
    const trend = analyzeExerciseTrend(snapshots, goal, { knownDiscontinuities });
    const sorted = [...snapshots].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    const currentE1RM = sorted[sorted.length - 1].estimatedE1RM;
    const weeklyChangePct =
      currentE1RM > 0 ? Math.round((trend.weeklyChange / currentE1RM) * 1000) / 10 : 0;

    const direction: LiftDirection =
      weeklyChangePct > FLAT_BAND_PCT ? 'rising' : weeklyChangePct < -FLAT_BAND_PCT ? 'down' : 'flat';

    // Confidence gating across a program boundary: the fitted window mixes
    // old-program and new-program sessions, and fewer than
    // MIN_SESSIONS_FOR_TREND have happened since the switch.
    let lowConfidence = false;
    let calibrationReason: LiftTrend['calibrationReason'] = null;
    if (programStart) {
      const before = sorted.filter((s) => s.sessionDate < programStart).length;
      const since = sorted.length - before;
      if (before > 0 && since < MIN_SESSIONS_FOR_TREND) {
        lowConfidence = true;
        calibrationReason = 'program_change';
      }
    }
    // Data-discontinuity gating (robust trend detected/was told about an
    // equipment change): the trend rebuilds over the post-shift sessions,
    // exactly like a program switch.
    if (
      !lowConfidence &&
      trend.discontinuityDate &&
      (trend.pointsUsed ?? sorted.length) < MIN_SESSIONS_AFTER_DISCONTINUITY
    ) {
      lowConfidence = true;
      calibrationReason = 'equipment_change';
    }

    // A lift with its workouts but no real rate yet (too short a span, too
    // few usable points): no %/week, no verdict, no stall. Calibrating wins —
    // it already says why there's no rate.
    const excluded = new Set(trend.excludedDates ?? []);
    const segmentStart = trend.discontinuityDate ?? null;
    const usedDates = sorted
      .map((s) => s.sessionDate)
      .filter((d) => !excluded.has(d) && (!segmentStart || d >= segmentStart));
    const notEnoughData = lowConfidence ? null : liftRateReadiness(trend, usedDates);

    // A "stalled N wks" verdict across a program boundary is the same noise
    // as the direction verdict — skip low-confidence lifts.
    let plateau: PlateauDetectionResult | null = null;
    if (!lowConfidence && !notEnoughData) {
      const result = detectPlateau({
        exerciseId,
        snapshots: sorted,
        referenceDate,
        goal,
        knownDiscontinuities,
      });
      if (result.isPlateaued) {
        plateau = result;
        const weeks = Math.max(1, Math.round(result.weeksSinceProgress));
        if (!stalled || weeks > stalled.weeks) {
          stalled = { name: displayName, weeks };
        }
      }
    }

    lifts.push({
      exerciseId,
      seriesKey,
      name: nameByExercise.get(exerciseId) ?? 'Exercise',
      locationId: meta.locationId,
      locationLabel: meta.locationLabel,
      direction,
      weeklyChangePct,
      currentE1RMKg: Math.round(currentE1RM * 10) / 10,
      sessionCount: sorted.length,
      history: sorted.map((s) => ({
        date: s.sessionDate,
        e1rmKg: Math.round(s.estimatedE1RM * 10) / 10,
        topSetWeightKg: s.topSetWeightKg,
        topSetReps: s.topSetReps,
        // The snapshot stores a missing RPE as 10 — the same "0 left" the
        // estimator assumed, so the explainer's arithmetic still matches.
        topSetRpe: s.topSetRpe,
      })),
      lowConfidence,
      calibrationReason: lowConfidence ? calibrationReason : null,
      excludedDates: trend.excludedDates ?? [],
      discontinuityDate: trend.discontinuityDate ?? null,
      plateau,
      notEnoughData,
    });
  }

  const order: Record<LiftDirection, number> = { rising: 0, flat: 1, down: 2 };
  // Lifts without a real rate yet go last: their direction is a placeholder.
  const notReady = (l: LiftTrend) => (l.notEnoughData ? 1 : 0);
  lifts.sort(
    (a, b) =>
      notReady(a) - notReady(b) ||
      order[a.direction] - order[b.direction] ||
      b.weeklyChangePct - a.weeklyChangePct
  );

  // Counted rising/flat/down only with a real rate: calibrating lifts are
  // `rebuilding`, lifts without enough span/points are `tooEarly`.
  const confident = lifts.filter((l) => !l.lowConfidence && !l.notEnoughData);
  const rebuilding = lifts.filter((l) => l.lowConfidence).length;

  return {
    lifts,
    rising: confident.filter((l) => l.direction === 'rising').length,
    flat: confident.filter((l) => l.direction === 'flat').length,
    down: confident.filter((l) => l.direction === 'down').length,
    rebuilding,
    tooEarly: lifts.length - confident.length - rebuilding,
    insufficientData,
    sessionsInWindow: sessions.length,
    earlyLifts,
    stalled,
    windowDays: options.windowDays ?? LIFT_TREND_WINDOW_DAYS,
    ...(options.includeRollup
      ? {
          rollup: {
            series: series.map((s) => {
              const base = nameByExercise.get(s.exerciseId) ?? 'Exercise';
              return {
                key: s.seriesKey,
                exerciseId: s.exerciseId,
                name: s.locationLabel ? `${base} (${s.locationLabel})` : base,
                muscle: muscleByExercise.get(s.exerciseId) ?? null,
                snapshots: s.snapshots,
                boundaries: s.boundaries,
              };
            }),
            goal,
            programStartDate: programStart,
          },
        }
      : {}),
  };
}
