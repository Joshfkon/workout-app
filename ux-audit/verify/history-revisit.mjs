/**
 * Verifies Workout History (audit row #2) no longer re-blocks with its
 * full-screen loader on a repeat visit — the first page is cached (React
 * Query, long staleTime + IndexedDB persistence) and seeded on mount.
 *
 * Run (server on :3000): node ux-audit/verify/history-revisit.mjs
 */
import fs from 'node:fs';
import { newHarness, json, assertNoReloadSpinner } from './lib.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const session = {
  id: 's1', planned_date: null, completed_at: '2026-07-08T18:30:00Z', state: 'completed',
  session_rpe: 8, session_notes: null, pump_rating: 4,
  exercise_blocks: [
    {
      id: 'b1', order: 0, exercise_id: 'x1',
      exercises: { id: 'x1', name: 'Barbell Squat', primary_muscle: 'quads' },
      set_logs: [
        { id: 'l1', set_number: 1, weight_kg: 100, reps: 5, rpe: 8, is_warmup: false },
        { id: 'l2', set_number: 2, weight_kg: 100, reps: 5, rpe: 8.5, is_warmup: false },
      ],
    },
  ],
};

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/workout_sessions**', (r) => json(r, [session]));

  const results = await assertNoReloadSpinner(page, {
    url: '/dashboard/history',
    awayHref: '/dashboard/nutrition',
    loadedSelector: 'text=Barbell Squat',
    loadingTestid: 'history-full-loading',
    screenshotPrefix: 'history',
    out: OUT,
  });

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
