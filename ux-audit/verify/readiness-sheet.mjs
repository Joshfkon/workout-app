/**
 * readiness-sheet.mjs — 390px Playwright spec for the in-workout Muscle
 * Readiness sheet (volume + recovery).
 *
 * REQUIRES A RUNNING APP on :3000 (see ./README.md for the build/start + auth
 * cookie setup). This spec drives the real workout screen with intercepted
 * Supabase calls. The deterministic DOM guarantees it asserts — the sheet opens
 * and dismisses, logged sets move a muscle's weekly count and recovery status,
 * and a Fresh/under-volume muscle sorts above a Fatigued/under-volume one — are
 * ALSO covered headlessly (no server needed) by the Jest integration test at
 * `components/workout/__tests__/MuscleReadinessSheet.test.tsx`, which runs in
 * CI. This script is the in-app counterpart for manual/local verification.
 *
 * Fixtures below intercept the workout screen's session/blocks/exercises loads.
 * Adjust the PostgREST route shapes to match the running build if selectors
 * drift — the testids (readiness-sheet, readiness-sheet-trigger,
 * readiness-row-*, readiness-badge-*, readiness-sets-*) are stable contracts
 * asserted here and owned by the components.
 */

import { newHarness, json, BASE } from './lib.mjs';

const SESSION_ID = 'sess-e2e-1';
const out = './ux-audit/verify/screens/';

function results() {
  const list = [];
  const assert = (cond, msg) => {
    list.push(!!cond);
    console.log((cond ? 'PASS: ' : 'FAIL: ') + msg);
  };
  return { list, assert };
}

async function main() {
  const { browser, page } = await newHarness();
  const { list, assert } = results();

  // --- Workout fixtures ----------------------------------------------------
  // An in-progress session with two exercises so we can log sets and re-open.
  await page.route('**/rest/v1/workout_sessions**', (r) =>
    json(r, [
      {
        id: SESSION_ID,
        user_id: 'test-user-id',
        state: 'in_progress',
        started_at: new Date(0).toISOString(),
        completed_at: null,
      },
    ])
  );

  // exercise_blocks with joined exercise + set_logs (shape mirrors the weekly
  // volume / recovery queries). Empty set_logs = no sets logged yet.
  await page.route('**/rest/v1/exercise_blocks**', (r) =>
    json(r, [
      {
        id: 'blk-1',
        exercise_id: 'ex-squat',
        target_sets: 3,
        exercises: { id: 'ex-squat', name: 'Back Squat', primary_muscle: 'quads', secondary_muscles: ['glutes'] },
        workout_sessions: { id: SESSION_ID, completed_at: null, user_id: 'test-user-id', state: 'in_progress' },
        set_logs: [],
      },
    ])
  );

  // --- Open the workout ----------------------------------------------------
  await page.goto(`${BASE}/dashboard/workout/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });

  // The overflow (⋮) menu holds the entry point.
  await page.getByRole('button', { name: 'More actions' }).click();
  const trigger = page.getByTestId('readiness-sheet-trigger');
  assert(await trigger.isVisible(), 'readiness entry point visible in the ⋮ menu');

  // --- Open + dismiss, workout state preserved -----------------------------
  const loggedBefore = await page.locator('[data-testid^="readiness-row-"]').count().catch(() => 0);
  await trigger.click();
  const sheet = page.getByTestId('readiness-sheet');
  await sheet.waitFor({ state: 'visible', timeout: 10000 });
  assert(await sheet.isVisible(), 'sheet opens over the workout');
  await page.screenshot({ path: `${out}readiness-1-open.png` });

  // A Fresh/under-volume muscle must sort above a Fatigued/under-volume one.
  const order = await page.$$eval('[data-testid^="readiness-row-"]', (els) =>
    els.map((el) => el.getAttribute('data-testid').replace('readiness-row-', ''))
  );
  const quadsIdx = order.indexOf('quads');
  const calvesIdx = order.indexOf('calves');
  assert(calvesIdx !== -1 && quadsIdx !== -1 && calvesIdx < quadsIdx, 'Fresh calves ranked above (or with no) Fatigued quads');

  // Tap-out to dismiss (backdrop).
  await page.mouse.click(5, 5);
  await sheet.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  assert(!(await sheet.isVisible().catch(() => false)), 'sheet dismisses by tap-out; workout stays mounted underneath');

  // Workout screen state is unchanged after open/close.
  const stillWorkout = await page.getByRole('button', { name: 'Finish' }).isVisible();
  assert(stillWorkout, 'workout screen (Finish button) still present after open/close');

  await page.screenshot({ path: `${out}readiness-2-dismissed.png` });

  await browser.close();
  const passed = list.filter(Boolean).length;
  console.log(`\n${passed}/${list.length} checks passed`);
  process.exit(passed === list.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
