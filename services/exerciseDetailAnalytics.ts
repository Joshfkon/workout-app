/**
 * Pure derivations for the tabbed exercise detail sheet
 * (About / History / Charts / Records).
 *
 * Everything here is computed from already-fetched set history — no database
 * calls (see CLAUDE.md: services are pure). The fetch + row normalization
 * lives in `hooks/useExerciseDetailHistory.ts`.
 *
 * Bodyweight exercises: `set_logs.weight_kg` already stores the TOTAL
 * effective load (bodyweight ± modifications) — see SetLoggerRow, which
 * writes `bodyweightData.effectiveLoadKg` into `weightKg`. So every
 * derivation here (e1RM, records, volume) is automatically consistent with
 * the e1RM path for bodyweight movements.
 */

import { estimateE1RM, sumDisplayVolume } from '@/lib/utils';
import { rpeToRir } from '@/types/schema';

// === Types ===

export interface ExerciseDetailSet {
  weightKg: number;
  reps: number;
  rpe: number | null;
  /**
   * set_type of the logged row ('normal' | 'dropset' | 'myorep' |
   * 'rest_pause'…; absent = legacy 'normal'). Special-scheme sets stay in
   * the display list but are excluded from rep_total classification and
   * rep-total sums — same eligibility rule as the anchor pool.
   */
  setType?: string | null;
  /**
   * Bodyweight composition, when recorded. `weightKg` stays the effective
   * load (the number every derivation here uses); this only lets displays
   * break it out as "BW+25" instead of the blended value.
   */
  bw?: {
    modification: 'none' | 'weighted' | 'assisted';
    addedWeightKg?: number;
    assistanceWeightKg?: number;
  };
}

export interface ExerciseDetailSessionInput {
  sessionId: string;
  /** workout_sessions.completed_at (ISO) */
  date: string;
  isDeload: boolean;
  /**
   * Gym/location tag. The schema has no location column on sessions yet —
   * this stays null until that feature lands, and the UI hides the tag.
   */
  locationName?: string | null;
  /** Working sets only (warmups filtered out upstream), in logged order. */
  sets: ExerciseDetailSet[];
}

export interface ExerciseDetailSession {
  sessionId: string;
  date: string;
  isDeload: boolean;
  locationName: string | null;
  sets: ExerciseDetailSet[];
  /** Best single-set e1RM in the session (kg). */
  bestE1RM: number;
  /** The set that produced `bestE1RM`. */
  topSet: ExerciseDetailSet | null;
  /** Sum of weight × reps across working sets (kg). */
  totalVolume: number;
}

export type ExerciseDetailTab = 'about' | 'history' | 'charts' | 'records';

export type TrendRange = '3m' | '1y' | 'all';

export interface E1RMTrendPoint {
  date: string;
  /** Short axis label, e.g. "6/12" */
  label: string;
  /** Best e1RM for non-deload sessions; null on deload sessions. */
  e1rm: number | null;
  /** Best e1RM for deload sessions (rendered as muted dots); null otherwise. */
  deloadE1rm: number | null;
}

export interface WeeklyVolumePoint {
  /** Local YYYY-MM-DD of the Monday starting the week. */
  weekStart: string;
  /** Short axis label, e.g. "6/9" */
  label: string;
  volumeKg: number;
}

export interface RepRecord {
  reps: number;
  /** Heaviest weight ever logged for a set of >= `reps` reps. */
  weightKg: number;
  date: string;
}

export interface ExerciseRecords {
  bestE1RM: { valueKg: number; date: string; set: ExerciseDetailSet } | null;
  heaviestWeight: { weightKg: number; reps: number; date: string } | null;
  bestSetVolume: { volumeKg: number; set: ExerciseDetailSet; date: string } | null;
  bestSessionVolume: { volumeKg: number; date: string } | null;
  /** One entry per rep count 1-12 that has at least one qualifying set. */
  repRecords: RepRecord[];
  lifetime: {
    totalSets: number;
    totalVolumeKg: number;
    totalSessions: number;
    firstDate: string | null;
  };
}

// === Set-level helpers ===

/**
 * Straight-set eligibility for rep-total math — the display-side twin of the
 * anchor pool's isAnchorEligibleSet: dropset/myorep/rest-pause reps are a
 * different scheme and never count toward classification or rep totals.
 * (The hook already excludes warmups.)
 */
export function isNormalDetailSet(set: Pick<ExerciseDetailSet, 'setType'>): boolean {
  return (set.setType ?? 'normal') === 'normal';
}

/**
 * e1RM for a single logged set. Uses the canonical `estimateE1RM` with the
 * set's RIR (derived from stored RPE); an unknown RPE is treated as taken to
 * failure (RIR 0), matching `estimateE1RM`'s own default.
 */
export function setE1RM(set: ExerciseDetailSet): number {
  const rir = set.rpe != null && set.rpe > 0 ? rpeToRir(set.rpe) : 0;
  return estimateE1RM(set.weightKg, set.reps, rir);
}

