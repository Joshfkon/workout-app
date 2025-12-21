/**
 * Migration Utility for Set Feedback Data
 *
 * Migrates old set logs that don't have the new feedback structure
 * to include sensible defaults based on existing RPE data.
 */

import type { SetLog, SetFeedback, RepsInTank, FormRating } from '@/types/schema';

/**
 * Migrated set log with metadata
 */
export interface MigratedSetLog extends SetLog {
  _migrated?: boolean;
  _migrationNote?: string;
}

/**
 * Convert old RPE to RIR value
 * RPE 10 = 0 RIR, RPE 9 = 1 RIR, RPE 7-8 = 2-3 RIR, RPE <= 6 = 4+ RIR
 */
export function rpeToRepsInTank(rpe: number): RepsInTank {
  if (rpe >= 10) return 0;
  if (rpe >= 9) return 1;
  if (rpe >= 7) return 2;
  return 4;
}

/**
 * Migrate a single set log to include feedback data
 * @param set - The original set log
 * @returns Migrated set log with feedback
 */
export function migrateSetLog(set: SetLog): MigratedSetLog {
  // If already has feedback, return as-is
  if (set.feedback) {
    return set;
  }

  // Convert RPE to RIR
  const repsInTank = rpeToRepsInTank(set.rpe);

  // Assume clean form for historical data (we don't know otherwise)
  // This is a conservative default that doesn't penalize old PRs
  const form: FormRating = 'clean';

  const feedback: SetFeedback = {
    repsInTank,
    form,
    // No discomfort data available for old sets
    discomfort: undefined,
  };

  return {
    ...set,
    feedback,
    _migrated: true,
    _migrationNote: 'Form assumed clean - recorded before feedback system',
  };
}

/**
 * Migrate an array of set logs
 * @param sets - Array of set logs to migrate
 * @returns Array of migrated set logs
 */
export function migrateSetLogs(sets: SetLog[]): MigratedSetLog[] {
  return sets.map(migrateSetLog);
}

/**
 * Check if a set needs migration
 */
export function needsMigration(set: SetLog): boolean {
  return !set.feedback;
}

/**
 * Get migration statistics for a set of logs
 */
export function getMigrationStats(sets: SetLog[]): {
  total: number;
  needsMigration: number;
  alreadyMigrated: number;
  percentComplete: number;
} {
  const needsMigrationCount = sets.filter(needsMigration).length;
  const alreadyMigrated = sets.length - needsMigrationCount;

  return {
    total: sets.length,
    needsMigration: needsMigrationCount,
    alreadyMigrated,
    percentComplete:
      sets.length > 0 ? Math.round((alreadyMigrated / sets.length) * 100) : 100,
  };
}

/**
 * Create SQL migration for database
 * This can be run to add the feedback column if it doesn't exist
 */
export const SQL_MIGRATION = `
-- Add feedback column to set_logs table if it doesn't exist
ALTER TABLE set_logs
ADD COLUMN IF NOT EXISTS feedback JSONB DEFAULT NULL;

-- Create index for querying by form quality
CREATE INDEX IF NOT EXISTS idx_set_logs_feedback_form
ON set_logs ((feedback->>'form'))
WHERE feedback IS NOT NULL;

-- Create index for querying by discomfort body part
CREATE INDEX IF NOT EXISTS idx_set_logs_feedback_discomfort
ON set_logs ((feedback->'discomfort'->>'bodyPart'))
WHERE feedback->'discomfort' IS NOT NULL;

-- Comment explaining the migration
COMMENT ON COLUMN set_logs.feedback IS
'Structured feedback for this set including RIR, form quality, and optional discomfort. Added in set quality feedback system update.';
`;

/**
 * Batch migration function for processing large datasets
 * @param sets - Sets to migrate
 * @param batchSize - Number of sets to process at once
 * @param onProgress - Callback for progress updates
 */
export async function batchMigrateSets(
  sets: SetLog[],
  batchSize: number = 100,
  onProgress?: (current: number, total: number) => void
): Promise<MigratedSetLog[]> {
  const results: MigratedSetLog[] = [];
  const total = sets.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = sets.slice(i, i + batchSize);
    const migratedBatch = batch.map(migrateSetLog);
    results.push(...migratedBatch);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }

    // Small delay to prevent blocking
    if (i + batchSize < total) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}
