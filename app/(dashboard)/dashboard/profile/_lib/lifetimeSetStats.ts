/**
 * Lifetime working-set totals (count + weight×reps volume) for the profile
 * and feed headers.
 *
 * Both pages used to select every set the user ever logged and reduce it in
 * the browser. PostgREST caps a select at 1000 rows without an error, so the
 * totals froze at ~1000 sets — and the fetch grew with every workout.
 *
 * Fast path: the `get_my_lifetime_set_stats` RPC (one aggregate row,
 * migration 20261112000040). Until that migration is applied — or if the
 * call fails — it falls back to paging through the rows, which is slower but
 * correct past 1000 sets.
 */

export interface LifetimeSetStats {
  totalSets: number;
  totalVolumeKg: number;
}

const PAGE_SIZE = 1000;
// 200k sets — far beyond any real training history; bounds a runaway loop.
const MAX_PAGES = 200;

interface SetRow {
  weight_kg: number | null;
  reps: number | null;
}

// Both the typed and the untyped browser clients are passed in.
type LooseClient = any;

export async function fetchLifetimeSetStats(
  supabase: LooseClient,
  userId: string
): Promise<LifetimeSetStats> {
  try {
    const { data, error } = await supabase.rpc('get_my_lifetime_set_stats');
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && row.total_sets != null) {
      return {
        totalSets: Number(row.total_sets) || 0,
        totalVolumeKg: Number(row.total_volume_kg) || 0,
      };
    }
  } catch {
    /* RPC unavailable — fall through to the paged read */
  }

  let totalSets = 0;
  let totalVolumeKg = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('set_logs')
      .select('weight_kg, reps, exercise_blocks!inner(exercise_id, workout_sessions!inner(user_id))')
      .eq('exercise_blocks.workout_sessions.user_id', userId)
      .eq('is_warmup', false)
      // Stable order so consecutive pages neither repeat nor skip rows.
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    for (const log of data as SetRow[]) {
      totalSets += 1;
      totalVolumeKg += (log.weight_kg ?? 0) * (log.reps ?? 0);
    }
    if (data.length < PAGE_SIZE) break;
  }
  return { totalSets, totalVolumeKg };
}
