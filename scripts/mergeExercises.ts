/**
 * Merge duplicate exercises onto a survivor (reversible; soft-delete only).
 *
 * Thin CLI over the atomic `merge_exercises(survivor, duplicates[], dry_run)`
 * Postgres function (migration 20260711000002). The function does all the work
 * in one transaction: it repoints set logs (via exercise_blocks), performance
 * snapshots, plateau alerts, preferences/settings, location availability, usage
 * history, leaderboard entries, AMRAP calibrations, template exercises, and
 * mesocycle overrides from the duplicates onto the survivor (survivor's values
 * win on conflicts), then soft-deletes the duplicates (deleted_at + merged_into
 * set — nothing is hard-deleted).
 *
 * DRY-RUN BY DEFAULT. Run one group at a time — this never batches groups.
 *
 * Usage:
 *   # preview (no changes):
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *     npx tsx scripts/mergeExercises.ts --survivor <id> --duplicates <id,id> --dry-run
 *
 *   # execute:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *     npx tsx scripts/mergeExercises.ts --survivor <id> --duplicates <id,id> --execute
 */

export interface MergeResult {
  survivor: string;
  survivorName: string;
  dryRun: boolean;
  active: string[];
  skipped: string[];
  counts: Record<string, number>;
  /** Per-user duplicate rows dropped because the survivor already has one. */
  dropped?: Record<string, number>;
  note: string;
}

async function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.'
    );
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Reusable programmatic entry point. Validates arguments client-side, then
 * delegates to the transactional SQL function.
 */
export async function mergeExercises(
  survivorId: string,
  duplicateIds: string[],
  opts: { dryRun?: boolean; supabase?: any } = {}
): Promise<MergeResult> {
  const dryRun = opts.dryRun ?? true;

  // --- Client-side guardrails (the SQL function re-checks these too) ------
  if (!survivorId) throw new Error('survivorId is required');
  const dups = Array.from(new Set(duplicateIds.filter(Boolean)));
  if (dups.length === 0) throw new Error('at least one duplicateId is required');
  if (dups.includes(survivorId)) {
    throw new Error(`survivor ${survivorId} must not be among the duplicates`);
  }

  const supabase = opts.supabase ?? (await getClient());
  const { data, error } = await supabase.rpc('merge_exercises', {
    p_survivor: survivorId,
    p_duplicates: dups,
    p_dry_run: dryRun,
  });
  if (error) throw new Error(`merge_exercises failed: ${error.message}`);
  return data as MergeResult;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  let execute = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') execute = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      args[key] = val;
      i++;
    }
  }
  return { args, execute, dryRun };
}

async function main() {
  const { args, execute, dryRun } = parseArgs(process.argv.slice(2));
  const survivor = args.survivor;
  const duplicates = (args.duplicates ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!survivor || duplicates.length === 0) {
    console.error(
      'Usage: mergeExercises.ts --survivor <id> --duplicates <id,id,...> [--dry-run | --execute]'
    );
    process.exit(1);
  }

  // Safety: require an explicit --execute to write. Default and --dry-run both
  // preview only.
  const isDryRun = !execute || dryRun;

  console.log(
    `${isDryRun ? '🔍 DRY RUN' : '⚠️  EXECUTING MERGE'} — survivor ${survivor}, duplicates: ${duplicates.join(
      ', '
    )}`
  );

  const result = await mergeExercises(survivor, duplicates, { dryRun: isDryRun });

  console.log('');
  console.log(`Survivor : ${result.survivorName} (${result.survivor})`);
  console.log(`Active   : ${result.active.join(', ') || '(none)'}`);
  if (result.skipped?.length) {
    console.log(`Skipped  : ${result.skipped.join(', ')} (already merged/soft-deleted)`);
  }
  console.log('References that would move (survivor wins on conflicts):');
  for (const [table, n] of Object.entries(result.counts)) {
    console.log(`  ${table.padEnd(34)} ${n}`);
  }
  const dropped = result.dropped ?? {};
  const droppedEntries = Object.entries(dropped).filter(([, n]) => n > 0);
  if (droppedEntries.length > 0) {
    console.log('\nDuplicate per-user settings DROPPED (survivor already has one):');
    for (const [table, n] of droppedEntries) {
      console.log(`  ${table.padEnd(34)} ${n}`);
    }
  }
  console.log('');
  console.log(result.note);

  if (isDryRun) {
    console.log('\nRe-run with --execute to apply.');
  }
}

// Only run the CLI when invoked directly (not when imported).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
