/**
 * Muscle Group Migration Utilities
 *
 * Functions to migrate exercise data from the legacy 13-muscle system
 * to the new two-tier system (33 detailed / 20 standard muscles).
 *
 * Use these utilities when:
 * - Loading exercises from database that may have legacy format
 * - Migrating existing exercise data in batch
 * - Converting user-created exercises to the new format
 */

import type { DetailedMuscleGroup, StandardMuscleGroup } from '@/types/schema';
import {
  DETAILED_TO_STANDARD_MAP,
  isDetailedMuscle,
  isStandardMuscle,
  isLegacyMuscle,
} from '@/types/schema';

/**
 * Maps legacy muscle group names to best-guess detailed equivalents.
 * These are approximations - ideally exercises should be re-analyzed by AI.
 */
export const LEGACY_TO_DETAILED_PRIMARY_MAP: Record<string, DetailedMuscleGroup> = {
  'chest': 'chest_lower',        // Default to sternal head, most common
  'back': 'lats',                // Default to lats, most common
  'shoulders': 'lateral_delts',  // Default to lateral delts
  'biceps': 'biceps_short',      // Default to short head
  'triceps': 'triceps_long',     // Default to long head
  'quads': 'quads_vastus',       // Default to vastus group
  'hamstrings': 'hamstrings_biceps_femoris',
  'glutes': 'glute_max',
  'calves': 'calves_gastrocnemius',
  'abs': 'abs_rectus',
  'adductors': 'adductors',
  'forearms': 'forearm_flexors',
  'traps': 'upper_traps',
};

/**
 * For secondary muscles, we want to expand legacy groups to multiple detailed muscles
 * when it makes sense (e.g., "back" as secondary probably means multiple muscles)
 */
export const LEGACY_TO_DETAILED_SECONDARY_MAP: Record<string, DetailedMuscleGroup[]> = {
  'chest': ['chest_upper', 'chest_lower'],
  'back': ['lats', 'upper_back'],
  'shoulders': ['front_delts', 'lateral_delts', 'rear_delts'],
  'biceps': ['biceps_long', 'biceps_short'],
  'triceps': ['triceps_long', 'triceps_lateral', 'triceps_medial'],
  'quads': ['quads_rectus_femoris', 'quads_vastus'],
  'hamstrings': ['hamstrings_biceps_femoris', 'hamstrings_semis'],
  'glutes': ['glute_max'],
  'calves': ['calves_gastrocnemius', 'calves_soleus'],
  'abs': ['abs_rectus'],
  'adductors': ['adductors'],
  'forearms': ['forearm_flexors', 'forearm_extensors'],
  'traps': ['upper_traps', 'lower_traps'],
};

/**
 * Input format for migrating exercise muscle data
 */
export interface LegacyExerciseMuscleData {
  primaryMuscle: string;
  secondaryMuscles: string[];
  stabilizers?: string[];
}

/**
 * Output format after migration
 */
export interface MigratedExerciseMuscleData {
  primaryMuscle: DetailedMuscleGroup;
  secondaryMuscles: DetailedMuscleGroup[];
  stabilizers: DetailedMuscleGroup[];
  /** Indicates the data was migrated and might need review */
  _wasMigrated: boolean;
  /** Original values before migration (for audit purposes) */
  _originalValues?: {
    primaryMuscle: string;
    secondaryMuscles: string[];
    stabilizers?: string[];
  };
}

/**
 * Convert a single muscle string to DetailedMuscleGroup
 * Returns null if the muscle can't be converted
 */
export function toDetailedMuscle(muscle: string): DetailedMuscleGroup | null {
  const lowerMuscle = muscle.toLowerCase().trim();

  // Already a valid detailed muscle
  if (isDetailedMuscle(lowerMuscle)) {
    return lowerMuscle as DetailedMuscleGroup;
  }

  // Already a valid standard muscle (some overlap exists)
  if (isStandardMuscle(lowerMuscle)) {
    // Standard muscles that are also detailed muscles
    const overlappingMuscles: StandardMuscleGroup[] = [
      'chest_upper', 'chest_lower', 'front_delts', 'lateral_delts', 'rear_delts',
      'lats', 'upper_back', 'traps', 'biceps', 'triceps', 'forearms',
      'quads', 'hamstrings', 'glutes', 'glute_med', 'adductors', 'calves',
      'abs', 'obliques', 'erectors',
    ];
    if (overlappingMuscles.includes(lowerMuscle as StandardMuscleGroup)) {
      // Map standard to a detailed equivalent
      const standardToDetailed: Partial<Record<StandardMuscleGroup, DetailedMuscleGroup>> = {
        'biceps': 'biceps_short',
        'triceps': 'triceps_long',
        'forearms': 'forearm_flexors',
        'quads': 'quads_vastus',
        'hamstrings': 'hamstrings_biceps_femoris',
        'glutes': 'glute_max',
        'calves': 'calves_gastrocnemius',
        'abs': 'abs_rectus',
        'obliques': 'abs_obliques',
        'traps': 'upper_traps',
      };
      return standardToDetailed[lowerMuscle as StandardMuscleGroup] ??
        (lowerMuscle as DetailedMuscleGroup);
    }
  }

  // Legacy muscle name
  if (isLegacyMuscle(lowerMuscle)) {
    return LEGACY_TO_DETAILED_PRIMARY_MAP[lowerMuscle] ?? null;
  }

  return null;
}

/**
 * Convert a muscle string to an array of detailed muscles
 * For secondary muscles, legacy groups expand to multiple detailed muscles
 */
