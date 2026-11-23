/**
 * suggestedWorkout
 *
 * Pure builder for the "AI suggested workout" launcher (Train tab + /dashboard/log).
 * Data in (recovery + weekly volume per muscle, the exercise library slice,
 * the user's recent exercise ids, injury flags, equipment), plan out.
 * NO database calls, NO randomness — the same inputs always produce the same
 * plan, so regenerating without new data never changes the suggestion.
 *
 * Selection logic:
 *   1. Drop injury-flagged muscles (the mesocycle generator's exclusion rule,
 *      reused via isMuscleExcludedByInjury) and exercises needing unavailable
 *      equipment (filterExercisesByEquipment).
 *   2. Rank muscles: ready first, then largest volume deficit
 *      (targetSets - weeklySets). Sore muscles and muscles already at/over
 *      target are skipped entirely.
 *   3. Take the top 3-4 muscles the library can train (a coarse parent row
 *      like 'calves' is trained by its head-tagged exercises; one entry per
 *      parent/head family); for each pick 1-2 exercises, preferring
 *      rep-based over timed carries/holds, then recently used, then staples,
 *      compounds before isolations. The focus sentence names only muscles
 *      that received a pick.
 *   4. Every pick carries set/rep/RIR targets:
 *        - sets sized to the session length, hard-capped so the muscle's
 *          weekly total never passes MRV;
 *        - RIR floored by the joint-stress safety tier (getRIRFloor — natural
 *          values regardless of Enhanced Athlete Mode, by construction).
 *   5. When every under-target muscle is out of MRV headroom, emit a light
 *      technique session (2 sets, high RIR) instead — and say so in the focus.
 *   6. Fallback: with no usable recovery/volume data, build a balanced
 *      full-body pick from staples instead.
 */

import {
  MUSCLE_VOLUME_AUTHORITY,
  muscleMatchesGroup,
  resolveMuscleToStandard,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type ExerciseType,
  type StandardMuscleGroup,
} from '@/types/schema';
import { computeStapleExerciseIds } from '@/services/exerciseStaples';
import { isMuscleExcludedByInjury } from '@/services/shared/injuryExclusion';
import { getRIRFloor } from '@/services/exerciseSafety';
import { filterExercisesByEquipment } from '@/services/equipmentFilter';

// ============================================================
// Types
// ============================================================

export type SuggestedRecoveryStatus = 'ready' | 'recovering' | 'sore';

export interface SuggestedMuscleInput {
  muscle: StandardMuscleGroup;
  recoveryStatus: SuggestedRecoveryStatus;
  /** Working sets logged for this muscle in the current week. */
  weeklySets: number;
  /** Weekly set target for this muscle (e.g. MAV landmark). */
  targetSets: number;
  /**
   * Weekly ceiling (MRV landmark). Suggested sets never push weeklySets past
   * this. Omitted = no cap data (legacy callers); pass it whenever known.
   */
  mrvSets?: number;
}

export interface SuggestedExerciseInput {
  id: string;
  name: string;
  /** Primary muscle in any taxonomy (legacy, standard, or detailed). */
  primaryMuscle: string | null;
  /** Hypertrophy tier S-F (missing treated as C). */
  tier: string | null;
  mechanic: 'compound' | 'isolation' | null;
  /** Library defaults used for the pick's rep/RIR targets. */
  defaultRepRange?: [number, number] | null;
  defaultRir?: number | null;
  /** Equipment tags for the availability filter (optional). */
  equipment?: string | string[] | null;
  /** Bodyweight flag — untagged bodyweight exercises pass the equipment filter. */
  isBodyweight?: boolean | null;
  /**
   * 'duration_based' exercises (carries, holds) store SECONDS in their rep
   * range. They are only picked when a muscle has no rep-based option.
   */
  exerciseType?: ExerciseType | null;
}

