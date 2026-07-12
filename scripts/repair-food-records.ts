/**
 * One-time food-record sanity + repair pass (REPORT by default; opt-in repair).
 *
 * A save bug once let an entered amount leak into a custom_foods record's
 * serving size and the computed totals into its per-serving nutrition (e.g. a
 * 140 cal / 85 g fries record rewritten to 26,640 cal per "180 g serving").
 * Because barcode re-scans read custom_foods back (see BarcodeScanner
 * checkCustomFoods), a corrupted record keeps returning bad values even after
 * the log entry is deleted. This script finds implausible records and, for
 * barcode-sourced ones, restores per-serving nutrition from Open Food Facts.
 * Everything else is surfaced for manual review.
 *
 * It NEVER deletes a user's food and NEVER rewrites a record it can't restore
 * from source. Without --apply it only prints a report.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *     npx ts-node --transpile-only scripts/repair-food-records.ts [--apply]
 */

import { checkFoodRecordSanity } from '../services/foodRecordSanity';
import { lookupBarcode } from '../services/openFoodFactsService';

type Row = Record<string, any>;

const APPLY = process.argv.includes('--apply');

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

async function fetchAll(supabase: any, table: string, columns: string): Promise<Row[]> {
  const pageSize = 1000;
  let from = 0;
  const out: Row[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  const supabase = await getClient();
  const rows = await fetchAll(
    supabase,
    'custom_foods',
    'id, user_id, food_name, serving_size, calories, protein, carbs, fat, barcode'
  );

  const flagged = rows
    .map((r) => ({ row: r, sanity: checkFoodRecordSanity(r) }))
    .filter((x) => x.sanity.implausible);

  console.log(`Scanned ${rows.length} custom_foods; ${flagged.length} look implausible.\n`);

  let restored = 0;
  let manual = 0;

  for (const { row, sanity } of flagged) {
    console.log(`• ${row.food_name} (${row.id})`);
    console.log(`    reasons: ${sanity.reasons.join('; ')}`);
    console.log(
      `    current: ${row.calories} cal · P ${row.protein} · C ${row.carbs} · F ${row.fat} · "${row.serving_size}"`
    );

    if (!row.barcode) {
      manual++;
      console.log('    → no barcode; MANUAL REVIEW\n');
      continue;
    }

    const result = await lookupBarcode(row.barcode).catch(() => null);
    const product = result?.found ? result.product : null;
    if (!product) {
      manual++;
      console.log('    → barcode not re-fetchable; MANUAL REVIEW\n');
      continue;
    }

    const fixed = {
      serving_size: product.servingSize,
      calories: Math.round(product.calories),
      protein: Math.round(product.protein * 10) / 10,
      carbs: Math.round(product.carbs * 10) / 10,
      fat: Math.round(product.fat * 10) / 10,
    };
    console.log(
      `    → source: ${fixed.calories} cal · P ${fixed.protein} · C ${fixed.carbs} · F ${fixed.fat} · "${fixed.serving_size}"`
    );

    if (APPLY) {
      const { error } = await supabase.from('custom_foods').update(fixed).eq('id', row.id);
      if (error) {
        console.log(`    ✗ update failed: ${error.message}\n`);
        continue;
      }
      restored++;
      console.log('    ✓ restored from source\n');
    } else {
      restored++;
      console.log('    (dry run — pass --apply to write)\n');
    }
  }

  console.log(
    `Done. ${restored} restorable from source, ${manual} need manual review.` +
      (APPLY ? '' : '  Re-run with --apply to write the restorable fixes.')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