export function toDetailedMuscles(muscle: string): DetailedMuscleGroup[] {
  const lowerMuscle = muscle.toLowerCase().trim();

  // Already a valid detailed muscle
  if (isDetailedMuscle(lowerMuscle)) {
    return [lowerMuscle as DetailedMuscleGroup];
  }

  // Legacy muscle - expand to multiple detailed muscles
  if (lowerMuscle in LEGACY_TO_DETAILED_SECONDARY_MAP) {
    return LEGACY_TO_DETAILED_SECONDARY_MAP[lowerMuscle];
  }

  // Try single conversion as fallback
  const single = toDetailedMuscle(muscle);
  return single ? [single] : [];
}

/**
 * Migrate a single exercise's muscle data from legacy to detailed format
 *
 * @param exercise - The exercise data with potentially legacy muscle names
 * @returns Migrated muscle data with detailed muscle groups
 */
export function migrateExerciseMuscles(
  exercise: LegacyExerciseMuscleData
): MigratedExerciseMuscleData {
  const primaryMuscle = toDetailedMuscle(exercise.primaryMuscle) ?? 'chest_lower';

  // For secondary muscles, expand legacy groups
  const secondaryMuscles: DetailedMuscleGroup[] = [];
  for (const secondary of exercise.secondaryMuscles) {
    const mapped = toDetailedMuscles(secondary);
    // Filter out any that match the primary
    secondaryMuscles.push(...mapped.filter(m => m !== primaryMuscle));
  }

  // For stabilizers, use single conversion
  const stabilizers: DetailedMuscleGroup[] = [];
  for (const stabilizer of exercise.stabilizers ?? []) {
    const mapped = toDetailedMuscle(stabilizer);
    if (mapped) {
      stabilizers.push(mapped);
    }
  }

  // Check if any migration actually happened
  const wasMigrated =
    exercise.primaryMuscle.toLowerCase() !== primaryMuscle ||
    exercise.secondaryMuscles.some(m => !isDetailedMuscle(m.toLowerCase()));

  return {
    primaryMuscle,
    secondaryMuscles: [...new Set(secondaryMuscles)], // Dedupe
    stabilizers: [...new Set(stabilizers)],
    _wasMigrated: wasMigrated,
    _originalValues: wasMigrated ? {
      primaryMuscle: exercise.primaryMuscle,
      secondaryMuscles: exercise.secondaryMuscles,
      stabilizers: exercise.stabilizers,
    } : undefined,
  };
}

/**
 * Check if exercise muscle data needs migration
 */
export function needsMigration(exercise: { primaryMuscle: string }): boolean {
  const primary = exercise.primaryMuscle.toLowerCase();
  return !isDetailedMuscle(primary) && isLegacyMuscle(primary);
}

/**
 * Get the standard muscle group for volume tracking from any muscle format
 *
 * @param muscle - Any muscle format (detailed, standard, or legacy)
 * @returns The corresponding StandardMuscleGroup for volume tracking
 */
export function toStandardMuscleForVolume(muscle: string): StandardMuscleGroup | null {
  const lowerMuscle = muscle.toLowerCase().trim();

  // If it's a detailed muscle, use the mapping
  if (isDetailedMuscle(lowerMuscle)) {
    return DETAILED_TO_STANDARD_MAP[lowerMuscle as DetailedMuscleGroup];
  }

  // If it's already a standard muscle
  if (isStandardMuscle(lowerMuscle)) {
    return lowerMuscle as StandardMuscleGroup;
  }

  // If it's a legacy muscle, convert to standard
  if (isLegacyMuscle(lowerMuscle)) {
    // Use the LEGACY_TO_STANDARD_MAP from schema
    const legacyToStandard: Record<string, StandardMuscleGroup> = {
      'chest': 'chest_lower',
      'back': 'lats',
      'shoulders': 'lateral_delts',
      'biceps': 'biceps',
      'triceps': 'triceps',
      'quads': 'quads',
      'hamstrings': 'hamstrings',
      'glutes': 'glutes',
      'calves': 'calves',
      'abs': 'abs',
      'adductors': 'adductors',
      'forearms': 'forearms',
      'traps': 'traps',
    };
    return legacyToStandard[lowerMuscle] ?? null;
  }

  return null;
}

/**
 * Batch migrate multiple exercises
 */
export function batchMigrateExercises(
  exercises: LegacyExerciseMuscleData[]
): MigratedExerciseMuscleData[] {
  return exercises.map(migrateExerciseMuscles);
}

/**
 * Generate a migration report for a batch of exercises
 */
export interface MigrationReport {
  totalExercises: number;
  migratedCount: number;
  alreadyCurrentCount: number;
  failedCount: number;
  migrated: Array<{
    original: LegacyExerciseMuscleData;
    result: MigratedExerciseMuscleData;
  }>;
  failed: Array<{
    exercise: LegacyExerciseMuscleData;
    reason: string;
  }>;
}

export function generateMigrationReport(
  exercises: LegacyExerciseMuscleData[]
): MigrationReport {
  const report: MigrationReport = {
    totalExercises: exercises.length,
    migratedCount: 0,
    alreadyCurrentCount: 0,
    failedCount: 0,
    migrated: [],
    failed: [],
  };

  for (const exercise of exercises) {
    try {
      const result = migrateExerciseMuscles(exercise);

      if (result._wasMigrated) {
        report.migratedCount++;
        report.migrated.push({ original: exercise, result });
      } else {
        report.alreadyCurrentCount++;
      }
    } catch (error) {
      report.failedCount++;
      report.failed.push({
        exercise,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return report;
}