export interface BuildSuggestedWorkoutInput {
  muscles: SuggestedMuscleInput[];
  exercises: SuggestedExerciseInput[];
  /** Exercise ids the user has done recently, most recent first. */
  recentExerciseIds: string[];
  /** Total exercise cap (default 6). */
  maxExercises?: number;
  /** Session length the set targets are sized for (default 60). */
  sessionMinutes?: number;
  /**
   * Injury-flagged muscle groups (users.injury_history, legacy taxonomy).
   * Excluded exactly like the mesocycle generator excludes them.
   */
  injuredMuscles?: string[];
  /** Equipment the user's gym lacks (user_equipment ids). */
  unavailableEquipmentIds?: string[];
  /**
   * Standing-injury safety (lib/training/standingInjuries
   * exerciseSafetyForAreas): 'avoid' ids are never picked; 'caution' ids rank
   * behind every safe alternative for the same muscle.
   */
  avoidExerciseIds?: ReadonlySet<string> | string[];
  cautionExerciseIds?: ReadonlySet<string> | string[];
  /**
   * The day the user's push/pull/legs rotation is up to (detectSplitDay).
   * When set, only that day's muscles (plus neutral core work) are picked,
   * as long as one of them is under target; otherwise the split is ignored.
   * Shorthand for `split: { kind: 'ppl', day }`; `split` wins when both are set.
   */
  splitDay?: SplitDay | null;
  /**
   * The split the user is following and the day it is up to (detectSplit):
   * push/pull/legs or a body-part split. Followed exactly like `splitDay`.
   */
  split?: DetectedSplit | null;
}

export interface SuggestedWorkoutPick {
  exerciseId: string;
  muscle: StandardMuscleGroup;
  /** Human-readable reason this exercise made the plan. */
  reason: string;
  /** Working-set target (session-length sized, MRV-capped). */
  sets: number;
  repRange: [number, number];
  /** Target RIR, never below the exercise's joint-stress RIR floor. */
  targetRir: number;
}

export interface SuggestedWorkoutPlan {
  exercises: SuggestedWorkoutPick[];
  /** One-sentence summary of what the session targets and why. */
  focus: string;
  /**
   * True when volume guardrails forced a technique day: every under-target
   * muscle was out of weekly MRV headroom.
   */
  isLightSession: boolean;
  /** Set when the plan follows the user's push/pull/legs rotation. */
  splitDay?: SplitDay;
  /** Set when the plan follows any detected split (PPL or body-part). */
  split?: DetectedSplit;
  /**
   * Which rule put the picks in this order (copy metadata for
   * suggestedOrderLine; the order itself is decided below):
   *  - 'compounds_first': orderCompoundsFirst over picks made in muscle-rank
   *    order (ready before recovering, then furthest behind this week's target);
   *  - 'full_body_rotation': the no-data fallback, one pick per body part in
   *    turn (FULL_BODY_GROUPS order).
   */
  order?: SuggestedOrderRule;
}

export type SuggestedOrderRule = 'compounds_first' | 'full_body_rotation';

/**
 * One plain line saying why the exercises are in this order, phrased from the
 * plan's own `order` rule — never a reason the builder didn't use. Null when
 * there is nothing to order (fewer than two picks) or no rule was recorded.
 */
export function suggestedOrderLine(
  plan: Pick<SuggestedWorkoutPlan, 'order'> & { exercises: readonly unknown[] },
  opts: { beginner?: boolean } = {}
): string | null {
  if (plan.exercises.length < 2 || !plan.order) return null;
  if (plan.order === 'full_body_rotation') {
    return 'Order: one lift per body part, taking turns around the body.';
  }
  const big = opts.beginner ? 'big lifts that work several muscles' : 'big compound lifts';
  return `Order: ${big} first, then smaller ones. Within each, rested muscles furthest behind this week go first.`;
}

// ============================================================
// Splits: push / pull / legs and body-part
// ============================================================

/** The split shapes the suggestion can recognise and follow. */
export type SplitKind = 'ppl' | 'body_part';

/** A push/pull/legs day. */
export type SplitDay = 'push' | 'pull' | 'legs';

/** A bodybuilding body-part split day ("bro split"). */
export type BodyPartDay = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms';

/** The days of each split kind. */
export interface SplitDaysByKind {
  ppl: SplitDay;
  body_part: BodyPartDay;
}

/** A detected split and the day it is up to. */
export type DetectedSplit = {
  [K in SplitKind]: { kind: K; day: SplitDaysByKind[K] };
}[SplitKind];

/** Every day of each split, in its usual order. */
export const SPLIT_DAYS: { readonly [K in SplitKind]: readonly SplitDaysByKind[K][] } = {
  ppl: ['push', 'pull', 'legs'],
  body_part: ['chest', 'back', 'legs', 'shoulders', 'arms'],
};

/**
 * Which split day a muscle belongs to, per split kind. Muscles left out
 * (core, erectors, rotator cuff) are neutral: they don't decide a session's
 * day and can be trained on any of them.
 */