/**
 * Effort text color for a set, following the app's RIR convention
 * (see RIRSelector): 2-3 RIR green "good", 1 RIR amber "hard",
 * 0 RIR orange "maxed", 4+ RIR red "too easy / junk".
 */
export function effortColorClass(rpe: number | null): string {
  if (rpe == null || rpe <= 0) return 'text-surface-500';
  const rir = rpeToRir(rpe);
  if (rir >= 4) return 'text-danger-400';
  if (rir >= 2) return 'text-success-400';
  if (rir === 1) return 'text-warning-400';
  return 'text-orange-400';
}

/** RIR shown next to a set, or null when the set has no usable RPE. */
export function setRir(rpe: number | null): number | null {
  if (rpe == null || rpe <= 0) return null;
  return rpeToRir(rpe);
}

// === Session summaries (History tab) ===

export function summarizeSession(input: ExerciseDetailSessionInput): ExerciseDetailSession {
  let bestE1RM = 0;
  let topSet: ExerciseDetailSet | null = null;
  let totalVolume = 0;

  for (const set of input.sets) {
    totalVolume += set.weightKg * set.reps;
    const e1rm = setE1RM(set);
    if (e1rm > bestE1RM) {
      bestE1RM = e1rm;
      topSet = set;
    }
  }

  return {
    sessionId: input.sessionId,
    date: input.date,
    isDeload: input.isDeload,
    locationName: input.locationName ?? null,
    sets: input.sets,
    bestE1RM,
    topSet,
    totalVolume,
  };
}

