/**
 * Failure messages for mesocycle creation.
 *
 * Supabase returns PostgrestErrors as plain objects, not Error instances, so
 * the common `err instanceof Error ? err.message : 'Failed to …'` pattern
 * throws away everything the database said and leaves the user with a generic
 * string. These helpers keep the cause, and translate the one failure we can
 * explain better than Postgres can.
 */

import { describeSupabaseError, isMissingColumnError } from '@/lib/errors';

/** Columns added by the interval-schedule migration (20260803000001). */
export const SCHEDULE_COLUMNS = ['schedule_mode', 'training_interval_days'];

/**
 * Turn a mesocycle insert failure into something the user can act on.
 */
export function describeMesocycleInsertFailure(insertError: unknown): string {
  // A database that predates the interval-schedule migration rejects the whole
  // insert over two columns. Retrying without them wouldn't help: every surface
  // that reads a plan (dashboard, train, log, overview) selects the same
  // columns, so it would only move the failure. Name the migration instead of
  // leaving a schema-cache error to decipher.
  if (isMissingColumnError(insertError, SCHEDULE_COLUMNS)) {
    return (
      'Your database is missing the training-schedule columns from migration ' +
      '20260803000001_mesocycle_interval_schedule. Run `npx supabase db push` (or reload the ' +
      'PostgREST schema cache if you already have), then try again. ' +
      `Details: ${describeSupabaseError(insertError)}`
    );
  }

  return describeSupabaseError(insertError, 'Failed to create mesocycle');
}