const SPLIT_OF: { readonly [K in SplitKind]: Partial<Record<StandardMuscleGroup, SplitDaysByKind[K]>> } = {
  ppl: {
    chest_upper: 'push',
    chest_lower: 'push',
    front_delts: 'push',
    lateral_delts: 'push',
    triceps: 'push',
    triceps_long: 'push',
    triceps_lat_med: 'push',
    rear_delts: 'pull',
    lats: 'pull',
    upper_back: 'pull',
    traps: 'pull',
    upper_traps: 'pull',
    mid_lower_traps: 'pull',
    biceps: 'pull',
    forearms: 'pull',
    quads: 'legs',
    hamstrings: 'legs',
    glutes: 'legs',
    glute_med: 'legs',
    adductors: 'legs',
    calves: 'legs',
    gastrocnemius: 'legs',
    soleus: 'legs',
  },
  body_part: {
    chest_upper: 'chest',
    chest_lower: 'chest',
    lats: 'back',
    upper_back: 'back',
    traps: 'back',
    upper_traps: 'back',
    mid_lower_traps: 'back',
    front_delts: 'shoulders',
    lateral_delts: 'shoulders',
    rear_delts: 'shoulders',
    biceps: 'arms',
    triceps: 'arms',
    triceps_long: 'arms',
    triceps_lat_med: 'arms',
    forearms: 'arms',
    quads: 'legs',
    hamstrings: 'legs',
    glutes: 'legs',
    glute_med: 'legs',
    adductors: 'legs',
    calves: 'legs',
    gastrocnemius: 'legs',
    soleus: 'legs',
  },
};

/** The day a muscle belongs to in a split (push/pull/legs unless `kind` says otherwise). */
export function splitDayOfMuscle(muscle: StandardMuscleGroup): SplitDay | null;
export function splitDayOfMuscle<K extends SplitKind>(
  muscle: StandardMuscleGroup,
  kind: K
): SplitDaysByKind[K] | null;
export function splitDayOfMuscle(
  muscle: StandardMuscleGroup,
  kind: SplitKind = 'ppl'
): SplitDaysByKind[SplitKind] | null {
  return SPLIT_OF[kind][muscle] ?? null;
}

/** Share of a session's non-neutral exercises that must fall on one day for it to count as that day. */
const SPLIT_DAY_SHARE = 0.75;

/**
 * A session's split day from its exercises' primary muscles, or null for a
 * mixed session. Push/pull/legs unless `kind` says otherwise.
 */
export function classifySessionDay(muscles: StandardMuscleGroup[]): SplitDay | null;
export function classifySessionDay<K extends SplitKind>(
  muscles: StandardMuscleGroup[],
  kind: K
): SplitDaysByKind[K] | null;
export function classifySessionDay(
  muscles: StandardMuscleGroup[],
  kind: SplitKind = 'ppl'
): SplitDaysByKind[SplitKind] | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const m of muscles) {
    const d = SPLIT_OF[kind][m];
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  // First listed day wins a tie (the tie can't reach the share anyway).
  let best: SplitDaysByKind[SplitKind] | null = null;
  let bestCount = 0;
  for (const d of SPLIT_DAYS[kind]) {
    const c = counts.get(d) ?? 0;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best && bestCount / total >= SPLIT_DAY_SHARE ? best : null;
}

/**
 * The next day of a split, read from the user's own recent sessions (most
 * recent first). Only a clear signature counts: the last N sessions (N = the
 * split's day count) are each one day of the split, all different. The next
 * day is the one done longest ago.
 */
function detectNextDay<K extends SplitKind>(
  sessions: StandardMuscleGroup[][],
  kind: K
): SplitDaysByKind[K] | null {
  const n = SPLIT_DAYS[kind].length;
  if (sessions.length < n) return null;
  const days = sessions.slice(0, n).map((m) => classifySessionDay(m, kind));
  if (days.some((d) => d === null)) return null;
  if (new Set(days).size !== n) return null;
  return days[n - 1];
}

/**
 * The next day of a push/pull/legs rotation, read from the user's own recent
 * sessions (most recent first, each the primary muscles of its exercises).
 * Only a clear signature counts: the last three sessions are a push, a pull
 * and a legs day in some order. The next day is the one done longest ago.
 * Anything else (full body, upper/lower, a mixed session) returns null and
 * the suggestion stays recovery-driven.
 */
export function detectSplitDay(sessions: StandardMuscleGroup[][]): SplitDay | null {
  return detectNextDay(sessions, 'ppl');
}

/**
 * The split the user follows and its next day, from completed sessions
 * (most recent first, each the primary muscles of its exercises).
 *
 * A body-part split is checked first: its last five sessions are a chest,
 * back, legs, shoulders and arms day, each dominated by that one region. It
 * must win over push/pull/legs because three of its days in a row (chest,
 * back, legs) also read as push, pull, legs. A real PPL history never reads
 * as body-part: a push day mixes chest, shoulders and triceps, so no single
 * region dominates it. Otherwise push/pull/legs as detectSplitDay; null when
 * neither signature is clear.
 */
export function detectSplit(sessions: StandardMuscleGroup[][]): DetectedSplit | null {
  const bodyPart = detectNextDay(sessions, 'body_part');
  if (bodyPart) return { kind: 'body_part', day: bodyPart };
  const ppl = detectNextDay(sessions, 'ppl');
  if (ppl) return { kind: 'ppl', day: ppl };
  return null;
}

const SPLIT_DAY_LABEL: { readonly [K in SplitKind]: Record<SplitDaysByKind[K], string> } = {
  ppl: { push: 'Push', pull: 'Pull', legs: 'Legs' },
  body_part: { chest: 'Chest', back: 'Back', legs: 'Legs', shoulders: 'Shoulders', arms: 'Arms' },
};

/** How the focus line names each split. */
const SPLIT_NAME: Record<SplitKind, string> = {
  ppl: 'push/pull/legs rotation',
  body_part: 'body-part split',
};

/** "Shoulders day, next in your body-part split." */
export function splitFocusLead(split: DetectedSplit): string {
  const label = (SPLIT_DAY_LABEL[split.kind] as Record<string, string>)[split.day];
  return `${label} day, next in your ${SPLIT_NAME[split.kind]}.`;
}

// ============================================================
// Internals
// ============================================================

const DEFAULT_MAX_EXERCISES = 6;
const DEFAULT_SESSION_MINUTES = 60;
const MAX_MUSCLES = 4;
const MAX_PER_MUSCLE = 2;
/** Fewer sets than this isn't a meaningful working pick. */
const MIN_PICK_SETS = 2;
/** RIR for technique-day sets (raised further by the joint-stress floor). */
const LIGHT_SESSION_RIR = 3;

/** Coarse groups used for the balanced full-body fallback. */
const FULL_BODY_GROUPS = [
  'chest',
  'back',
  'quads',
  'shoulders',
  'hamstrings',
  'biceps',
  'triceps',
  'glutes',
] as const;

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };

function tierRank(tier: string | null): number {
  return TIER_RANK[(tier ?? 'C').toUpperCase()] ?? TIER_RANK.C;
}

function muscleLabel(muscle: StandardMuscleGroup): string {
  return STANDARD_MUSCLE_DISPLAY_NAMES[muscle] ?? muscle;
}

function setsNoun(n: number): string {
  return n === 1 ? 'set' : 'sets';
}

/** Per-exercise set target scaled to session length (full sets at 60+ min, never below 2). */
export function plannedSetsForDuration(
  mechanic: 'compound' | 'isolation' | null,
  minutes: number
): number {
  const base = mechanic === 'compound' ? 4 : 3;
  return Math.max(MIN_PICK_SETS, Math.round(base * Math.min(1, minutes / 60)));
}

/** Exercise budget for the session length (compound ≈ 12 min, isolation ≈ 8 min incl. rest). */
export function maxExercisesForDuration(minutes: number): number {
  if (minutes <= 20) return 2;
  if (minutes <= 30) return 3;
  if (minutes <= 45) return 4;
  if (minutes <= 60) return 5;
  if (minutes <= 75) return 6;
  return 7;
}

/** Rep range from library defaults, else the compound/isolation convention.
 *  Exported for the workout-setup draft builder, so both planners prescribe
 *  identical rep targets for the same exercise. */
export function repRangeFor(exercise: SuggestedExerciseInput): [number, number] {
  const range = exercise.defaultRepRange;
  if (range && range.length >= 2) return [range[0], range[1]];
  return exercise.mechanic === 'compound' ? [6, 10] : [10, 15];
}

/**
 * Target RIR for a pick: the library default floored by the joint-stress
 * safety tier. getRIRFloor is name-only by design — the cap protects
 * connective tissue and stays at natural values regardless of Enhanced
 * Athlete Mode (see services/exerciseSafety.ts).
 */
export function targetRirFor(exercise: SuggestedExerciseInput, baseRir: number): number {
  return Math.max(baseRir, getRIRFloor(exercise.name));
}

interface RankedMuscle extends SuggestedMuscleInput {
  deficit: number;
  /** Sets left before the weekly MRV ceiling (Infinity without cap data). */
  headroom: number;
}

