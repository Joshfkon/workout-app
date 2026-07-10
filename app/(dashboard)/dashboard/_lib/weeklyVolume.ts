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
  isStandardMuscle,
  legacyToStandardMuscles,
  resolveMuscleToStandard,
  STANDARD_MUSCLE_GROUPS,
  type StandardMuscleGroup,
} from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
import { rollingWindowStartISO } from '@/lib/date/localDay';

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

// MEV per standard muscle (20 muscles) — the threshold for the 'low' status.
export const MEV_TARGETS: Record<StandardMuscleGroup, number> = {
  chest_upper: 4, chest_lower: 4,
  front_delts: 4, lateral_delts: 6, rear_delts: 4,
  lats: 6, upper_back: 4, traps: 4,
  biceps: 4, triceps: 4, forearms: 4,
  quads: 6, hamstrings: 4, glutes: 4, glute_med: 2, adductors: 4, calves: 6,
  abs: 6, obliques: 4, erectors: 4,
};

export const ALL_MUSCLE_GROUPS: readonly StandardMuscleGroup[] = STANDARD_MUSCLE_GROUPS;

export function getMevForMuscle(muscle: string): number {
  const standardMuscle = toStandardMuscleForVolume(muscle);
  if (standardMuscle && standardMuscle in MEV_TARGETS) {
    return MEV_TARGETS[standardMuscle as StandardMuscleGroup];
  }
  return 4;
}

export interface ExerciseVolume {
  id: string;
  name: string;
  sets: number;
}

export interface MuscleVolumeStats {
  muscle: string;
  sets: number;
  target: number;
  status: 'low' | 'optimal' | 'high';
  exercises: ExerciseVolume[];
}

export type VolumeAccumulator = Record<
  string,
  { sets: number; exercises: Map<string, { id: string; name: string; sets: number }> }
>;

/** Credit one exercise block's working sets to the accumulator (weighted
 *  primary split + 0.5x secondary credit). */
export function accumulateExerciseVolume(
  volumeByMuscle: VolumeAccumulator,
  exercise: { id: string; name: string; primary_muscle?: string | null; secondary_muscles?: string[] | null },
  workingSets: number
): void {
  if (!exercise.primary_muscle || workingSets === 0) return;

  const addCredit = (muscle: string, sets: number) => {
    if (!volumeByMuscle[muscle]) {
      volumeByMuscle[muscle] = { sets: 0, exercises: new Map() };
    }
    volumeByMuscle[muscle].sets += sets;
    const existing = volumeByMuscle[muscle].exercises.get(exercise.id);
    if (existing) {
      existing.sets += sets;
    } else {
      volumeByMuscle[muscle].exercises.set(exercise.id, { id: exercise.id, name: exercise.name, sets });
    }
  };

  const primaryCredits = resolvePrimaryMuscleCredits(exercise.primary_muscle);
  const primarySet = new Set<string>(primaryCredits.map((c) => c.muscle));
  if (primaryCredits.length > 0) {
    primaryCredits.forEach(({ muscle, weight }) => addCredit(muscle, workingSets * weight));
  } else {
    addCredit(exercise.primary_muscle.toLowerCase(), workingSets);
  }

  (exercise.secondary_muscles || []).forEach((secondary) => {
    const standards = resolveMuscleToStandard(secondary);
    if (standards.length === 0) return;
    const creditPerMuscle = SECONDARY_MUSCLE_CREDIT / standards.length;
    standards.forEach((standardMuscle) => {
      if (primarySet.has(standardMuscle)) return;
      addCredit(standardMuscle, workingSets * creditPerMuscle);
    });
  });
}

export function volumeAccumulatorToStats(volumeByMuscle: VolumeAccumulator): MuscleVolumeStats[] {
  return Object.entries(volumeByMuscle)
    .map(([muscle, data]) => {
      const sets = Math.round(data.sets);
      const target = getMevForMuscle(muscle);
      const status: 'low' | 'optimal' | 'high' = sets < target ? 'low' : sets > target * 1.5 ? 'high' : 'optimal';
      const exercises = Array.from(data.exercises.values())
        .map((ex) => ({ ...ex, sets: Math.round(ex.sets * 10) / 10 }))
        .filter((ex) => ex.sets > 0);
      return { muscle, sets, target, status, exercises };
    })
    .filter((stat) => stat.sets > 0)
    .sort((a, b) => b.sets - a.sets);
}

/** Block row shape from the weekly-volume query (both paths use this select). */
export interface WeeklyVolumeBlockRow {
  exercises: { id: string; name: string; primary_muscle?: string | null; secondary_muscles?: string[] | null } | null;
  set_logs: { id: string; is_warmup: boolean | null }[] | null;
}

/** Full pipeline: rows -> per-muscle weekly stats. */
export function computeWeeklyMuscleVolume(blocks: WeeklyVolumeBlockRow[]): MuscleVolumeStats[] {
  const volumeByMuscle: VolumeAccumulator = {};
  for (const block of blocks) {
    const exercise = block.exercises;
    if (!exercise) continue;
    const workingSets = (block.set_logs || []).filter((s) => !s.is_warmup).length;
    accumulateExerciseVolume(volumeByMuscle, exercise, workingSets);
  }
  return volumeAccumulatorToStats(volumeByMuscle);
}

/** One row of the weekly MEV breakdown (trained stats + untrained muscles). */
export interface MuscleMevEntry {
  /** Muscle key as reported by the stats (may be legacy) or a standard id. */
  muscle: string;
  sets: number;
  mev: number;
  belowMev: boolean;
}

/**
 * Weekly volume rolled up against MEV — the single source for BOTH the home
 * "Weekly volume" glance tile (totalSets / totalTarget / lowCount) and the
 * volume page's "this week vs MEV" breakdown (entries), so the number the
 * user taps is the number they land on.
 */
export interface WeeklyMevSummary {
  totalSets: number;
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
export function computeWeeklyMevSummary(muscleVolume: MuscleVolumeStats[]): WeeklyMevSummary | null {
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
  const untrained = ALL_MUSCLE_GROUPS.filter((m) => !trainedMuscles.has(m));

  const totalSets = muscleVolume.reduce((s, mv) => s + mv.sets, 0);
  const totalTarget =
    muscleVolume.reduce((s, mv) => s + mv.target, 0) +
    untrained.reduce((s, m) => s + getMevForMuscle(m), 0);
  const lowCount = muscleVolume.filter((mv) => mv.status === 'low').length + untrained.length;

  const entries: MuscleMevEntry[] = [
    ...muscleVolume.map((mv) => ({
      muscle: mv.muscle,
      sets: mv.sets,
      mev: getMevForMuscle(mv.muscle),
      belowMev: mv.status === 'low',
    })),
    ...untrained.map((m) => ({
      muscle: m as string,
      sets: 0,
      mev: getMevForMuscle(m),
      belowMev: true,
    })),
  ].sort((a, b) => Number(b.belowMev) - Number(a.belowMev) || b.sets - a.sets);

  return { totalSets, totalTarget, lowCount, entries };
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
      };
    })
    .filter((d): d is MuscleVolumeData => d !== null);
}