/** Summarize and sort reverse-chronologically (newest first). */
export function summarizeSessions(inputs: ExerciseDetailSessionInput[]): ExerciseDetailSession[] {
  return inputs
    .map(summarizeSession)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// === Tab behavior ===

/**
 * A brand-new exercise is a learning moment (About); a familiar one is a
 * lookup (History).
 */
export function resolveDefaultTab(sessionCount: number): ExerciseDetailTab {
  return sessionCount >= 1 ? 'history' : 'about';
}

/**
 * With this many logged sessions the user knows how to perform the exercise:
 * form cues / mistakes / setup become reference, not reading.
 */
export const GUIDE_COLLAPSE_SESSION_THRESHOLD = 5;

export function shouldCollapseGuides(sessionCount: number): boolean {
  return sessionCount >= GUIDE_COLLAPSE_SESSION_THRESHOLD;
}

// === Records ===

interface RecordsAccumulator {
  bestE1RM: ExerciseRecords['bestE1RM'];
  heaviestWeight: ExerciseRecords['heaviestWeight'];
  bestSetVolume: ExerciseRecords['bestSetVolume'];
  /** Heaviest weight at >= N reps, per rep count 1-12. */
  repRecordMap: Map<number, RepRecord>;
  totalSets: number;
  totalVolumeKg: number;
}

/** Fold one working set into the record accumulators. Returns the set volume. */
function applySetToRecords(acc: RecordsAccumulator, set: ExerciseDetailSet, date: string): number {
  acc.totalSets += 1;
  const volume = set.weightKg * set.reps;
  acc.totalVolumeKg += volume;

  const e1rm = setE1RM(set);
  if (e1rm > 0 && (acc.bestE1RM === null || e1rm > acc.bestE1RM.valueKg)) {
    acc.bestE1RM = { valueKg: e1rm, date, set };
  }

  if (set.weightKg > 0 && (acc.heaviestWeight === null || set.weightKg > acc.heaviestWeight.weightKg)) {
    acc.heaviestWeight = { weightKg: set.weightKg, reps: set.reps, date };
  }

  if (volume > 0 && (acc.bestSetVolume === null || volume > acc.bestSetVolume.volumeKg)) {
    acc.bestSetVolume = { volumeKg: volume, set, date };
  }

  if (set.weightKg > 0 && set.reps > 0) {
    const cappedReps = Math.min(set.reps, 12);
    for (let n = 1; n <= cappedReps; n++) {
      const existing = acc.repRecordMap.get(n);
      if (!existing || set.weightKg > existing.weightKg) {
        acc.repRecordMap.set(n, { reps: n, weightKg: set.weightKg, date });
      }
    }
  }

  return volume;
}

export function computeExerciseRecords(sessions: ExerciseDetailSession[]): ExerciseRecords {
  const acc: RecordsAccumulator = {
    bestE1RM: null,
    heaviestWeight: null,
    bestSetVolume: null,
    repRecordMap: new Map(),
    totalSets: 0,
    totalVolumeKg: 0,
  };
  let bestSessionVolume: ExerciseRecords['bestSessionVolume'] = null;
  let firstDate: string | null = null;

  // Iterate oldest-first so ties keep the date the record was first achieved.
  const oldestFirst = [...sessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const session of oldestFirst) {
    if (session.sets.length > 0 && firstDate === null) {
      firstDate = session.date;
    }

    let sessionVolume = 0;
    for (const set of session.sets) {
      sessionVolume += applySetToRecords(acc, set, session.date);
    }

    if (sessionVolume > 0 && (bestSessionVolume === null || sessionVolume > bestSessionVolume.volumeKg)) {
      bestSessionVolume = { volumeKg: sessionVolume, date: session.date };
    }
  }

  return {
    bestE1RM: acc.bestE1RM,
    heaviestWeight: acc.heaviestWeight,
    bestSetVolume: acc.bestSetVolume,
    bestSessionVolume,
    repRecords: Array.from(acc.repRecordMap.values()).sort((a, b) => a.reps - b.reps),
    lifetime: {
      totalSets: acc.totalSets,
      totalVolumeKg: acc.totalVolumeKg,
      totalSessions: sessions.length,
      firstDate,
    },
  };
}

// === Charts ===

function shortDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * e1RM trend points, oldest first. Deload sessions are excluded from the
 * trend line (`e1rm: null`) but surfaced as muted dots via `deloadE1rm`.
 */
export function buildE1RMTrend(
  sessions: ExerciseDetailSession[],
  range: TrendRange,
  now: Date
): E1RMTrendPoint[] {
  const cutoff =
    range === '3m' ? now.getTime() - 90 * DAY_MS :
    range === '1y' ? now.getTime() - 365 * DAY_MS :
    null;

  return [...sessions]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter((s) => s.bestE1RM > 0 && (cutoff === null || new Date(s.date).getTime() >= cutoff))
    .map((s) => ({
      date: s.date,
      label: shortDateLabel(s.date),
      e1rm: s.isDeload ? null : s.bestE1RM,
      deloadE1rm: s.isDeload ? s.bestE1RM : null,
    }));
}

/** Local-time Monday of the week containing `d`, as YYYY-MM-DD. */
function weekStartOf(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return { key, label: `${monday.getMonth() + 1}/${monday.getDate()}` };
}

// === History sparkline (workout card expanded detail) ===

/**
 * Which per-session number the workout card's history sparkline plots,
 * following the exercise's progression model: best e1RM for e1rm-path
 * exercises, session tonnage for rep_total (rep totals reset on load changes;
 * tonnage stays comparable across them), total hold seconds for
 * duration-based movements (whose "reps" are seconds and never enter Epley).
 */
export type SparklineMetric = 'e1rm' | 'volume' | 'duration';

export interface SessionSparklinePoint {
  /** Session completed_at (ISO). */
  date: string;
  /**
   * kg for 'e1rm'; whole DISPLAY units for 'volume' (native-unit tonnage —
   * see buildSessionSparkline); total seconds for 'duration'.
   */
  value: number;
}

/** The sparkline's lookback window: ~12 weeks. */
export const SPARKLINE_WINDOW_DAYS = 84;

/**
 * Per-session trend points for the workout card's history sparkline, oldest
 * first, limited to the last `windowDays`. Deload sessions are excluded —
 * they are held light on purpose, and on a wordless line their dip reads as
 * regression (same exclusion the e1RM trend / PR reads apply). Sessions where
 * the metric comes out non-positive (e.g. hold-seconds on a session of only
 * special-scheme sets) carry no signal and are dropped.
 *
 * The 'volume' metric goes through the native-unit tonnage path
 * (sumDisplayVolume): each set converts to `unit` FIRST, then multiplies and
 * sums, recovering the exact loads a lb user typed. Converting the kg-summed
 * `totalVolume` once at the end loses them to the DECIMAL(6,2) storage
 * precision — 160 lb × 12 × 4 would render 7,679 while the Last Workout line
 * directly above says 7,680. Only rep-based sessions may be plotted as
 * 'volume' (duration sets store seconds in `reps`); the metric table above
 * guarantees that.
 */
export function buildSessionSparkline(
  sessions: ExerciseDetailSession[],
  metric: SparklineMetric,
  unit: 'kg' | 'lb',
  now: Date,
  windowDays: number = SPARKLINE_WINDOW_DAYS
): SessionSparklinePoint[] {
  const cutoff = now.getTime() - windowDays * DAY_MS;

  return [...sessions]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter((s) => !s.isDeload && new Date(s.date).getTime() >= cutoff)
    .map((s) => ({
      date: s.date,
      value:
        metric === 'e1rm'
          ? s.bestE1RM
          : metric === 'volume'
            ? sumDisplayVolume(s.sets, unit, null)
            : s.sets.filter(isNormalDetailSet).reduce((sum, set) => sum + set.reps, 0),
    }))
    .filter((p) => p.value > 0);
}

/** Volume for this exercise bucketed per week (Monday start), oldest first. */
export function buildWeeklyVolume(sessions: ExerciseDetailSession[]): WeeklyVolumePoint[] {
  const buckets = new Map<string, WeeklyVolumePoint>();

  for (const session of sessions) {
    if (session.totalVolume <= 0) continue;
    const { key, label } = weekStartOf(session.date);
    const existing = buckets.get(key);
    if (existing) {
      existing.volumeKg += session.totalVolume;
    } else {
      buckets.set(key, { weekStart: key, label, volumeKg: session.totalVolume });
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
