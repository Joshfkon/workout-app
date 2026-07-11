/**
 * Bodyweight-type audit (live database).
 *
 * Lists every bodyweight exercise still missing a `bodyweight_type` — the
 * ambiguous customs the backfill migration intentionally leaves for manual
 * review — and reports the two "back extension" entries with their attached
 * set-history counts.
 *
 * This is the runnable form of the SQL in docs/BODYWEIGHT_TYPE_AUDIT.md.
 * It reads all users' rows (service-role key), so run it somewhere you already
 * hold that secret — never paste the key into a chat.
 *
 * Usage (Node >= 20):
 *   node --env-file=.env.local scripts/audit-bodyweight-types.mjs
 * or with the vars already exported:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/audit-bodyweight-types.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error(
    '\nMissing credentials. Set NEXT_PUBLIC_SUPABASE_URL and ' +
      'SUPABASE_SERVICE_ROLE_KEY (e.g. via `node --env-file=.env.local ...`).\n'
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

const bail = (label, error) => {
  console.error(`\n✗ ${label}: ${error.message}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// 1. Unclassified bodyweight exercises (mostly customs left NULL on purpose).
// ---------------------------------------------------------------------------
const { data: unclassified, error: e1 } = await supabase
  .from('exercises')
  .select(
    'id, name, primary_muscle, equipment, equipment_required, is_custom, created_by, hypertrophy_tier'
  )
  .eq('is_bodyweight', true)
  .is('bodyweight_type', null)
  .order('is_custom', { ascending: false })
  .order('name', { ascending: true });

if (e1) bail('Unclassified query failed', e1);

console.log('\n=== Bodyweight exercises still missing a bodyweight_type ===');
if (!unclassified.length) {
  console.log('None — every bodyweight exercise is classified. ✅');
} else {
  console.log(
    `${unclassified.length} row(s). Classify per docs/BODYWEIGHT_TYPE_AUDIT.md ` +
      '(pull/chin/dip → both; back-ext/push-up/leg-raise → weighted_possible; ' +
      'assisted machine → assisted_possible; hold → pure):\n'
  );
  console.table(
    unclassified.map((e) => ({
      id: e.id,
      name: e.name,
      muscle: e.primary_muscle,
      tier: e.hypertrophy_tier,
      custom: e.is_custom ? 'yes' : 'no',
      equipment: Array.isArray(e.equipment_required)
        ? e.equipment_required.join(',')
        : e.equipment,
    }))
  );
}

// ---------------------------------------------------------------------------
// 2. The two "back extension" entries + logged-set counts.
// ---------------------------------------------------------------------------
const { data: backExt, error: e2 } = await supabase
  .from('exercises')
  .select(
    'id, name, primary_muscle, hypertrophy_tier, is_custom, created_by, bodyweight_type'
  )
  .ilike('name', 'back extension%')
  .order('is_custom', { ascending: true });

if (e2) bail('Back-extension query failed', e2);

console.log('\n=== "Back extension" entries ===');
if (!backExt.length) {
  console.log('No exercise named like "back extension%" found.');
} else {
  const rows = [];
  for (const ex of backExt) {
    // set_logs → exercise_blocks(exercise_id). Count logged + BW-tagged sets.
    const { data: blocks, error: eb } = await supabase
      .from('exercise_blocks')
      .select('id')
      .eq('exercise_id', ex.id);
    if (eb) bail(`exercise_blocks for ${ex.name}`, eb);

    const blockIds = (blocks || []).map((b) => b.id);
    let logged = 0;
    let bwTagged = 0;
    if (blockIds.length) {
      const { count: total, error: ec } = await supabase
        .from('set_logs')
        .select('id', { count: 'exact', head: true })
        .in('exercise_block_id', blockIds);
      if (ec) bail(`set_logs count for ${ex.name}`, ec);
      logged = total ?? 0;

      const { count: bw, error: ec2 } = await supabase
        .from('set_logs')
        .select('id', { count: 'exact', head: true })
        .in('exercise_block_id', blockIds)
        .not('bodyweight_data', 'is', null);
      if (ec2) bail(`bw set_logs count for ${ex.name}`, ec2);
      bwTagged = bw ?? 0;
    }

    rows.push({
      id: ex.id,
      name: ex.name,
      muscle: ex.primary_muscle,
      tier: ex.hypertrophy_tier,
      type: ex.bodyweight_type ?? '(null)',
      custom: ex.is_custom ? 'yes' : 'no',
      logged_sets: logged,
      bw_sets: bwTagged,
    });
  }
  console.table(rows);
  console.log(
    '\nMerge is your call (see docs/BODYWEIGHT_TYPE_AUDIT.md §3). Keep the entry ' +
      'with the history + correct muscle/tier; repoint the other’s exercise_blocks, ' +
      'then delete it. Do NOT run the repoint until you’ve confirmed these counts.'
  );
}

console.log('');
