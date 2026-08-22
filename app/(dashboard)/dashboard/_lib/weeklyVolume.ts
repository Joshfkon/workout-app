/**
 * Weekly per-muscle volume computation, shared by the dashboard's server
 * initial-data path and the client fast-path (P1-2 / server-render item 6).
 *
 * Extracted verbatim from DashboardClient so the atrophy-risk card's data can
 * be computed on the SERVER and shipped in initialData — the card is the
 * dashboard's LCP element and was previously blocked on a client-side weekly
 * volume fetch. Pure: no React, no Supabase client.
 */

import { type MuscleVolumeData } from '@/services/volumeTracker';
import {
  groupCapScale,
  perSetCredits,
  perSetGroupCredits,
  resolvePrimaryMuscleCredits,
} from '@/services/shared/volumeCredit';
import {
  isStandardMuscle,
  legacyToStandardMuscles,
  resolveMuscleToStandard,
  STANDARD_MUSCLE_GROUPS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
import {
  COARSE_MUSCLES,
  COARSE_CHILDREN,
  STANDARD_TO_COARSE,
  FINE_CHILD_MUSCLES,
  getEffectiveBand,
  getStandardMev,
  type BandContext,
  type CoarseMuscle,
  type RecoveryProfile,
  type VolumeBand,
} from '@/services/volumeBands';
import { rollingWindowStartISO } from '@/lib/date/localDay';
import { rirFromFeedback, summarizeEffectiveVolume } from '@/services/effectiveVolume';

/**
 * The "this week" window for weekly volume: a trailing 7 local days including
 * today (the UI labels it "rolling 7 days"). Anchored to the START of the local
 * day via the localDay module, so EVERY consumer — the home glance tile
 * (server + client), the volume page's "This week vs MEV" card, and any
 * relaunch-invariance test — filters `workout_sessions.completed_at` against the
 * exact same lower bound. The bound depends only on which local day it is
 * computed on, never on the time of day, which is what makes the set count
 * stable across a force-quit/relaunch (the 71→87 regression).
 */
export const WEEKLY_VOLUME_WINDOW_DAYS = 7;

/** ISO lower bound for the weekly-volume DB range filter. Pass `now` in tests. */
export function weeklyVolumeWindowStartISO(now: Date = new Date()): string {
  return rollingWindowStartISO(WEEKLY_VOLUME_WINDOW_DAYS, now);
}

// (The per-standard MEV table lives in services/volumeBands; read it via getEffectiveBand.)

export const ALL_MUSCLE_GROUPS: readonly StandardMuscleGroup[] = STANDARD_MUSCLE_GROUPS;

// ============================================
// FINE-GRAINED MUSCLE REACHABILITY (warning gating)
// ============================================
//
// Some standard muscles have NO coarse legacy tag that can
// credit them: the runtime resolver is standard-first, so a set tagged with a
// coarse token ('glutes','abs','traps','calves','triceps') or a legacy coarse
// token ('back') resolves to [glutes] / [abs] / [traps] / [calves] /
// [triceps] / [lats,upper_back] respectively — it never leaks credit into
// glute_med / obliques / erectors / upper_traps / mid_lower_traps /
// gastrocnemius / soleus / triceps_long / triceps_lat_med. These "fine"
// muscles are therefore only reachable when the user logs an exercise tagged
// at fine grain for them.
//
// 'erectors' is a coarse GROUP since its promotion, but it stays on this list:
// the group holds exactly one standard muscle and no coarse token reaches it
// either, so its WARNING gating is unchanged. Only its ROW moved.
//
// Their coarse "parent" region (below) is where that work physiologically
// lands. When a user's data is entirely coarse (e.g. only 'glutes'/'back'/'abs'
// work), a fine child gets zero credit and its MEV warning can NEVER clear —
// which is worse than no warning. So we treat a fine muscle as warnable only
// when at least one of the user's own exercises can feed it (see
// `computeReachableMuscles`); otherwise its target rolls up into the coarse
// parent and no standalone warning is rendered (ticket policy: never warn on a
// muscle no logged-exercise tagging could satisfy).
export const FINE_MUSCLE_PARENTS: Partial<Record<StandardMuscleGroup, StandardMuscleGroup[]>> = {
  // Still listed after the erector promotion: this map is about TAG
  // REACHABILITY, not display grouping. A legacy 'back' tag still resolves to
  // [lats, upper_back] and still cannot credit erectors, so the MEV summary
  // must keep gating the erector warning for users whose library is entirely
  // coarse. (The volume/readiness ROW is no longer gated — 'erectors' is a
  // coarse row now, and coarse rows always render, like adductors.)
  erectors: ['lats', 'upper_back'], // legacy 'back'
  glute_med: ['glutes'], // legacy 'glutes'
  obliques: ['abs'], // legacy 'abs'
  upper_traps: ['traps'], // coarse 'traps'
  mid_lower_traps: ['traps'], // coarse 'traps'
  gastrocnemius: ['calves'], // coarse 'calves'
  soleus: ['calves'], // coarse 'calves'
  triceps_long: ['triceps'], // coarse 'triceps'
  triceps_lat_med: ['triceps'], // coarse 'triceps'
};

/** The standard muscles that only a fine-grained tag can credit. */
export const FINE_MUSCLES = Object.keys(FINE_MUSCLE_PARENTS) as StandardMuscleGroup[];
const FINE_MUSCLE_SET = new Set<StandardMuscleGroup>(FINE_MUSCLES);

/**
 * The set of standard muscles that ANY of the user's logged exercises can
 * credit (primary or secondary), resolved through the same standard-first
 * resolver the volume counter uses. This is what determines whether a
 * fine-grained muscle's MEV warning is satisfiable by the user's exercise
 * tagging: a library of purely coarse 'glutes'/'back'/'abs' work yields a set
 * WITHOUT glute_med / erectors / obliques.
 */
export function computeReachableMuscles(blocks: WeeklyVolumeBlockRow[]): Set<StandardMuscleGroup> {
  const reachable = new Set<StandardMuscleGroup>();
  for (const block of blocks) {
    const exercise = block.exercises;
    if (!exercise) continue;
    const tokens = [exercise.primary_muscle, ...(exercise.secondary_muscles || [])];
    for (const token of tokens) {
      if (!token) continue;
      for (const standard of resolveMuscleToStandard(token)) reachable.add(standard);
    }
  }
  return reachable;
}

/**
 * Whether an untrained standard muscle should surface a below-MEV warning.
 * Muscles outside FINE_MUSCLE_PARENTS always can. The fine muscles only
 * warn when the user's exercise tagging can actually feed them; when
 * `reachable` is omitted we preserve the pre-reachability behaviour (warn on
 * all) so callers that don't have the raw blocks are unchanged.
 */
export function isMuscleWarnable(
  muscle: StandardMuscleGroup,
  reachable?: Set<StandardMuscleGroup>
): boolean {
  if (!FINE_MUSCLE_SET.has(muscle)) return true;
  if (!reachable) return true;
  return reachable.has(muscle);
}

export function getMevForMuscle(muscle: string): number {
  const standardMuscle = toStandardMuscleForVolume(muscle);
  // PER-STANDARD MEV (warning threshold) — NOT the coarse group band MEV,
  // which differs for dual-id muscles like hamstrings (4 vs 8). Profile-
  // independent: enhanced never raises an MEV.
  if (standardMuscle) return getStandardMev(standardMuscle);
  return 4;
}

// ============================================
// EMISSION ROUNDING (round once, at the edge)
// ============================================
//
// The accumulation pipeline (accumulateExerciseVolume → stats →
// buildVolumeRows) carries FULL-PRECISION values end to end; rounding happens
// exactly once, when a number is emitted for display. Rounding mid-pipeline
// (per merge step, per layer) is what produced phantom credited counts
// ("Arnold Press 8.1" for a true 8.0) and header/list disagreements.

/**
 * Guards Math.round against IEEE-754 drift from 1/3 and 1/6 credit weights:
 * a rational 23.5 accumulated through thirds lands at 23.499999999999996 and
 * would otherwise round the wrong way. Far larger than any float dust the
 * pipeline can accumulate, far smaller than any real credit increment (1/6).
 */
const ROUNDING_EPSILON = 1e-9;

/** Round to one decimal, drift-guarded. All displayed set values use this. */
function round1(value: number): number {
  return Math.round((value + ROUNDING_EPSILON) * 10) / 10;
}

/** Round to a whole number, drift-guarded. */
function roundWhole(value: number): number {
  return Math.round(value + ROUNDING_EPSILON);
}

// Exported under explicit names for consumers OUTSIDE this module that emit
// credited-set values (hooks/useWeeklyVolume). Rounding a credited count
// anywhere must go through these: rounding components separately and adding
// them (the pre-fix useWeeklyVolume rounded direct and indirect apart, on 26
// rows) biases every total upward.
export { round1 as round1Sets, roundWhole as roundWholeSets };

/**
 * Round a list of non-negative raw values to one decimal so that the rounded
 * values sum EXACTLY to round1(Σ raw) — largest-remainder allocation in
 * integer tenths. This is what lets a counted-sets breakdown always reconcile
 * against the header it sits under: rounding each entry independently is not
 * additive (three ⅓-credits round to 0.7 + 0.7 + 0.7 = 2.1 for a true 2.0).
 */
function allocateRounded(values: number[]): number[] {
  const tenths = values.map((v) => (v + ROUNDING_EPSILON) * 10);
  const floors = tenths.map(Math.floor);
  const target = Math.round(
    values.reduce((s, v) => s + v, 0) * 10 + ROUNDING_EPSILON * 10
  );
  let remainder = target - floors.reduce((s, f) => s + f, 0);
  // Hand the leftover tenths to the entries that lost the most to flooring.
  const order = tenths
    .map((t, i) => ({ i, frac: t - Math.floor(t) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out.map((t) => t / 10);
}

export interface ExerciseVolume {
  id: string;
  name: string;
  /**
   * Working sets the user actually PERFORMED on this exercise in the window
   * (warm-ups excluded) — the input the credited fraction is computed from.
   * Whole sets, identical under every muscle row the exercise appears on
   * (merging rows across heads must NOT sum it: it's the same performed
   * work). Rendered as "4 sets → 1.3 credited" so the panel shows its own
   * inputs instead of only the post-split output.
   */
  performedSets: number;
  /**
   * Credited (fractional) working sets this exercise contributed — the
   * canonical display TOTAL (= direct + indirect; sum-preserving rounded at
   * emission so lists reconcile exactly against their header).
   */
  sets: number;
  /**
   * RIR-weighted effective volume for the same credited sets (see
   * services/effectiveVolume). Equals `sets` when every set's RIR is ≤2 or
   * unknown — the counted-sets breakdown must reconcile against BOTH header
   * metrics, so both are carried per exercise.
   */
  effective: number;
  /**
   * Composition of the credit (Phase 5): direct = from the exercise's
   * PRIMARY-muscle tag (incl. legacy-split primaries), indirect = from
   * secondary tags (the 0.5-credit share). Raw in the accumulator; rounded
   * independently to one decimal at emission, so direct + indirect can
   * differ from the displayed `sets` total by ≤0.1 — `sets`/`effective`
   * remain the canonical totals everywhere a single number is needed.
   * An indirect-only entry (direct === 0) is how a bench variant shows up
   * on the front-delt row — the UI annotates those as "secondary".
   */
  direct: number;
  indirect: number;
  directEffective: number;
  indirectEffective: number;
  /**
   * Credited share of the block's UNRATED sets (missing RIR — excluded from
   * `effective`, surfaced separately). Carried per exercise so the group-cap
   * scale can apply to it exactly like `sets`/`effective`. Optional only for
   * pre-existing cached shapes; the accumulator always writes it.
   */
  unrated?: number;
  /**
   * Segment identity: `id` + the tag signature the credit was computed under.
   * The SAME exercise id can appear with DIFFERENT tags in one window (a
   * mid-week tag edit: cached history rows carry the old tags while live
   * blocks carry the new ones — Codex P2 on #568). The group cap assumes one
   * credit rate per entry, so entries accumulate and cap PER SEGMENT; display
   * merges segments by `id` only after capping. Optional for pre-existing
   * cached shapes; treated as `id` when absent.
   */
  creditKey?: string;
}

/**
 * Emit a per-exercise breakdown for display under a header showing
 * `totalSets` / `totalEffective`: filters empty entries, sorts biggest first,
 * and rounds with sum-preserving allocation so Σ(list) === header for both
 * metrics, exactly.
 */
function emitExerciseList(
  entries: ExerciseVolume[],
): ExerciseVolume[] {
  // Merge tag-version SEGMENTS of the same exercise id for display — this
  // runs AFTER any group capping (segments cap independently upstream), so a
  // retagged exercise renders as one row whose credit is the sum of its
  // correctly-capped segments. performedSets SUM here: different segments are
  // different performed blocks (unlike the same segment seen via two heads,
  // which reconciles by max upstream).
  const byId = new Map<string, ExerciseVolume>();
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) {
      byId.set(e.id, { ...e });
      continue;
    }
    existing.performedSets += e.performedSets;
    existing.sets += e.sets;
    existing.effective += e.effective;
    existing.direct += e.direct;
    existing.indirect += e.indirect;
    existing.directEffective += e.directEffective;
    existing.indirectEffective += e.indirectEffective;
    existing.unrated = (existing.unrated ?? 0) + (e.unrated ?? 0);
  }
  const kept = Array.from(byId.values())
    .filter((e) => e.sets > ROUNDING_EPSILON)
    .sort((a, b) => b.sets - a.sets);
  const sets = allocateRounded(kept.map((e) => e.sets));
  const effective = allocateRounded(kept.map((e) => e.effective));
  return kept.map((e, i) => ({
    ...e,
    sets: sets[i],
    effective: effective[i],
    // Composition fields round independently (they annotate, they are not
    // summed by any consumer — `sets`/`effective` stay the canonical totals).
    direct: round1(e.direct),
    indirect: round1(e.indirect),
    directEffective: round1(e.directEffective),
    indirectEffective: round1(e.indirectEffective),
  }));
}

export interface MuscleVolumeStats {
  muscle: string;
  /**
   * Credited (0.5-secondary, legacy-split) working sets, FULL PRECISION —
   * not rounded. Rounding happens once at each display surface (the MEV
   * summary, buildVolumeRows) so downstream aggregates can't accumulate
   * rounding drift. `status` is still judged on the whole-set rounded value,
   * so the low/optimal/high classification is unchanged.
   */
  sets: number;
  /**
   * RIR-weighted "Effective Volume" for the same counted sets (Σ
   * EFFECTIVE_VOLUME_WEIGHTS[rir]; unknown RIR weighs 1.0). Same warm-up
   * exclusion and crediting as `sets`; full precision, rounded at display.
   */
  effectiveSets: number;
  /**
   * Credited count of sets EXCLUDED from `effectiveSets` for missing/garbage
   * RIR (services/effectiveVolume unrated rule). Any surface showing
   * `effectiveSets` must surface this when non-zero — an effective number
   * silently computed over a subset of the sets misleads in the other
   * direction from the old max-credit inflation.
   */
  unratedSets: number;
  /**
   * Composition split of `sets`/`effectiveSets` (Phase 5), full precision:
   * direct = primary-tag credit, indirect = secondary-tag (0.5) credit.
   * Invariant by construction (single accumulator, single pass):
   * directSets + indirectSets === sets and likewise for effective.
   */
  directSets: number;
  indirectSets: number;
  directEffectiveSets: number;
  indirectEffectiveSets: number;
  target: number;
  status: 'low' | 'optimal' | 'high';
  exercises: ExerciseVolume[];
}

export type VolumeAccumulator = Record<
  string,
  {
    /** Totals (= direct + indirect, maintained in the same pass). */
    sets: number;
    effectiveSets: number;
    unratedSets: number;
    /** Composition (Phase 5): primary-tag vs secondary-tag credit. */
    directSets: number;
    indirectSets: number;
    directEffectiveSets: number;
    indirectEffectiveSets: number;
    exercises: Map<string, ExerciseVolume>;
  }
>;

/** Credit one exercise block's working sets to the accumulator (weighted
 *  primary split + 0.5x secondary credit). `effectiveVolume` is the block's
 *  RIR-weighted working-set sum (see services/effectiveVolume); callers
 *  without per-set RIR omit it and the effective tally falls back to raw. */
export function accumulateExerciseVolume(
  volumeByMuscle: VolumeAccumulator,
  exercise: { id: string; name: string; primary_muscle?: string | null; secondary_muscles?: string[] | null },
  workingSets: number,
  effectiveVolume: number = workingSets,
  unratedSets: number = 0
): void {
  if (!exercise.primary_muscle || workingSets === 0) return;

  // Performed sets are per (muscle row, exercise, this call): the first credit
  // this call lands on a muscle's entry adds the block's performed count once —
  // NOT once per credit component (a direct + an indirect share, or two
  // secondary tokens resolving to the same standard muscle, are still the same
  // performed sets).
  const performedCredited = new Set<string>();

  // Entries are keyed by id + TAG SIGNATURE, not id alone: the same exercise
  // id arriving with different tags (mid-week edit; cached vs live rows) must
  // accumulate as separate segments so the group cap sees one credit rate per
  // entry. Display merges segments by id only after capping (emitExerciseList).
  const creditKey = `${exercise.id}::${(exercise.primary_muscle || '').toLowerCase()}|${(
    exercise.secondary_muscles || []
  )
    .map((s) => s.toLowerCase())
    .sort()
    .join(',')}`;

  // Direct (primary-tag) vs indirect (secondary-tag) credit is tracked in the
  // SAME pass through the same accumulator — totals stay direct + indirect by
  // construction, never a second computation path.
  const addCredit = (muscle: string, sets: number, effective: number, isDirect: boolean) => {
    if (!volumeByMuscle[muscle]) {
      volumeByMuscle[muscle] = {
        sets: 0,
        effectiveSets: 0,
        unratedSets: 0,
        directSets: 0,
        indirectSets: 0,
        directEffectiveSets: 0,
        indirectEffectiveSets: 0,
        exercises: new Map(),
      };
    }
    const entry = volumeByMuscle[muscle];
    entry.sets += sets;
    entry.effectiveSets += effective;
    // Unrated credit scales with the same factor as the raw sets, so the
    // "of X sets · Y unrated" pair stays proportional under 0.5-secondary
    // crediting.
    entry.unratedSets += workingSets > 0 ? unratedSets * (sets / workingSets) : 0;
    if (isDirect) {
      entry.directSets += sets;
      entry.directEffectiveSets += effective;
    } else {
      entry.indirectSets += sets;
      entry.indirectEffectiveSets += effective;
    }
    const existing = entry.exercises.get(creditKey);
    const ex = existing ?? {
      id: exercise.id,
      name: exercise.name,
      performedSets: 0,
      sets: 0,
      effective: 0,
      direct: 0,
      indirect: 0,
      directEffective: 0,
      indirectEffective: 0,
      unrated: 0,
      creditKey,
    };
    if (!performedCredited.has(muscle)) {
      performedCredited.add(muscle);
      ex.performedSets += workingSets;
    }
    ex.sets += sets;
    ex.effective += effective;
    ex.unrated = (ex.unrated ?? 0) + (workingSets > 0 ? unratedSets * (sets / workingSets) : 0);
    if (isDirect) {
      ex.direct += sets;
      ex.directEffective += effective;
    } else {
      ex.indirect += sets;
      ex.indirectEffective += effective;
    }
    if (!existing) entry.exercises.set(creditKey, ex);
  };

  // Per-set credits come from the CANONICAL module (services/shared/
  // volumeCredit) — this accumulator only multiplies them by the block's
  // working-set count / RIR-weighted sum and files them per muscle.
  const credits = perSetCredits(exercise.primary_muscle, exercise.secondary_muscles || []);
  const primaryResolved = credits.some((c) => c.isDirect);
  credits.forEach(({ muscle, credit, isDirect }) =>
    addCredit(muscle, workingSets * credit, effectiveVolume * credit, isDirect)
  );
  if (!primaryResolved) {
    // Unresolvable primary token: keep the raw key so the volume isn't
    // silently dropped from the per-muscle stats (legacy fallback).
    addCredit(exercise.primary_muscle.toLowerCase(), workingSets, effectiveVolume, true);
  }
}

export function volumeAccumulatorToStats(volumeByMuscle: VolumeAccumulator): MuscleVolumeStats[] {
  return Object.entries(volumeByMuscle)
    .map(([muscle, data]) => {
      const target = getMevForMuscle(muscle);
      // Status is judged on the whole-set rounded count (unchanged behavior);
      // the carried values stay full precision — display surfaces round once
      // at emission so aggregates (coarse rows) can't accumulate drift.
      const wholeSets = roundWhole(data.sets);
      const status: 'low' | 'optimal' | 'high' =
        wholeSets < target ? 'low' : wholeSets > target * 1.5 ? 'high' : 'optimal';
      const exercises = Array.from(data.exercises.values()).filter(
        (ex) => ex.sets > ROUNDING_EPSILON
      );
      return {
        muscle,
        sets: data.sets,
        effectiveSets: data.effectiveSets,
        unratedSets: data.unratedSets,
        directSets: data.directSets,
        indirectSets: data.indirectSets,
        directEffectiveSets: data.directEffectiveSets,
        indirectEffectiveSets: data.indirectEffectiveSets,
        target,
        status,
        exercises,
      };
    })
    .filter((stat) => stat.sets > ROUNDING_EPSILON)
    .sort((a, b) => b.sets - a.sets);
}

/** Block row shape from the weekly-volume query (both paths use this select).
 *  `feedback` (the set's JSONB feedback payload carrying repsInTank) is
 *  optional: paths that select it get real RIR weighting; without it every
 *  set weighs 1.0 (raw = effective). */
export interface WeeklyVolumeBlockRow {
  exercises: { id: string; name: string; primary_muscle?: string | null; secondary_muscles?: string[] | null } | null;
  set_logs: { id: string; is_warmup: boolean | null; feedback?: unknown }[] | null;
}

/** Full pipeline: rows -> per-muscle weekly stats. */
export function computeWeeklyMuscleVolume(blocks: WeeklyVolumeBlockRow[]): MuscleVolumeStats[] {
  const volumeByMuscle: VolumeAccumulator = {};
  for (const block of blocks) {
    const exercise = block.exercises;
    if (!exercise) continue;
    const workingSets = (block.set_logs || []).filter((s) => !s.is_warmup);
    // Rows whose query doesn't select `feedback` weigh 1.0 per set (raw)
    // WITHOUT the unknown-RIR warning — the data was never fetched, which is
    // different from a fetched set that genuinely lacks an RIR report.
    const hasFeedbackColumn = workingSets.some((s) => 'feedback' in s);
    const summary = hasFeedbackColumn
      ? summarizeEffectiveVolume(
          workingSets.map((s) => rirFromFeedback(s.feedback)),
          exercise.name
        )
      : null;
    accumulateExerciseVolume(
      volumeByMuscle,
      exercise,
      workingSets.length,
      summary ? summary.effectiveSets : workingSets.length,
      summary ? summary.unratedSets : 0
    );
  }
  return volumeAccumulatorToStats(volumeByMuscle);
}

/** One row of the weekly MEV breakdown (trained stats + untrained muscles). */
export interface MuscleMevEntry {
  /** Muscle key as reported by the stats (may be legacy) or a standard id. */
  muscle: string;
  sets: number;
  /** RIR-weighted effective volume for the same sets (raw when RIR unknown). */
  effectiveSets: number;
  mev: number;
  belowMev: boolean;
  /**
   * Which exercises fed this muscle and how many (fractional-credit) sets each
   * contributed — the debug view behind the warning copy (e.g. "Hamstrings
   * 3/4: RDL ×2, Back Extension ×1(½)"). Empty for untrained muscles.
   */
  exercises: ExerciseVolume[];
}

/**
 * Weekly volume rolled up against MEV — the single source for BOTH the home
 * "Weekly volume" glance tile (totalSets / totalTarget / lowCount) and the
 * volume page's "this week vs MEV" breakdown (entries), so the number the
 * user taps is the number they land on.
 */
export interface WeeklyMevSummary {
  totalSets: number;
  /** RIR-weighted effective volume across all muscles (one decimal). */
  totalEffectiveSets: number;
  totalTarget: number;
  /** Muscles below MEV: trained-but-low plus completely untrained ones. */
  lowCount: number;
  /** Per-muscle breakdown, below-MEV first (untrained at 0 sets included). */
  entries: MuscleMevEntry[];
}

/**
 * Roll weekly per-muscle stats up against MEV. Normalizes to standard IDs and
 * folds in untrained (0-set) muscles so the count isn't inflated/deflated by
 * legacy names or missing muscles. A legacy group (e.g. "shoulders") maps to
 * MULTIPLE standard muscles, so expand it to all of them — taking only the
 * first would leave the rest counted as untrained. Returns null when no
 * volume has been logged yet (callers show their own empty state).
 */
export function computeWeeklyMevSummary(
  muscleVolume: MuscleVolumeStats[],
  reachable?: Set<StandardMuscleGroup>
): WeeklyMevSummary | null {
  if (muscleVolume.length === 0) return null;

  const trainedMuscles = new Set<StandardMuscleGroup>(
    muscleVolume.flatMap((mv) => {
      const key = mv.muscle.toLowerCase().trim();
      // Some standard ids ("glutes", "abs") are ALSO legacy-map keys, so check
      // standard first — expanding those would wrongly credit sibling muscles
      // (glute_med, obliques) and understate the below-target count.
      if (isStandardMuscle(key)) return [key];
      const expanded = legacyToStandardMuscles(key);
      if (expanded.length > 0) return expanded;
      const single = toStandardMuscleForVolume(mv.muscle);
      return single ? [single] : [];
    })
  );
  // Untrained (0-set) muscles surface as below-MEV warnings — EXCEPT the three
  // fine muscles (erectors / glute_med / obliques) when the user's own exercise
  // tagging can't feed them: warning on a muscle no logged exercise could
  // satisfy is a permanent, un-clearable nag (worse than no warning). Coarse
  // muscles are always warnable; a fine muscle is dropped here (its target rolls
  // up into its coarse parent implicitly) unless it is reachable.
  const untrained = ALL_MUSCLE_GROUPS.filter(
    (m) => !trainedMuscles.has(m) && isMuscleWarnable(m, reachable)
  );

  // Stats arrive full precision; this summary displays whole sets per muscle,
  // so round here (once) — and make the total the sum of the SAME whole-set
  // numbers the entries show, so the tile always reconciles with its list.
  const totalSets = muscleVolume.reduce((s, mv) => s + roundWhole(mv.sets), 0);
  const totalEffectiveSets = round1(
    muscleVolume.reduce((s, mv) => s + mv.effectiveSets, 0)
  );
  const totalTarget =
    muscleVolume.reduce((s, mv) => s + mv.target, 0) +
    untrained.reduce((s, m) => s + getMevForMuscle(m), 0);
  const lowCount = muscleVolume.filter((mv) => mv.status === 'low').length + untrained.length;

  const entries: MuscleMevEntry[] = [
    ...muscleVolume.map((mv) => ({
      muscle: mv.muscle,
      sets: roundWhole(mv.sets),
      effectiveSets: round1(mv.effectiveSets),
      mev: getMevForMuscle(mv.muscle),
      belowMev: mv.status === 'low',
      exercises: emitExerciseList(mv.exercises),
    })),
    ...untrained.map((m) => ({
      muscle: m as string,
      sets: 0,
      effectiveSets: 0,
      mev: getMevForMuscle(m),
      belowMev: true,
      exercises: [],
    })),
  ].sort((a, b) => Number(b.belowMev) - Number(a.belowMev) || b.sets - a.sets);

  return { totalSets, totalEffectiveSets, totalTarget, lowCount, entries };
}

/**
 * One-call convenience: raw weekly-volume blocks → the shared MEV summary with
 * reachability gating applied. Every surface that has the raw blocks (home
 * server + client fetch, the "This Week vs MEV" widget, both AtrophyRiskAlerts)
 * should use this so the fine-muscle warnings are gated identically everywhere.
 */
export function summarizeWeeklyVolume(blocks: WeeklyVolumeBlockRow[]): WeeklyMevSummary | null {
  return computeWeeklyMevSummary(
    computeWeeklyMuscleVolume(blocks),
    computeReachableMuscles(blocks)
  );
}

/**
 * The SINGLE below-MEV list both the "This Week vs MEV" card and the
 * "Insufficient Volume" atrophy-risk warning consume, so their counts can
 * never diverge again. Returns the below-MEV entries of a summary (trained-
 * but-low PLUS completely-untrained 0-set muscles — see computeWeeklyMevSummary
 * for why untrained muscles are included). Entries keep the summary's
 * below-MEV-first ordering.
 */
export function selectMusclesBelowMev(summary: WeeklyMevSummary | null): MuscleMevEntry[] {
  if (!summary) return [];
  return summary.entries.filter((e) => e.belowMev);
}

/**
 * Adapt the shared below-MEV list to the `MuscleVolumeData[]` shape the
 * AtrophyRiskAlert component already renders (muscleGroup / totalSets /
 * landmarks.mev). Only `mev` is meaningful downstream — the alert sorts by the
 * MEV deficit and shows `sets/mev`; mav/mrv are carried only to satisfy the
 * type and are set to mev as neutral placeholders. Entries whose muscle key
 * can't be normalized to a standard group are dropped.
 */
export function mevSummaryToVolumeData(summary: WeeklyMevSummary | null): MuscleVolumeData[] {
  return selectMusclesBelowMev(summary)
    .map((entry): MuscleVolumeData | null => {
      const standardMuscle = isStandardMuscle(entry.muscle)
        ? (entry.muscle as StandardMuscleGroup)
        : toStandardMuscleForVolume(entry.muscle);
      if (!standardMuscle) return null;
      return {
        muscleGroup: standardMuscle as StandardMuscleGroup,
        totalSets: entry.sets,
        directSets: entry.sets,
        indirectSets: 0,
        landmarks: { mev: entry.mev, mav: entry.mev, mrv: entry.mev },
        status: 'below_mev',
        percentOfMrv: 0,
        contributingExercises: entry.exercises,
      };
    })
    .filter((d): d is MuscleVolumeData => d !== null);
}

// ============================================
// UNIFIED PRESENTATION MODEL (one model for every surface)
// ============================================
//
// Volume page bars, the Home/Train widget, the readiness sheet and the
// insufficient-volume warning all render from THIS model, so they can never
// again disagree on count (they share the 0.5-secondary reachability-gated
// counter), denominator (the MEV–MRV band below) or taxonomy (coarse rows with
// fine children). See buildVolumeRows.

// The coarse-group taxonomy and the research bands live in
// services/volumeBands (pure data) so the program generator can clamp its
// targets against the SAME ceilings the tracking surfaces render —
// re-exported here so every existing consumer keeps its import path.
export {
  COARSE_MUSCLES,
  COARSE_CHILDREN,
  STANDARD_TO_COARSE,
  FINE_CHILD_MUSCLES,
  getEffectiveBand,
  type BandContext,
  type CoarseMuscle,
  type RecoveryProfile,
  type VolumeBand,
} from '@/services/volumeBands';




// (The coarse research bands live in services/volumeBands; read them via getEffectiveBand.)

/** MEV target for a fine child row (its own subdivision-level threshold).
 *  Profile-independent — enhanced scaling never raises an MEV. */
export function fineChildMev(muscle: StandardMuscleGroup): number {
  return getStandardMev(muscle);
}

// (Fine-child band synthesis moved into services/volumeBands.getEffectiveBand.)

export type VolumeZone = 'below_mev' | 'in_zone' | 'over_mrv';

/**
 * The one zone rule everywhere: below MEV, inside the MEV–MRV band, or past MRV.
 * Green is the WHOLE band (MEV..MRV) — the bar only turns red past MRV, so
 * hitting the target is rewarded, not punished.
 */
export function volumeZone(sets: number, band: VolumeBand): VolumeZone {
  if (sets < band.mev) return 'below_mev';
  if (sets <= band.mrv) return 'in_zone';
  return 'over_mrv';
}

/**
 * The one zone→color decision, shared by bars, text and the SVG muscle map.
 * 'neutral' is the untrained case (0 sets below MEV) that reads gray instead
 * of amber. Every zone*Class helper below is a pure token→utility lookup over
 * this, so a surface can never disagree on which color a zone gets.
 */
export type ZoneColorToken = 'success' | 'warning' | 'danger' | 'neutral';

export function zoneColorToken(zone: VolumeZone, sets: number): ZoneColorToken {
  if (zone === 'over_mrv') return 'danger';
  if (zone === 'in_zone') return 'success';
  return sets <= 0 ? 'neutral' : 'warning';
}

const ZONE_BAR_CLASSES: Record<ZoneColorToken, string> = {
  danger: 'bg-danger-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  neutral: 'bg-surface-600',
};

const ZONE_TEXT_CLASSES: Record<ZoneColorToken, string> = {
  danger: 'text-danger-400',
  success: 'text-success-400',
  warning: 'text-warning-400',
  neutral: 'text-surface-400',
};

const ZONE_FILL_CLASSES: Record<ZoneColorToken, string> = {
  danger: 'fill-danger-500',
  success: 'fill-success-500',
  warning: 'fill-warning-500',
  neutral: 'fill-surface-600',
};

/** Bar fill colour for a zone. Untrained (0 sets, below MEV) reads gray. */
export function zoneBarClass(zone: VolumeZone, sets: number): string {
  return ZONE_BAR_CLASSES[zoneColorToken(zone, sets)];
}

/** Text/emphasis colour matching a zone. */
export function zoneTextClass(zone: VolumeZone, sets: number): string {
  return ZONE_TEXT_CLASSES[zoneColorToken(zone, sets)];
}

/** SVG fill colour matching a zone — the muscle-map twin of zoneBarClass. */
export function zoneFillClass(zone: VolumeZone, sets: number): string {
  return ZONE_FILL_CLASSES[zoneColorToken(zone, sets)];
}

/**
 * The minimum a colorized row must expose for the row-aware color decision:
 * its zone + sets (the plain zone rule) and whether any reachable fine child
 * sits below its own MEV.
 */
export interface RowColorInput {
  zone: VolumeZone;
  sets: number;
  laggingChildren?: boolean;
}

/**
 * Row-aware color token: the shared zone rule, EXCEPT a parent whose reachable
 * fine children include one below its own MEV can never read success — the
 * group aggregate would be advertising "all good" while hiding a lagging
 * subdivision (front delts stuffed by pressing while side delts starve). Such
 * a row demotes to warning. Use these helpers wherever a COARSE row is
 * colorized; children carry laggingChildren: false and pass through unchanged.
 */
export function rowColorToken(row: RowColorInput): ZoneColorToken {
  const token = zoneColorToken(row.zone, row.sets);
  return token === 'success' && row.laggingChildren === true ? 'warning' : token;
}

/** Row-aware bar fill colour (zoneBarClass + the lagging-child demotion). */
export function rowBarClass(row: RowColorInput): string {
  return ZONE_BAR_CLASSES[rowColorToken(row)];
}

/** Row-aware text colour (zoneTextClass + the lagging-child demotion). */
export function rowTextClass(row: RowColorInput): string {
  return ZONE_TEXT_CLASSES[rowColorToken(row)];
}

/** Row-aware SVG fill (zoneFillClass + the lagging-child demotion). */
export function rowFillClass(row: RowColorInput): string {
  return ZONE_FILL_CLASSES[rowColorToken(row)];
}

/**
 * Denominator label: the MEV–MRV band, never n/MEV. e.g. "credited zone 8–20".
 *
 * "credited" names the UNIT, and it is not decoration. These thresholds count
 * a primary tag as 1.0 per set and a secondary tag as 0.5, which is a
 * different quantity from the direct programmed sets the settings landmark
 * editor shows — the same muscle legitimately reads 0 there and 4 here. See
 * the direct/credited convention note on the credited MEV table in
 * services/volumeBands.
 */
export function zoneBandLabel(band: VolumeBand): string {
  return `credited zone ${band.mev}–${band.mrv}`;
}

/**
 * Denominator label for a COARSE row: same band and same credited unit,
 * prefixed "group" so an independent group-level landmark can't be misread as
 * the sum of the child zones shown beneath it (see the band semantics note in
 * services/volumeBands).
 */
export function groupZoneBandLabel(band: VolumeBand): string {
  return `credited group zone ${band.mev}–${band.mrv}`;
}

/** Display name for a coarse group. */
export function coarseDisplayName(muscle: CoarseMuscle): string {
  return muscle.charAt(0).toUpperCase() + muscle.slice(1);
}

/** One row (coarse group, or a fine child of one) in the shared model. */
export interface VolumeRow {
  /** Stable key: the coarse id, or `${parent}:${muscle}` for a child. */
  key: string;
  /** The muscle id (coarse or standard). */
  muscle: string;
  displayName: string;
  isChild: boolean;
  parent: CoarseMuscle | null;
  /** Credited (0.5-secondary) working sets, rounded once to one decimal at
   *  emission (so ⅓/½ credits survive: 23.5, 9.8 — never a phantom re-round). */
  sets: number;
  /** RIR-weighted effective volume for the same sets (one decimal). */
  effectiveSets: number;
  /** Credited sets excluded from `effectiveSets` for missing RIR (one decimal).
   *  Surfaced next to the effective number whenever non-zero. */
  unratedSets: number;
  /**
   * Composition (Phase 5): the share of `sets`/`effectiveSets` that came from
   * PRIMARY-muscle tags (one decimal; indirect = total − direct). Lets the UI
   * show "9.7 eff (4.3 direct)" so a press-inflated front-delt row is honest
   * about how much is secondary credit.
   */
  directSets: number;
  directEffectiveSets: number;
  band: VolumeBand;
  zone: VolumeZone;
  belowMev: boolean;
  /**
   * Coarse rows only: at least one REACHABLE fine child is below its own MEV.
   * Drives the row-aware color demotion (rowColorToken): an in-zone parent
   * with a lagging subdivision renders warning, never success. Always false
   * on child rows.
   */
  laggingChildren: boolean;
  /** Whether the user's exercises can feed this muscle (children only gate). */
  reachable: boolean;
  /**
   * Whether a below-MEV reading on this row may raise a WARNING (the atrophy
   * alert, the glance tile's "N below MEV"). The row still RENDERS and still
   * colours by its true zone either way — this gates nagging, not display.
   *
   * A coarse row is warnable when at least one of its standard members is
   * (isMuscleWarnable): non-fine members always are, fine members only when
   * the user's own exercise tagging can actually feed them. That matters for
   * exactly one group — 'erectors', whose single member is a fine muscle no
   * coarse token can credit. A user logging only legacy 'back'-tagged work
   * does erector work the tagging cannot express, so warning them would be the
   * permanent un-clearable nag the fine-muscle policy exists to prevent. Every
   * other group holds a non-fine member and is therefore always warnable —
   * an untrained 'adductors' warns exactly as it did before.
   *
   * Always true on child rows (they gate on `reachable` instead).
   */
  warnable: boolean;
  /**
   * Coarse rows only: whether the row can be expanded — i.e. whether the group
   * HAS anatomical subdivisions. This is what gates the chevron on every
   * surface. Deliberately independent of reachability: a group's anatomy does
   * not depend on what the user has logged, so Abs always opens to Obliques
   * even before anything has fed it.
   */
  expandable: boolean;
  exercises: ExerciseVolume[];
  /**
   * ALL fine children of an expandable coarse row (each flagged belowMev and
   * reachable; unreachable ones are expand-only context rows shown at 0).
   * Visibility (pinned-lagging vs behind-the-chevron) is decided by the shared
   * MuscleGroupList component / withVisibleChildren helper, not here.
   */
  children: VolumeRow[];
}

export interface BuildVolumeRowsOptions {
  /** Per-coarse band overrides (e.g. the reset/learned table). */
  bands?: Partial<Record<CoarseMuscle, VolumeBand>>;
  /** Recovery profile — enhanced scales band MRVs (never MEVs). */
  recoveryProfile?: RecoveryProfile;
}

/** Per-standard-muscle rollup carried into the row model (full precision). */
export interface StandardMuscleRollup {
  sets: number;
  effectiveSets: number;
  unratedSets: number;
  directSets: number;
  indirectSets: number;
  directEffectiveSets: number;
  indirectEffectiveSets: number;
  exercises: ExerciseVolume[];
}

const emptyRollup = (): StandardMuscleRollup => ({
  sets: 0,
  effectiveSets: 0,
  unratedSets: 0,
  directSets: 0,
  indirectSets: 0,
  directEffectiveSets: 0,
  indirectEffectiveSets: 0,
  exercises: [],
});

/**
 * Accumulate credited sets + contributing exercises per standard muscle.
 *
 * This is the PER-HEAD view: sub-muscle counters are independent and may
 * legitimately overlap (one incline-press set feeds chest_upper 1.0 AND
 * chest_lower 0.5), which is correct for per-head programming decisions. It is
 * therefore NOT summable into a group total — the group rollup applies the
 * within-group credit cap in buildVolumeRows. Exported so per-head consumers
 * (hooks/useWeeklyVolume) read the SAME accumulation the rows are built from
 * instead of running a second pass.
 */
export function setsByStandardMuscle(
  stats: MuscleVolumeStats[]
): Map<StandardMuscleGroup, StandardMuscleRollup> {
  const out = new Map<StandardMuscleGroup, StandardMuscleRollup>();
  const add = (m: StandardMuscleGroup, stat: MuscleVolumeStats, share: number) => {
    const cur = out.get(m) ?? emptyRollup();
    cur.sets += stat.sets * share;
    cur.effectiveSets += stat.effectiveSets * share;
    cur.unratedSets += stat.unratedSets * share;
    cur.directSets += stat.directSets * share;
    cur.indirectSets += stat.indirectSets * share;
    cur.directEffectiveSets += stat.directEffectiveSets * share;
    cur.indirectEffectiveSets += stat.indirectEffectiveSets * share;
    for (const ex of stat.exercises) {
      // Segment identity (id + tag signature), NOT display id: same-id entries
      // with different tags must stay separate until the group cap has run.
      const existing = cur.exercises.find(
        (e) => (e.creditKey ?? e.id) === (ex.creditKey ?? ex.id)
      );
      // The exercise entries carry the SAME share as the numeric rollup — a
      // legacy-keyed stat split across N standards contributes 1/N of each
      // entry to each, so Σ(entries) always equals the rollup totals (the
      // audit §5 latent double-count, closed).
      if (existing) {
        existing.sets += ex.sets * share;
        existing.effective += ex.effective * share;
        existing.direct += ex.direct * share;
        existing.indirect += ex.indirect * share;
        existing.directEffective += ex.directEffective * share;
        existing.indirectEffective += ex.indirectEffective * share;
        existing.unrated = (existing.unrated ?? 0) + (ex.unrated ?? 0) * share;
        // Same exercise arriving via another stat key is the SAME performed
        // work — never summed, only reconciled.
        existing.performedSets = Math.max(existing.performedSets, ex.performedSets);
      } else {
        cur.exercises.push({
          ...ex,
          sets: ex.sets * share,
          effective: ex.effective * share,
          direct: ex.direct * share,
          indirect: ex.indirect * share,
          directEffective: ex.directEffective * share,
          indirectEffective: ex.indirectEffective * share,
          unrated: (ex.unrated ?? 0) * share,
        });
      }
    }
    out.set(m, cur);
  };
  for (const stat of stats) {
    const standards = isStandardMuscle(stat.muscle.toLowerCase().trim())
      ? [stat.muscle.toLowerCase().trim() as StandardMuscleGroup]
      : resolveMuscleToStandard(stat.muscle);
    if (standards.length === 0) continue;
    // Split a legacy-keyed stat evenly across the standards it covers.
    for (const std of standards) add(std, stat, 1 / standards.length);
  }
  return out;
}

/**
 * THE shared row model. Given the shared counter's per-muscle stats and the
 * reachability set, produce coarse rows (below-MEV first). Every group with
 * subdivisions carries ALL of them — unreachable ones flagged reachable:false
 * as expand-only context rows at 0. Which children are VISIBLE is a
 * presentation concern — the shared MuscleGroupList component pins reachable
 * lagging children open and puts the rest behind the chevron.
 * Every surface renders from this so counts and zone-status always agree.
 */
export function buildVolumeRows(
  stats: MuscleVolumeStats[],
  reachable?: Set<StandardMuscleGroup>,
  opts: BuildVolumeRowsOptions = {}
): VolumeRow[] {
  const byStd = setsByStandardMuscle(stats);

  const rows: VolumeRow[] = COARSE_MUSCLES.map((coarse) => {
    const children = COARSE_CHILDREN[coarse];
    const bandCtx: BandContext = { recoveryProfile: opts.recoveryProfile };
    const band = opts.bands?.[coarse] ?? getEffectiveBand(coarse, bandCtx);

    // The chevron rule: a coarse row is expandable when it HAS subdivisions —
    // reachability does not enter into it. The anatomy of a group is a fact
    // about the taxonomy, not about what the user happens to have logged, so
    // Obliques sits under Abs (and Glute Med under Glutes, the trap and tricep
    // heads under theirs) whether or not anything has fed it yet. An unfed
    // subdivision reads 0 and carries reachable:false, which is what keeps it
    // out of the warning, pinning and target-recommendation paths — display is
    // ungated here, nagging stays gated downstream.
    const expandable = children.some((c) => FINE_CHILD_MUSCLES.has(c));

    // Accumulate the per-exercise breakdown at FULL precision; rounding
    // happens once at emission (emitExerciseList), sum-preserving so the
    // list always reconciles exactly against the row header. Rounding at
    // each merge step here is what produced "Arnold Press 8.1" for a true
    // 8.0 (three ⅓-credits, each merge re-rounded).
    const coarseExercises: ExerciseVolume[] = [];
    const childRows: VolumeRow[] = [];

    for (const child of children) {
      const data = byStd.get(child) ?? emptyRollup();
      for (const ex of data.exercises) {
        // Match by SEGMENT (id + tag signature): the per-exercise cap below
        // assumes one credit rate per entry (Codex P2 on #568) — segments of
        // a retagged exercise merge by display id only AFTER capping, inside
        // emitExerciseList.
        const existing = coarseExercises.find(
          (e) => (e.creditKey ?? e.id) === (ex.creditKey ?? ex.id)
        );
        if (existing) {
          existing.sets += ex.sets;
          existing.effective += ex.effective;
          existing.direct += ex.direct;
          existing.indirect += ex.indirect;
          existing.directEffective += ex.directEffective;
          existing.indirectEffective += ex.indirectEffective;
          existing.unrated = (existing.unrated ?? 0) + (ex.unrated ?? 0);
          // The group row shows the same performed sets, credit merged across
          // heads — performed work never sums when heads merge.
          existing.performedSets = Math.max(existing.performedSets, ex.performedSets);
        } else {
          coarseExercises.push({ ...ex });
        }
      }

      if (!FINE_CHILD_MUSCLES.has(child)) continue;

      const childSets = round1(data.sets);
      const childMev = fineChildMev(child);
      // Every group with subdivisions carries ALL of them, including unfed ones
      // at 0: those are context rows the user reveals by expanding; they carry
      // reachable:false so the warning/target selectors skip them and the
      // pinned (always-visible) rule — reachable AND below-MEV — never surfaces
      // them uninvited. Which children are VISIBLE (pinned vs behind the
      // chevron) is the shared MuscleGroupList / withVisibleChildren layer's
      // decision.
      if (!expandable) continue;
      const childReachable = !reachable || reachable.has(child);
      const childBelowMev = childSets < childMev;

      // A fine child's band is its OWN subdivision-level research landmark —
      // never a slice of the parent band (resolved by the single band source).
      const childBand: VolumeBand = getEffectiveBand(child, bandCtx);
      childRows.push({
        key: `${coarse}:${child}`,
        muscle: child,
        displayName: STANDARD_MUSCLE_DISPLAY_NAMES[child],
        isChild: true,
        parent: coarse,
        sets: childSets,
        effectiveSets: round1(data.effectiveSets),
        unratedSets: round1(data.unratedSets),
        directSets: round1(data.directSets),
        directEffectiveSets: round1(data.directEffectiveSets),
        band: childBand,
        zone: volumeZone(childSets, childBand),
        belowMev: childBelowMev,
        laggingChildren: false,
        reachable: childReachable,
        warnable: true,
        expandable: false,
        exercises: emitExerciseList(data.exercises),
        children: [],
      });
    }

    // ── GROUP SET-CREDIT CAP (canonical: services/shared/volumeCredit) ──
    // A group row's totals are NOT the sum of its (legitimately overlapping)
    // sub-muscle counters: per exercise, the group's credit is capped at 1.0
    // per performed set — an exercise tagged primary-to-one-head + secondary-
    // to-another-head-in-the-same-group credits the group its performed sets,
    // not 1.5×. The scale applies uniformly to raw, effective, composition
    // and unrated shares, so RIR weighting rides ON TOP of the cap and the
    // header always equals Σ(panel) for every metric. Sub-muscle child rows
    // below keep their uncapped per-head credit — that overlap is correct for
    // per-head programming decisions. Cross-group inflow is untouched
    // (WITHIN-GROUP cap only — see volumeCredit's module header).
    const cappedExercises = coarseExercises.map((ex) => {
      const f = groupCapScale(ex.performedSets, ex.sets);
      if (f === 1) return ex;
      return {
        ...ex,
        sets: ex.sets * f,
        effective: ex.effective * f,
        direct: ex.direct * f,
        indirect: ex.indirect * f,
        directEffective: ex.directEffective * f,
        indirectEffective: ex.indirectEffective * f,
        unrated: (ex.unrated ?? 0) * f,
      };
    });
    // Group totals derive from the SAME capped per-exercise entries the panel
    // renders — never from summing sub-muscle counters.
    let coarseSetsRaw = 0;
    let coarseEffectiveRaw = 0;
    let coarseUnratedRaw = 0;
    let coarseDirectRaw = 0;
    let coarseDirectEffectiveRaw = 0;
    for (const ex of cappedExercises) {
      coarseSetsRaw += ex.sets;
      coarseEffectiveRaw += ex.effective;
      coarseUnratedRaw += ex.unrated ?? 0;
      coarseDirectRaw += ex.direct;
      coarseDirectEffectiveRaw += ex.directEffective;
    }

    const coarseSets = round1(coarseSetsRaw);
    return {
      key: coarse,
      muscle: coarse,
      displayName: coarseDisplayName(coarse),
      isChild: false,
      parent: null,
      sets: coarseSets,
      effectiveSets: round1(coarseEffectiveRaw),
      unratedSets: round1(coarseUnratedRaw),
      directSets: round1(coarseDirectRaw),
      directEffectiveSets: round1(coarseDirectEffectiveRaw),
      band,
      zone: volumeZone(coarseSets, band),
      belowMev: coarseSets < band.mev,
      // ALL reachable children count, not just visible ones — an explicit
      // collapse must not turn a lagging-subdivision parent green.
      laggingChildren: childRows.some((c) => c.reachable && c.belowMev),
      reachable: true,
      warnable: children.some((c) => isMuscleWarnable(c, reachable)),
      expandable,
      exercises: emitExerciseList(cappedExercises),
      children: childRows.sort((a, b) => Number(b.belowMev) - Number(a.belowMev) || b.sets - a.sets),
    };
  });

  // Below-MEV coarse rows first, then by how full the bar is (sets desc).
  return rows.sort(
    (a, b) => Number(b.belowMev) - Number(a.belowMev) || b.sets - a.sets || a.displayName.localeCompare(b.displayName)
  );
}

/**
 * Home/Train glance-tile numbers derived from the SAME coarse rows the volume
 * page and readiness sheet render, so "N below MEV" and the totals can't
 * diverge from the bars. totalTarget sums the coarse MEV floors; lowCount is the
 * coarse groups whose bar is below MEV.
 */
export interface CoarseMevTiles {
  totalSets: number;
  /** RIR-weighted effective volume across coarse rows (one decimal). */
  totalEffectiveSets: number;
  totalTarget: number;
  lowCount: number;
}
export function coarseMevTiles(rows: VolumeRow[]): CoarseMevTiles {
  let totalSets = 0;
  let totalEffectiveSets = 0;
  let totalTarget = 0;
  let lowCount = 0;
  for (const row of rows) {
    totalSets += row.sets;
    totalEffectiveSets += row.effectiveSets;
    totalTarget += row.band.mev;
    // Same warnability gate as belowMevVolumeData, so the tile's "N below MEV"
    // can't count a group the warning list deliberately omits.
    if (row.zone === 'below_mev' && row.warnable) lowCount++;
  }
  // Rows carry one-decimal values; re-round the sums to shed float dust.
  return { totalSets: round1(totalSets), totalEffectiveSets: round1(totalEffectiveSets), totalTarget, lowCount };
}

/**
 * Below-MEV muscles for the insufficient-volume warning, derived from the
 * coarse rows so the warning, the bars and the glance tile all agree on WHICH
 * muscles are below MEV and by how much (same band, same zone rule). Coarse
 * groups whose bar is below MEV come first, each followed by any lagging fine
 * child. Shaped as MuscleVolumeData for the existing AtrophyRiskAlert; the
 * muscleGroup carries a coarse or fine id (the alert renders it as a label).
 */
export function belowMevVolumeData(rows: VolumeRow[]): MuscleVolumeData[] {
  const out: MuscleVolumeData[] = [];
  const push = (
    muscle: string,
    sets: number,
    band: VolumeBand,
    exercises: ExerciseVolume[]
  ) =>
    out.push({
      muscleGroup: muscle as StandardMuscleGroup,
      totalSets: sets,
      directSets: sets,
      indirectSets: 0,
      landmarks: { mev: band.mev, mav: Math.round((band.mev + band.mrv) / 2), mrv: band.mrv },
      status: 'below_mev',
      percentOfMrv: band.mrv > 0 ? Math.round((sets / band.mrv) * 100) : 0,
      contributingExercises: exercises,
    });

  for (const row of rows) {
    // `warnable` keeps a group no logged-exercise tagging could satisfy out of
    // the warning (see VolumeRow.warnable) — today only an unreachable
    // 'erectors'. Every other group is always warnable, so this is a no-op for
    // them.
    if (row.zone === 'below_mev' && row.warnable) push(row.muscle, row.sets, row.band, row.exercises);
    for (const child of row.children) {
      // Unreachable children can be present when the user expanded the parent
      // (context rows) — never warn on those; the warning stays satisfiable.
      if (child.belowMev && child.reachable) push(child.muscle, child.sets, child.band, child.exercises);
    }
  }
  return out;
}

/**
 * Trailing-window secondary-credit ratio per coarse muscle: credited sets
 * (primary + 0.5×secondary) over primary-only sets. Reference metric for the
 * learned-MEV reconciliation (the "reset to defaults + relearn" path uses the
 * research bands directly; a rescale path would multiply learned thresholds by
 * this). Muscles with no primary work are omitted (ratio undefined).
 */
export function computeSecondaryCreditRatio(
  blocks: WeeklyVolumeBlockRow[]
): Partial<Record<CoarseMuscle, number>> {
  const primary = {} as Record<CoarseMuscle, number>;
  const credited = {} as Record<CoarseMuscle, number>;
  for (const c of COARSE_MUSCLES) { primary[c] = 0; credited[c] = 0; }

  for (const block of blocks) {
    const ex = block.exercises;
    if (!ex?.primary_muscle) continue;
    const working = (block.set_logs || []).filter((s) => !s.is_warmup).length;
    if (working === 0) continue;

    // Canonical per-set math: primary-only credit for the denominator, capped
    // group credit for the numerator (this ratio is a GROUP-level reference
    // metric, so it carries the same per-group cap the group rollup does).
    for (const { muscle, weight } of resolvePrimaryMuscleCredits(ex.primary_muscle)) {
      const coarse = STANDARD_TO_COARSE[muscle];
      if (!coarse) continue;
      primary[coarse] += working * weight;
    }
    for (const { group, credit } of perSetGroupCredits(ex.primary_muscle, ex.secondary_muscles || [])) {
      credited[group] += working * credit;
    }
  }

  const ratios: Partial<Record<CoarseMuscle, number>> = {};
  for (const c of COARSE_MUSCLES) {
    if (primary[c] > 0) ratios[c] = Math.round((credited[c] / primary[c]) * 100) / 100;
  }
  return ratios;
}
