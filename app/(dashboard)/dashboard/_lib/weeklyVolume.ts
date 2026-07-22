/**
 * Weekly per-muscle volume computation, shared by the dashboard's server
 * initial-data path and the client fast-path (P1-2 / server-render item 6).
 *
 * Extracted verbatim from DashboardClient so the atrophy-risk card's data can
 * be computed on the SERVER and shipped in initialData — the card is the
 * dashboard's LCP element and was previously blocked on a client-side weekly
 * volume fetch. Pure: no React, no Supabase client.
 */

import {
  resolvePrimaryMuscleCredits,
  SECONDARY_MUSCLE_CREDIT,
  type MuscleVolumeData,
} from '@/services/volumeTracker';
import {
  DEFAULT_VOLUME_LANDMARKS,
  isStandardMuscle,
  legacyToStandardMuscles,
  resolveMuscleToStandard,
  STANDARD_MUSCLE_GROUPS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
import { rollingWindowStartISO } from '@/lib/date/localDay';
import { rirFromFeedback, sumEffectiveVolume } from '@/services/effectiveVolume';

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

// MEV per standard muscle (24 muscles) — the threshold for the 'low' status.
// TOTAL-INCLUSIVE (Phase 5b, adopted): the counter credits secondary work at
// 0.5/set, so thresholds are stated against that total. front_delts 2 and
// rear_delts 3 are deliberately below their direct-work literature values —
// pressing routinely supplies 4–6 indirect front-delt sets (rows/pulldowns
// 1–3 rear-delt sets), and warning at a direct-work threshold would nag users
// whose indirect volume already covers the muscle.
export const MEV_TARGETS: Record<StandardMuscleGroup, number> = {
  chest_upper: 4, chest_lower: 4,
  front_delts: 2, lateral_delts: 6, rear_delts: 3,
  lats: 6, upper_back: 4, traps: 4, upper_traps: 3, mid_lower_traps: 2,
  biceps: 4, triceps: 4, forearms: 4,
  quads: 6, hamstrings: 4, glutes: 4, glute_med: 2, adductors: 4,
  calves: 6, gastrocnemius: 4, soleus: 3,
  abs: 6, obliques: 4, erectors: 4,
};

export const ALL_MUSCLE_GROUPS: readonly StandardMuscleGroup[] = STANDARD_MUSCLE_GROUPS;

// ============================================
// FINE-GRAINED MUSCLE REACHABILITY (warning gating)
// ============================================
//
// Of the 24 standard muscles, seven have NO coarse legacy tag that can
// credit them: the runtime resolver is standard-first, so a set tagged with a
// coarse token ('glutes','abs','traps','calves') or a legacy coarse token
// ('back') resolves to [glutes] / [abs] / [traps] / [calves] /
// [lats,upper_back] respectively — it never leaks credit into glute_med /
// obliques / erectors / upper_traps / mid_lower_traps / gastrocnemius /
// soleus. These "fine" muscles are therefore only reachable when the user
// logs an exercise tagged at fine grain for them.
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
  erectors: ['lats', 'upper_back'], // legacy 'back'
  glute_med: ['glutes'], // legacy 'glutes'
  obliques: ['abs'], // legacy 'abs'
  upper_traps: ['traps'], // coarse 'traps'
  mid_lower_traps: ['traps'], // coarse 'traps'
  gastrocnemius: ['calves'], // coarse 'calves'
  soleus: ['calves'], // coarse 'calves'
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
 * Coarse-reachable muscles (17 of 20) always can. The three fine muscles only
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
  if (standardMuscle && standardMuscle in MEV_TARGETS) {
    return MEV_TARGETS[standardMuscle as StandardMuscleGroup];
  }
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
  const kept = entries
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
  effectiveVolume: number = workingSets
): void {
  if (!exercise.primary_muscle || workingSets === 0) return;

  // Direct (primary-tag) vs indirect (secondary-tag) credit is tracked in the
  // SAME pass through the same accumulator — totals stay direct + indirect by
  // construction, never a second computation path.
  const addCredit = (muscle: string, sets: number, effective: number, isDirect: boolean) => {
    if (!volumeByMuscle[muscle]) {
      volumeByMuscle[muscle] = {
        sets: 0,
        effectiveSets: 0,
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
    if (isDirect) {
      entry.directSets += sets;
      entry.directEffectiveSets += effective;
    } else {
      entry.indirectSets += sets;
      entry.indirectEffectiveSets += effective;
    }
    const existing = entry.exercises.get(exercise.id);
    const ex = existing ?? {
      id: exercise.id,
      name: exercise.name,
      sets: 0,
      effective: 0,
      direct: 0,
      indirect: 0,
      directEffective: 0,
      indirectEffective: 0,
    };
    ex.sets += sets;
    ex.effective += effective;
    if (isDirect) {
      ex.direct += sets;
      ex.directEffective += effective;
    } else {
      ex.indirect += sets;
      ex.indirectEffective += effective;
    }
    if (!existing) entry.exercises.set(exercise.id, ex);
  };

  const primaryCredits = resolvePrimaryMuscleCredits(exercise.primary_muscle);
  const primarySet = new Set<string>(primaryCredits.map((c) => c.muscle));
  if (primaryCredits.length > 0) {
    primaryCredits.forEach(({ muscle, weight }) =>
      addCredit(muscle, workingSets * weight, effectiveVolume * weight, true)
    );
  } else {
    addCredit(exercise.primary_muscle.toLowerCase(), workingSets, effectiveVolume, true);
  }

  (exercise.secondary_muscles || []).forEach((secondary) => {
    const standards = resolveMuscleToStandard(secondary);
    if (standards.length === 0) return;
    const creditPerMuscle = SECONDARY_MUSCLE_CREDIT / standards.length;
    standards.forEach((standardMuscle) => {
      if (primarySet.has(standardMuscle)) return;
      addCredit(
        standardMuscle,
        workingSets * creditPerMuscle,
        effectiveVolume * creditPerMuscle,
        false
      );
    });
  });
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
    const effectiveVolume = hasFeedbackColumn
      ? sumEffectiveVolume(
          workingSets.map((s) => rirFromFeedback(s.feedback)),
          exercise.name
        )
      : workingSets.length;
    accumulateExerciseVolume(volumeByMuscle, exercise, workingSets.length, effectiveVolume);
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

/** The 13 coarse muscle groups that are the default ROW in every surface. */
export const COARSE_MUSCLES = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings',
  'glutes', 'calves', 'abs', 'traps', 'forearms', 'adductors',
] as const;
export type CoarseMuscle = (typeof COARSE_MUSCLES)[number];

/**
 * Coarse group → the standard muscles it aggregates. A coarse row's set count
 * is the sum of its children's credited sets; the "fine" children (subdivisions
 * — see FINE_CHILD_MUSCLES) are carried on the row wherever reachable, and the
 * shared list component decides which are VISIBLE (pinned-lagging or expanded).
 */
export const COARSE_CHILDREN: Record<CoarseMuscle, StandardMuscleGroup[]> = {
  chest: ['chest_upper', 'chest_lower'],
  back: ['lats', 'upper_back', 'erectors'],
  shoulders: ['front_delts', 'lateral_delts', 'rear_delts'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes', 'glute_med'],
  calves: ['calves', 'gastrocnemius', 'soleus'],
  abs: ['abs', 'obliques'],
  traps: ['traps', 'upper_traps', 'mid_lower_traps'],
  forearms: ['forearms'],
  adductors: ['adductors'],
};

/** Reverse map: every standard muscle to its coarse display parent. */
export const STANDARD_TO_COARSE: Record<StandardMuscleGroup, CoarseMuscle> = (() => {
  const map = {} as Record<StandardMuscleGroup, CoarseMuscle>;
  for (const coarse of COARSE_MUSCLES) {
    for (const child of COARSE_CHILDREN[coarse]) map[child] = coarse;
  }
  return map;
})();

/**
 * Standard muscles that render as INDENTED child rows under their coarse parent
 * (anatomical subdivisions). The single-muscle coarse groups (biceps, quads, …)
 * have no fine children and never expand.
 */
export const FINE_CHILD_MUSCLES = new Set<StandardMuscleGroup>([
  'chest_upper', 'chest_lower',
  'front_delts', 'lateral_delts', 'rear_delts',
  'lats', 'upper_back', 'erectors',
  'glute_med', 'obliques',
  'upper_traps', 'mid_lower_traps',
  'gastrocnemius', 'soleus',
]);

/**
 * Research-based coarse MEV–MRV bands (Israetel / Schoenfeld), expressed in
 * inclusive direct+indirect set terms so they sit sensibly against the
 * secondary-credit counter. This is the SINGLE shared denominator: a bar is
 * gray/amber below MEV, green across the MEV–MRV zone, red only past MRV — so
 * hitting MEV is never punished with a red bar. Per-user learning may nudge the
 * volume page's band; these are the defaults every glance surface uses (and the
 * baseline the learned table resets to).
 *
 * SEMANTICS (decided in the shoulders-card audit): a coarse band is an
 * INDEPENDENT group-level landmark — it is deliberately NOT the sum of its
 * fine children's bands. Group MEVs assume overlapping stimulus (8 "shoulders"
 * sets can touch every head), while a fine child's band (see fineChildBand) is
 * that subdivision's own research landmark, so Σ(child MEVs) is expected to
 * exceed the group MEV. Two consequences every surface must respect:
 *   1. Labels must distinguish the scopes — groupZoneBandLabel ("group zone
 *      8–22") for coarse rows vs zoneBandLabel ("zone 4–12") for children.
 *   2. A parent may NOT render green while a reachable fine child sits below
 *      its own MEV — the aggregate would be hiding a lagging subdivision. The
 *      row-aware color helpers (rowColorToken and friends) demote such a
 *      parent from success to warning; use them, not the raw zone helpers,
 *      wherever a coarse row is colorized.
 */
export const RESEARCH_VOLUME_BANDS: Record<CoarseMuscle, { mev: number; mrv: number }> = {
  chest: { mev: 8, mrv: 22 },
  back: { mev: 10, mrv: 25 },
  // shoulders is TOTAL-INCLUSIVE (Phase 5b, adopted): the literature's "8–22
  // shoulder sets" counts DIRECT lateral/rear work, with pressing existing
  // but landing under chest — our counter adds ~0.5/press set to this row
  // (typically +4) plus ~1 rear-delt set from pulls. Shifted by that routine
  // inflow so the same training reads the same zone: {8+4, 22+4}. Coheres
  // with the adopted children: Σ child MEVs (2+6+3) ≈ 12. Someone ONLY
  // pressing (11 sets → 5.5 here) still reads below MEV — correct, side/rear
  // delts need their own work.
  shoulders: { mev: 12, mrv: 26 },
  biceps: { mev: 6, mrv: 20 },
  triceps: { mev: 6, mrv: 18 },
  quads: { mev: 8, mrv: 20 },
  hamstrings: { mev: 6, mrv: 16 },
  glutes: { mev: 4, mrv: 16 },
  calves: { mev: 8, mrv: 20 },
  abs: { mev: 6, mrv: 20 },
  traps: { mev: 4, mrv: 16 },
  forearms: { mev: 4, mrv: 14 },
  adductors: { mev: 4, mrv: 12 },
};

/** MEV target for a fine child row (its own subdivision-level threshold). */
export function fineChildMev(muscle: StandardMuscleGroup): number {
  return MEV_TARGETS[muscle];
}

/**
 * MEV–MRV band for a fine child row, from PER-SUBDIVISION research landmarks —
 * NOT a slice of the parent band. The old synthesis (parent MRV ÷ child count)
 * capped front delts at ⌈22/3⌉ = 7 weekly sets, which anyone who both presses
 * (0.5 front-delt credit per bench set) and does direct shoulder work blows
 * past immediately — the bar was structurally red for normal training.
 *
 * Sources, both already in the codebase:
 *   - mev: MEV_TARGETS — the same table the below-MEV warning surface uses, so
 *     a child bar can never read amber while the warning says it's fine (or
 *     vice versa). Where DEFAULT_VOLUME_LANDMARKS disagrees slightly (its
 *     intermediate front_delts MEV is 3 vs MEV_TARGETS' 4), MEV_TARGETS wins
 *     for exactly that consistency reason.
 *   - mrv: DEFAULT_VOLUME_LANDMARKS.intermediate — the per-muscle research
 *     table (types/schema.ts) that volumeTracker already falls back to.
 *     Intermediate tier: these bands are population defaults, matching the
 *     coarse RESEARCH_VOLUME_BANDS above (per-user learning only nudges
 *     coarse bands today).
 *
 * The mev+2 floor guards subdivisions whose research MRV sits at/below the
 * warning-table MEV (can't happen with today's values; kept as an invariant).
 * Fine-child bands are deliberately NOT rescaled by a learned/override coarse
 * band — subdivision landmarks are independent of the group aggregate (see
 * RESEARCH_VOLUME_BANDS semantics note).
 *
 * ─── PHASE 5b — ADOPTED total-inclusive values ─────────────────────────────
 *
 * Zone placement uses the TOTAL (direct + indirect) — never direct-only — so
 * every band is a total-inclusive threshold. Most values in MEV_TARGETS ×
 * DEFAULT_VOLUME_LANDMARKS.intermediate already behave as totals (their
 * indirect share arrives via the same coarse-tagged exercises that feed them
 * directly). The muscles with heavy CROSS-group indirect inflow carry
 * explicit adopted overrides:
 *
 *   front_delts {2, 14}: pressing (0.5/set) routinely supplies 4–6 indirect
 *     sets — near-zero direct work is fine when pressing volume exists, and
 *     the +2 MRV headroom absorbs the indirect load a chest day adds.
 *   rear_delts {3, 20}: rows/pulldowns supply 1–3 indirect sets — a smaller
 *     MEV discount than front delts (pulls credit rear delts less densely),
 *     with the same +2 MRV absorption for routine pulling inflow (revisited
 *     from the direct-reading 18 when the parent band went total-inclusive).
 *   lateral_delts {6, 20}, chest/back children: unchanged — direct-work and
 *     total-inclusive readings coincide (little cross-group inflow).
 *
 * MEVs live in MEV_TARGETS (shared with the warning surface — bar and
 * warning can never disagree); MRV overrides live in
 * FINE_BAND_TOTAL_INCLUSIVE_MRV below.
 *
 * Still flagged direct-only vs our total-inclusive counter (unreviewed):
 * RESEARCH_VOLUME_BANDS biceps {6,20} / triceps {6,18} (pulls/presses add
 * ~0.5/set here) and traps {4,16} (deadlifts/rows/carries feed it
 * indirectly). shoulders was shifted total-inclusive in the same adoption —
 * see its entry. chest/quads/hamstrings/glutes read the same either way.
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Adopted total-inclusive MRV overrides for cross-group-inflow muscles. */
const FINE_BAND_TOTAL_INCLUSIVE_MRV: Partial<Record<StandardMuscleGroup, number>> = {
  front_delts: 14,
  rear_delts: 20,
};

export function fineChildBand(muscle: StandardMuscleGroup): VolumeBand {
  const mev = MEV_TARGETS[muscle];
  const mrv =
    FINE_BAND_TOTAL_INCLUSIVE_MRV[muscle] ??
    DEFAULT_VOLUME_LANDMARKS.intermediate[muscle].mrv;
  return { mev, mrv: Math.max(mev + 2, mrv) };
}

export type VolumeZone = 'below_mev' | 'in_zone' | 'over_mrv';

export interface VolumeBand {
  mev: number;
  mrv: number;
}

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

/** Denominator label: the MEV–MRV band, never n/MEV. e.g. "zone 8–20". */
export function zoneBandLabel(band: VolumeBand): string {
  return `zone ${band.mev}–${band.mrv}`;
}

/**
 * Denominator label for a COARSE row: same band, prefixed "group" so an
 * independent group-level landmark can't be misread as the sum of the child
 * zones shown beneath it (see RESEARCH_VOLUME_BANDS semantics note).
 */
export function groupZoneBandLabel(band: VolumeBand): string {
  return `group zone ${band.mev}–${band.mrv}`;
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
   * Coarse rows only: whether the row can be expanded — it has at least one
   * fine child the user's own exercise tagging can feed. This is what gates
   * the chevron on every surface; a group whose library can't feed any fine
   * member never expands (and so never renders a fine row).
   */
  expandable: boolean;
  exercises: ExerciseVolume[];
  /**
   * ALL fine children of an expandable coarse row (each flagged belowMev and
   * reachable; unreachable ones are expand-only context rows). Visibility
   * (pinned-lagging vs behind-the-chevron) is decided by the shared
   * MuscleGroupList component / withVisibleChildren helper, not here.
   */
  children: VolumeRow[];
}

export interface BuildVolumeRowsOptions {
  /** Per-coarse band overrides (e.g. the reset/learned table). */
  bands?: Partial<Record<CoarseMuscle, VolumeBand>>;
}

/** Per-standard-muscle rollup carried into the row model (full precision). */
interface StandardMuscleRollup {
  sets: number;
  effectiveSets: number;
  directSets: number;
  indirectSets: number;
  directEffectiveSets: number;
  indirectEffectiveSets: number;
  exercises: ExerciseVolume[];
}

const emptyRollup = (): StandardMuscleRollup => ({
  sets: 0,
  effectiveSets: 0,
  directSets: 0,
  indirectSets: 0,
  directEffectiveSets: 0,
  indirectEffectiveSets: 0,
  exercises: [],
});

/** Accumulate credited sets + contributing exercises per standard muscle. */
function setsByStandardMuscle(
  stats: MuscleVolumeStats[]
): Map<StandardMuscleGroup, StandardMuscleRollup> {
  const out = new Map<StandardMuscleGroup, StandardMuscleRollup>();
  const add = (m: StandardMuscleGroup, stat: MuscleVolumeStats, share: number) => {
    const cur = out.get(m) ?? emptyRollup();
    cur.sets += stat.sets * share;
    cur.effectiveSets += stat.effectiveSets * share;
    cur.directSets += stat.directSets * share;
    cur.indirectSets += stat.indirectSets * share;
    cur.directEffectiveSets += stat.directEffectiveSets * share;
    cur.indirectEffectiveSets += stat.indirectEffectiveSets * share;
    for (const ex of stat.exercises) {
      const existing = cur.exercises.find((e) => e.id === ex.id);
      if (existing) {
        existing.sets += ex.sets;
        existing.effective += ex.effective;
        existing.direct += ex.direct;
        existing.indirect += ex.indirect;
        existing.directEffective += ex.directEffective;
        existing.indirectEffective += ex.indirectEffective;
      } else {
        cur.exercises.push({ ...ex });
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
 * reachability set, produce coarse rows (below-MEV first). An expandable row
 * (≥1 reachable fine child) carries ALL its fine children — unreachable ones
 * flagged reachable:false as expand-only context rows. Which children are
 * VISIBLE is a presentation concern — the shared MuscleGroupList component
 * pins reachable lagging children open and puts the rest behind the chevron.
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
    const band = opts.bands?.[coarse] ?? RESEARCH_VOLUME_BANDS[coarse];

    // The chevron rule: a coarse row is expandable when the user's own exercise
    // tagging can feed at least one of its fine children. When no reachability
    // is supplied, don't gate (back-compat: all fine children count).
    const expandable = children.some(
      (c) => FINE_CHILD_MUSCLES.has(c) && (!reachable || reachable.has(c))
    );

    let coarseSetsRaw = 0;
    let coarseEffectiveRaw = 0;
    let coarseDirectRaw = 0;
    let coarseDirectEffectiveRaw = 0;
    // Accumulate the per-exercise breakdown at FULL precision; rounding
    // happens once at emission (emitExerciseList), sum-preserving so the
    // list always reconciles exactly against the row header. Rounding at
    // each merge step here is what produced "Arnold Press 8.1" for a true
    // 8.0 (three ⅓-credits, each merge re-rounded).
    const coarseExercises: ExerciseVolume[] = [];
    const childRows: VolumeRow[] = [];

    for (const child of children) {
      const data = byStd.get(child) ?? emptyRollup();
      coarseSetsRaw += data.sets;
      coarseEffectiveRaw += data.effectiveSets;
      coarseDirectRaw += data.directSets;
      coarseDirectEffectiveRaw += data.directEffectiveSets;
      for (const ex of data.exercises) {
        const existing = coarseExercises.find((e) => e.id === ex.id);
        if (existing) {
          existing.sets += ex.sets;
          existing.effective += ex.effective;
          existing.direct += ex.direct;
          existing.indirect += ex.indirect;
          existing.directEffective += ex.directEffective;
          existing.indirectEffective += ex.indirectEffective;
        } else {
          coarseExercises.push({ ...ex });
        }
      }

      if (!FINE_CHILD_MUSCLES.has(child)) continue;

      const childSets = round1(data.sets);
      const childMev = fineChildMev(child);
      // Children are carried only on EXPANDABLE rows (≥1 reachable fine child —
      // the chevron rule above). An expandable row carries ALL its fine
      // children, including unreachable ones at 0: those are context rows the
      // user can reveal by expanding; they carry reachable:false so the
      // warning/target selectors skip them and the pinned (always-visible)
      // rule — reachable AND below-MEV — never surfaces them uninvited.
      // Which children are VISIBLE (pinned vs behind the chevron) is the
      // shared MuscleGroupList / withVisibleChildren layer's decision.
      if (!expandable) continue;
      const childReachable = !reachable || reachable.has(child);
      const childBelowMev = childSets < childMev;

      // A fine child's band is its OWN subdivision-level research landmark —
      // never a slice of the parent band (see fineChildBand for why).
      const childBand: VolumeBand = fineChildBand(child);
      childRows.push({
        key: `${coarse}:${child}`,
        muscle: child,
        displayName: STANDARD_MUSCLE_DISPLAY_NAMES[child],
        isChild: true,
        parent: coarse,
        sets: childSets,
        effectiveSets: round1(data.effectiveSets),
        directSets: round1(data.directSets),
        directEffectiveSets: round1(data.directEffectiveSets),
        band: childBand,
        zone: volumeZone(childSets, childBand),
        belowMev: childBelowMev,
        laggingChildren: false,
        reachable: childReachable,
        expandable: false,
        exercises: emitExerciseList(data.exercises),
        children: [],
      });
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
      directSets: round1(coarseDirectRaw),
      directEffectiveSets: round1(coarseDirectEffectiveRaw),
      band,
      zone: volumeZone(coarseSets, band),
      belowMev: coarseSets < band.mev,
      // ALL reachable children count, not just visible ones — an explicit
      // collapse must not turn a lagging-subdivision parent green.
      laggingChildren: childRows.some((c) => c.reachable && c.belowMev),
      reachable: true,
      expandable,
      exercises: emitExerciseList(coarseExercises),
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
    if (row.zone === 'below_mev') lowCount++;
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
    if (row.zone === 'below_mev') push(row.muscle, row.sets, row.band, row.exercises);
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

    const primaryCredits = resolvePrimaryMuscleCredits(ex.primary_muscle);
    const primaryStd = new Set(primaryCredits.map((c) => c.muscle));
    for (const { muscle, weight } of primaryCredits) {
      const coarse = STANDARD_TO_COARSE[muscle];
      if (!coarse) continue;
      primary[coarse] += working * weight;
      credited[coarse] += working * weight;
    }
    for (const secondary of ex.secondary_muscles || []) {
      const standards = resolveMuscleToStandard(secondary);
      if (standards.length === 0) continue;
      const per = SECONDARY_MUSCLE_CREDIT / standards.length;
      for (const std of standards) {
        if (primaryStd.has(std)) continue;
        const coarse = STANDARD_TO_COARSE[std];
        if (!coarse) continue;
        credited[coarse] += working * per;
      }
    }
  }

  const ratios: Partial<Record<CoarseMuscle, number>> = {};
  for (const c of COARSE_MUSCLES) {
    if (primary[c] > 0) ratios[c] = Math.round((credited[c] / primary[c]) * 100) / 100;
  }
  return ratios;
}
