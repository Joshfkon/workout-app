/**
 * Verifies the Exercises catalog (audit row #4) no longer re-shows its
 * loading spinner on a repeat visit — the catalog is cached (React Query,
 * long staleTime + IndexedDB persistence).
 *
 * Run (server on :3000): node ux-audit/verify/exercises-revisit.mjs
 */
import fs from 'node:fs';
import { newHarness, json, assertNoReloadSpinner } from './lib.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const exercises = [
  { id: 'e1', name: 'Barbell Bench Press', primary_muscle: 'chest', secondary_muscles: ['triceps'], mechanic: 'compound', form_cues: [], common_mistakes: [], equipment_required: 'barbell', equipment: 'barbell', movement_pattern: 'horizontal_press', is_bodyweight: false, bodyweight_type: null, assistance_type: null, is_custom: false, hypertrophy_tier: 'S', stretch_under_load: 4, resistance_profile: 4, progression_ease: 5, demo_gif_url: null, demo_thumbnail_url: null, youtube_video_id: null },
  { id: 'e2', name: 'Romanian Deadlift', primary_muscle: 'hamstrings', secondary_muscles: ['glutes'], mechanic: 'compound', form_cues: [], common_mistakes: [], equipment_required: 'barbell', equipment: 'barbell', movement_pattern: 'hip_hinge', is_bodyweight: false, bodyweight_type: null, assistance_type: null, is_custom: false, hypertrophy_tier: 'S', stretch_under_load: 5, resistance_profile: 3, progression_ease: 4, demo_gif_url: null, demo_thumbnail_url: null, youtube_video_id: null },
];

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/exercises**', (r) => json(r, exercises));

  const results = await assertNoReloadSpinner(page, {
    url: '/dashboard/exercises',
    awayHref: '/dashboard/nutrition',
    loadedSelector: 'text=Barbell Bench Press',
    loadingTestid: 'exercises-loading',
    screenshotPrefix: 'exercises',
    out: OUT,
  });

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
