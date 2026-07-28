/**
 * Graceful degradation for queries that select recently-migrated columns.
 *
 * App deploys and database migrations are never atomic: code that selects a
 * column shipped in the same PR as its migration will hit production before
 * `supabase db push` runs (and again on any rollback). PostgREST fails the
 * ENTIRE select when any requested column is unknown (Postgres 42703), so a
 * single new optional column silently blanks every surface whose query
 * mentions it — the exercise_blocks.equipment_changed rollout broke Lift
 * Trends, the home Lifts tile, Train-page progression, workout-page history,
 * and the history drill-in at once, all rendering as "no data".
 *
 * Wrap such queries in selectWithOptionalColumn: it runs the full select,
 * and if (and only if) the failure is that specific column missing, reruns
 * the caller-provided fallback without it. Consumers already treat the
 * column as optional (`block.equipment_changed` truthiness), so degrading to
 * "markers absent" is correct until the migration lands.
 */

export interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Postgres "undefined_column" — the only failure the fallback may absorb. */
const UNDEFINED_COLUMN = '42703';

/**
 * True when the error is Postgres 42703 for this specific column. Any other
 * error (RLS, network, a DIFFERENT missing column) must surface normally.
 */
export function isMissingColumnError(
  error: PostgrestErrorLike | null | undefined,
  column: string
): boolean {
  if (!error) return false;
  return error.code === UNDEFINED_COLUMN && (error.message ?? '').includes(column);
}

export interface OptionalColumnResult<T> {
  data: T | null;
  error: PostgrestErrorLike | null;
  /** True when the fallback ran because the column doesn't exist yet. */
  columnMissing: boolean;
}

/**
 * Run a select that includes `column`; if it fails specifically because the
 * column doesn't exist in the connected database, rerun without it.
 *
 * `run(includeColumn)` must build a fresh query each call — PostgREST
 * builders are thenables that can't be re-awaited after failure.
 */
export async function selectWithOptionalColumn<T>(
  column: string,
  run: (includeColumn: boolean) => PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>
): Promise<OptionalColumnResult<T>> {
  const first = await run(true);
  if (!isMissingColumnError(first.error, column)) {
    return { data: first.data, error: first.error, columnMissing: false };
  }
  console.warn(
    `[columnFallback] column "${column}" missing in database (migration not applied yet?) — ` +
      'retrying query without it'
  );
  const second = await run(false);
  return { data: second.data, error: second.error, columnMissing: true };
}
