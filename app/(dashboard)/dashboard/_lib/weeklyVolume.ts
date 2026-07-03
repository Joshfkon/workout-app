/**
 * Weekly per-muscle volume computation, shared by the dashboard's server
 * initial-data path and the client fast-path (P1-2 / server-render item 6).
 *
 * Extracted verbatim from DashboardClient so the atrophy-risk card's data can
 * be computed on the SERVER and shipped in initialData — the card is the
 * dashboard's LCP element and was previously blocked on a client-side weekly
 * volume fetch. Pure: no React, no Supabase client.
 */

import { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } from '@/services/volumeTracker';
import { resolveMuscleToStandard, STANDARD_MUSCLE_GROUPS, type StandardMuscleGroup } from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';

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