/** Ready first, then largest deficit; sore and at/over-target muscles are dropped. */
function rankMuscles(muscles: SuggestedMuscleInput[], injuredMuscles: string[]): RankedMuscle[] {
  return muscles
    .filter((m) => m.recoveryStatus !== 'sore')
    .filter((m) => !isMuscleExcludedByInjury(m.muscle, injuredMuscles))
    .map((m) => ({
      ...m,
      deficit: m.targetSets - m.weeklySets,
      headroom: m.mrvSets != null ? m.mrvSets - m.weeklySets : Infinity,
    }))
    .filter((m) => m.deficit > 0)
    .sort((a, b) => {
      const readyDiff =
        (a.recoveryStatus === 'ready' ? 0 : 1) - (b.recoveryStatus === 'ready' ? 0 : 1);
      if (readyDiff !== 0) return readyDiff;
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
      return a.muscle.localeCompare(b.muscle);
    })
    .filter(
      // One entry per parent/head family (the best-ranked one): 'calves' and
      // 'gastrocnemius' are the same calf work, not two session targets.
      (m, i, all) => all.findIndex((o) => muscleFamily(o.muscle) === muscleFamily(m.muscle)) === i
    );
}

/**
 * The shared exercise-preference order: recently used, then staples, then
 * compounds before isolations, then tier, then name (stable). Exported so the
 * workout-setup draft builder ranks candidates by the same rule.
 */
export function compareExerciseCandidates(
  a: Pick<SuggestedExerciseInput, 'id' | 'name' | 'tier' | 'mechanic'>,
  b: Pick<SuggestedExerciseInput, 'id' | 'name' | 'tier' | 'mechanic'>,
  recentIds: ReadonlySet<string>,
  stapleIds: ReadonlySet<string>
): number {
  const recentDiff = (recentIds.has(a.id) ? 0 : 1) - (recentIds.has(b.id) ? 0 : 1);
  if (recentDiff !== 0) return recentDiff;
  const stapleDiff = (stapleIds.has(a.id) ? 0 : 1) - (stapleIds.has(b.id) ? 0 : 1);
  if (stapleDiff !== 0) return stapleDiff;
  const mechanicDiff =
    (a.mechanic === 'compound' ? 0 : 1) - (b.mechanic === 'compound' ? 0 : 1);
  if (mechanicDiff !== 0) return mechanicDiff;
  const tierDiff = tierRank(a.tier) - tierRank(b.tier);
  if (tierDiff !== 0) return tierDiff;
  return a.name.localeCompare(b.name);
}

/**
 * The standard muscles an exercise's primary tag may resolve to and still
 * train `muscle`: the muscle itself plus, for a group-capacity row, its
 * bounded components. Recovery and volume report the coarse 'calves' /
 * 'triceps' / 'traps' rows, but libraries tag that work at head grain
 * (gastrocnemius, triceps_lat_med, ...) — without this a coarse row has no
 * candidates and is skipped silently.
 */
function trainableTags(muscle: StandardMuscleGroup): Set<StandardMuscleGroup> {
  const tags = new Set<StandardMuscleGroup>([muscle]);
  for (const [component, authority] of Object.entries(MUSCLE_VOLUME_AUTHORITY)) {
    if (authority.parent === muscle) tags.add(component as StandardMuscleGroup);
  }
  return tags;
}

/** Parent/head family a muscle belongs to (calves for gastrocnemius, etc.). */
function muscleFamily(muscle: StandardMuscleGroup): StandardMuscleGroup {
  return MUSCLE_VOLUME_AUTHORITY[muscle].parent ?? muscle;
}

function isDurationBased(ex: SuggestedExerciseInput): boolean {
  return ex.exerciseType === 'duration_based';
}

/**
 * Candidate exercises for a standard muscle, best first
 * (compareExerciseCandidates). Timed carries/holds sit behind every
 * rep-based option: a coarse 'shoulders' carry is not side-delt volume.
 */
const EMPTY_IDS: ReadonlySet<string> = new Set();
const toIdSet = (ids: ReadonlySet<string> | string[] | undefined): ReadonlySet<string> =>
  ids ? (Array.isArray(ids) ? new Set(ids) : ids) : EMPTY_IDS;

function candidatesForMuscle(
  muscle: StandardMuscleGroup,
  exercises: SuggestedExerciseInput[],
  recentIds: Set<string>,
  stapleIds: Set<string>,
  cautionIds: ReadonlySet<string> = EMPTY_IDS
): SuggestedExerciseInput[] {
  const tags = trainableTags(muscle);
  return exercises
    .filter(
      (ex) => ex.primaryMuscle && resolveMuscleToStandard(ex.primaryMuscle).some((m) => tags.has(m))
    )
    .sort(
      (a, b) =>
        // Injury caution first: a safe alternative always outranks it.
        Number(cautionIds.has(a.id)) - Number(cautionIds.has(b.id)) ||
        Number(isDurationBased(a)) - Number(isDurationBased(b)) ||
        compareExerciseCandidates(a, b, recentIds, stapleIds)
    );
}

/** Set counts can be fractional (a set credited to two muscles counts half). */
function fmtSets(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Plain reason: where the muscle stands against its weekly target ("0 of 10
 * weekly sets done"), not a deficit in jargon ("10 sets below target").
 */
function reasonForPick(muscle: RankedMuscle): string {
  const label = muscleLabel(muscle.muscle);
  const progress = `${fmtSets(Math.max(0, muscle.weeklySets))} of ${fmtSets(muscle.targetSets)} weekly ${setsNoun(muscle.targetSets)} done`;
  return muscle.recoveryStatus === 'ready'
    ? `${label}: ${progress}`
    : `${label}: ${progress}, almost recovered`;
}

/** Focus sentence over the muscles that actually received a pick, in rank order. */
function buildFocus(trainedMuscles: RankedMuscle[]): string {
  const names = trainedMuscles.map((m) => muscleLabel(m.muscle).toLowerCase());
  const joined =
    names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Today: ${joined} — rested, and furthest behind on this week's sets.`;
}

/**
 * Muscles whose compounds are the session's "big lifts". A compound for a
 * small muscle (upright row for side delts, dips for triceps) still goes
 * after them: the UX panel saw "Order: big compound lifts first" above an
 * Upright Row leading a push day, ahead of the bench press.
 */
const BIG_MUSCLES: ReadonlySet<StandardMuscleGroup> = new Set<StandardMuscleGroup>([
  'chest_upper', 'chest_lower', 'lats', 'upper_back', 'quads', 'hamstrings', 'glutes', 'erectors',
]);

/** Session order: big-muscle compounds, then other compounds, then
 *  isolations (stable within each — muscle rank order). */
function orderCompoundsFirst(
  picks: SuggestedWorkoutPick[],
  exerciseById: Map<string, SuggestedExerciseInput>
): SuggestedWorkoutPick[] {
  const rank = (p: SuggestedWorkoutPick): number => {
    if (exerciseById.get(p.exerciseId)?.mechanic !== 'compound') return 2;
    return BIG_MUSCLES.has(p.muscle) ? 0 : 1;
  };
  return [...picks].sort((a, b) => rank(a) - rank(b));
}

/**
 * Light/technique session: every under-target muscle is out of MRV headroom,
 * so instead of adding stimulative volume, prescribe a couple of high-RIR
 * technique sets on the top-ranked muscles that still have ANY headroom.
 */
function buildLightSession(
  ranked: RankedMuscle[],
  exercises: SuggestedExerciseInput[],
  recentIds: Set<string>,
  stapleIds: Set<string>,
  exerciseById: Map<string, SuggestedExerciseInput>,
  cautionIds: ReadonlySet<string> = EMPTY_IDS
): SuggestedWorkoutPlan {
  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();

  for (const muscle of ranked.slice(0, MAX_MUSCLES)) {
    if (muscle.headroom < 1) continue;
    const next = candidatesForMuscle(muscle.muscle, exercises, recentIds, stapleIds, cautionIds).find(
      (ex) => !pickedIds.has(ex.id)
    );
    if (!next) continue;
    pickedIds.add(next.id);
    picks.push({
      exerciseId: next.id,
      muscle: muscle.muscle,
      reason: `${muscleLabel(muscle.muscle)} — near weekly max, light technique work only`,
      sets: Math.min(MIN_PICK_SETS, Math.floor(muscle.headroom)),
      repRange: repRangeFor(next),
      targetRir: targetRirFor(next, LIGHT_SESSION_RIR),
    });
  }

  return {
    exercises: orderCompoundsFirst(picks, exerciseById),
    order: 'compounds_first',
    focus:
      picks.length > 0
        ? 'Light technique session — every under-target muscle is close to its weekly recoverable maximum (MRV), so today stays easy on purpose.'
        : 'All under-target muscles are at their weekly recoverable maximum (MRV) — rest, mobility, or light cardio today.',
    isLightSession: true,
  };
}

/** Balanced full-body pick from staples (no recovery/volume data to go on). */
function buildFullBodyFallback(
  exercises: SuggestedExerciseInput[],
  stapleIds: Set<string>,
  maxExercises: number,
  sessionMinutes: number,
  injuredMuscles: string[],
  headroomByMuscle: Map<StandardMuscleGroup, number>,
  cautionIds: ReadonlySet<string> = EMPTY_IDS
): SuggestedWorkoutPlan {
  const byGroup = new Map<string, SuggestedExerciseInput[]>();
  for (const group of FULL_BODY_GROUPS) {
    if (isMuscleExcludedByInjury(group, injuredMuscles)) continue;
    const candidates = exercises
      .filter(
        (ex) =>
          stapleIds.has(ex.id) &&
          ex.primaryMuscle &&
          muscleMatchesGroup(ex.primaryMuscle, group)
      )
      .sort((a, b) => {
        const cautionDiff = Number(cautionIds.has(a.id)) - Number(cautionIds.has(b.id));
        if (cautionDiff !== 0) return cautionDiff;
        const mechanicDiff =
          (a.mechanic === 'compound' ? 0 : 1) - (b.mechanic === 'compound' ? 0 : 1);
        if (mechanicDiff !== 0) return mechanicDiff;
        const tierDiff = tierRank(a.tier) - tierRank(b.tier);
        if (tierDiff !== 0) return tierDiff;
        return a.name.localeCompare(b.name);
      });
    byGroup.set(group, candidates);
  }

  /** Remaining MRV headroom for a standard muscle (Infinity without data). */
  const headroomFor = (muscle: StandardMuscleGroup): number =>
    headroomByMuscle.get(muscle) ?? Infinity;

  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();
  let added = true;
  while (picks.length < maxExercises && added) {
    added = false;
    for (const group of FULL_BODY_GROUPS) {
      if (picks.length >= maxExercises) break;
      const next = byGroup.get(group)?.find((ex) => !pickedIds.has(ex.id));
      if (!next || !next.primaryMuscle) continue;
      const standard = resolveMuscleToStandard(next.primaryMuscle)[0];
      if (!standard) continue;

      // Even with no ranking data, never push a muscle we DO have volume
      // data for past its weekly MRV.
      const headroom = headroomFor(standard);
      const baseSets = plannedSetsForDuration(next.mechanic, sessionMinutes);
      const sets = Math.min(baseSets, Math.floor(headroom));
      if (sets < MIN_PICK_SETS) continue;

      pickedIds.add(next.id);
      headroomByMuscle.set(standard, headroom - sets);
      picks.push({
        exerciseId: next.id,
        muscle: standard,
        reason: `${muscleLabel(standard)} — balanced full-body pick`,
        sets,
        repRange: repRangeFor(next),
        targetRir: targetRirFor(next, next.defaultRir ?? 2),
      });
      added = true;
    }
  }

  return {
    exercises: picks,
    order: 'full_body_rotation',
    focus:
      picks.length > 0
        ? 'Focus: full body — no recent training data yet, starting with a balanced session.'
        : 'No exercises available to suggest.',
    isLightSession: false,
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a suggested workout plan from recovery + weekly-volume state.
 * Pure and deterministic: no database calls, no randomness; returns a plan
 * the caller can preview and materialize (nothing is created here).
 */
export function buildSuggestedWorkout(input: BuildSuggestedWorkoutInput): SuggestedWorkoutPlan {
  const maxExercises = Math.max(1, input.maxExercises ?? DEFAULT_MAX_EXERCISES);
  const sessionMinutes = input.sessionMinutes ?? DEFAULT_SESSION_MINUTES;
  const injuredMuscles = input.injuredMuscles ?? [];
  const avoidIds = toIdSet(input.avoidExerciseIds);
  const cautionIds = toIdSet(input.cautionExerciseIds);

  // Guardrail filters first: equipment (shared fail-closed filter), then
  // the mesocycle generator's muscle-level injury exclusion applied to each
  // exercise's primary muscle.
  const usableExercises = filterExercisesByEquipment(
    input.exercises,
    input.unavailableEquipmentIds ?? []
  ).filter(
    (ex) =>
      !avoidIds.has(ex.id) &&
      (!ex.primaryMuscle || !isMuscleExcludedByInjury(ex.primaryMuscle, injuredMuscles))
  );

  const stapleIds = computeStapleExerciseIds(
    usableExercises.map((ex) => ({ id: ex.id, muscle: ex.primaryMuscle, tier: ex.tier }))
  );
  const exerciseById = new Map(usableExercises.map((ex) => [ex.id, ex]));
  const recentIds = new Set(input.recentExerciseIds);

  // Live per-muscle MRV headroom, consumed as picks accumulate.
  const headroomByMuscle = new Map<StandardMuscleGroup, number>();
  input.muscles.forEach((m) => {
    if (m.mrvSets != null) headroomByMuscle.set(m.muscle, m.mrvSets - m.weeklySets);
  });

  const allRanked = rankMuscles(input.muscles, injuredMuscles);
  // Follow the user's split (push/pull/legs or body-part) when one of
  // today's muscles is under target; core/neutral work may join any day.
  const split: DetectedSplit | null =
    input.split ?? (input.splitDay ? { kind: 'ppl', day: input.splitDay } : null);
  const dayOf = (m: StandardMuscleGroup) => (split ? splitDayOfMuscle(m, split.kind) : null);
  const dayRanked = split
    ? allRanked.filter((m) => {
        const d = dayOf(m.muscle);
        return d === split.day || d === null;
      })
    : allRanked;
  const followSplit = !!split && dayRanked.some((m) => dayOf(m.muscle) === split.day);
  const ranked = followSplit ? dayRanked : allRanked;
  if (ranked.length === 0) {
    // No recovery/volume data (or nothing trainable) — balanced full body.
    return buildFullBodyFallback(
      usableExercises,
      stapleIds,
      maxExercises,
      sessionMinutes,
      injuredMuscles,
      headroomByMuscle,
      cautionIds
    );
  }

  // Every under-target muscle out of MRV headroom → technique day, not volume.
  if (ranked.every((m) => m.headroom < MIN_PICK_SETS)) {
    return buildLightSession(ranked, usableExercises, recentIds, stapleIds, exerciseById, cautionIds);
  }

  // Top muscles are the best-ranked ones the library can actually train; a
  // muscle with no usable exercise yields its slot to the next one instead
  // of silently leaving the session to the others.
  const remaining = new Map<StandardMuscleGroup, SuggestedExerciseInput[]>();
  const topMuscles: RankedMuscle[] = [];
  for (const m of ranked) {
    if (topMuscles.length >= MAX_MUSCLES) break;
    const candidates = candidatesForMuscle(m.muscle, usableExercises, recentIds, stapleIds, cautionIds);
    if (candidates.length === 0) continue;
    remaining.set(m.muscle, candidates);
    topMuscles.push(m);
  }

  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();
  const takeOne = (muscle: RankedMuscle): boolean => {
    const headroom = headroomByMuscle.get(muscle.muscle) ?? Infinity;
    const next = remaining.get(muscle.muscle)?.find((ex) => !pickedIds.has(ex.id));
    if (!next) return false;

    // Cap this pick's sets by the muscle's remaining weekly MRV headroom;
    // when there isn't room for a meaningful pick, skip the muscle.
    const baseSets = plannedSetsForDuration(next.mechanic, sessionMinutes);
    const sets = Math.min(baseSets, Math.floor(headroom));
    if (sets < MIN_PICK_SETS) return false;

    pickedIds.add(next.id);
    headroomByMuscle.set(muscle.muscle, headroom - sets);
    picks.push({
      exerciseId: next.id,
      muscle: muscle.muscle,
      reason: reasonForPick(muscle),
      sets,
      repRange: repRangeFor(next),
      targetRir: targetRirFor(next, next.defaultRir ?? 2),
    });
    return true;
  };

  // Pass 1: one exercise per ranked muscle; pass 2: a second exercise per
  // muscle (in rank order) until the cap.
  for (let pass = 0; pass < MAX_PER_MUSCLE; pass++) {
    for (const muscle of topMuscles) {
      if (picks.length >= maxExercises) break;
      takeOne(muscle);
    }
  }

  if (picks.length === 0) {
    // Ranked muscles had no matching exercises — fall back to full body.
    return buildFullBodyFallback(
      usableExercises,
      stapleIds,
      maxExercises,
      sessionMinutes,
      injuredMuscles,
      headroomByMuscle,
      cautionIds
    );
  }

  // The header names only muscles that got an exercise (MRV headroom or the
  // exercise cap can leave a top muscle without one).
  const pickedMuscles = new Set(picks.map((p) => p.muscle));
  const focus = buildFocus(topMuscles.filter((m) => pickedMuscles.has(m.muscle)));
  return {
    exercises: orderCompoundsFirst(picks, exerciseById),
    focus: followSplit && split ? `${splitFocusLead(split)} ${focus}` : focus,
    isLightSession: false,
    order: 'compounds_first',
    ...(followSplit && split
      ? { split, ...(split.kind === 'ppl' ? { splitDay: split.day } : {}) }
      : {}),
  };
}
