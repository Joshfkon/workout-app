/**
 * readiness-checkin.mjs — 390×844 Playwright spec for the compacted
 * Pre-Workout Check-In modal (ReadinessCheckIn) and its dismissal affordances.
 *
 * REQUIRES A RUNNING APP on :3000 (see ./README.md for the build/start + auth
 * cookie setup). Drives the real workout screen with intercepted Supabase
 * calls and asserts:
 *   (a) the modal opens with a visible X close button;
 *   (b) scrim tap and X both dismiss it WITHOUT submitting (no PATCH with
 *       pre_workout_check_in fires — dismissal is a cancel);
 *   (c) total modal content height (header + body scrollHeight + footer)
 *       ≤ ~1.3× the 844px viewport;
 *   (d) the sticky footer actions stay fully visible at every scroll position;
 *   (e) the controls still function: sleep slider, quality/stress segments,
 *       soreness chips, bodyweight input.
 *
 * Testids asserted here (readiness-checkin, readiness-checkin-close,
 * readiness-checkin-body, readiness-checkin-footer) are owned by
 * components/workout/ReadinessCheckIn.tsx.
 */

import { newHarness, json, BASE } from './lib.mjs';

const SESSION_ID = 'sess-e2e-1';
const out = './ux-audit/verify/screens/';
const VIEWPORT_H = 844;

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

  // Record any check-in submission writes — dismissal must never produce one.
  const checkInWrites = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/rest/v1/workout_sessions')) {
      checkInWrites.push(req.postData() || '');
    }
  });

  // --- Workout fixtures ----------------------------------------------------
  // The same workout_sessions endpoint serves the in-progress session load
  // (a .single() query — PostgREST returns a bare object when the Accept
  // header asks for vnd.pgrst.object), the "recent completed sessions" lookup
  // that powers the soreness chips (state=eq.completed filter), the completed
  // count (HEAD), and the check-in PATCH.
  await page.route('**/rest/v1/workout_sessions**', (r) => {
    const req = r.request();
    if (req.method() === 'PATCH' || req.method() === 'HEAD') return json(r, []);
    if (req.url().includes('state=eq.completed')) {
      return json(r, [
        {
          id: 'sess-prev-1',
          completed_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
          exercise_blocks: [{ exercises: { primary_muscle: 'quads' } }],
        },
      ]);
    }
    const session = {
      id: SESSION_ID,
      user_id: 'test-user-id',
      state: 'in_progress',
      started_at: new Date(0).toISOString(),
      completed_at: null,
    };
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    return json(r, wantsObject ? session : [session]);
  });

  // Serve the block fixture only to THIS session's block load; the page's
  // various history queries against exercise_blocks (frequent exercises,
  // volume, calibration) expect joined workout_sessions rows — give them [].
  await page.route('**/rest/v1/exercise_blocks**', (r) => {
    if (!r.request().url().includes(`workout_session_id=eq.${SESSION_ID}`)) return json(r, []);
    return json(r, [
      {
        id: 'blk-1',
        workout_session_id: SESSION_ID,
        exercise_id: 'ex-squat',
        order: 0,
        superset_group_id: null,
        superset_order: null,
        target_sets: 3,
        target_rep_range: [8, 12],
        target_rir: 2,
        target_weight_kg: 100,
        target_rest_seconds: 120,
        progression_type: null,
        suggestion_reason: '',
        warmup_protocol: null,
        skipped_at: null,
        exercises: { id: 'ex-squat', name: 'Back Squat', primary_muscle: 'quads', secondary_muscles: ['glutes'] },
      },
    ]);
  });

  // Nutrition fixtures so the compact one-line macros summary renders.
  await page.route('**/rest/v1/food_log**', (r) =>
    json(r, [{ calories: 80, protein: 12, carbs: 9, fat: 0 }])
  );
  await page.route('**/rest/v1/nutrition_targets**', (r) =>
    json(r, { calories: 2800, protein: 180 })
  );

  // --- Open the workout + the check-in modal --------------------------------
  await page.goto(`${BASE}/dashboard/workout/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Readiness', exact: true }).click();

  const modal = page.getByTestId('readiness-checkin');
  await modal.waitFor({ state: 'visible', timeout: 10000 });

  // (a) X visible on open
  const closeBtn = page.getByTestId('readiness-checkin-close');
  assert(await closeBtn.isVisible(), '(a) modal opens with X close button visible');
  await page.screenshot({ path: `${out}readiness-checkin-1-open.png` });

  // (c) total content height ≤ ~1.3× viewport
  const heights = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="readiness-checkin-body"]');
    const card = document.querySelector('[data-testid="readiness-checkin"]');
    const footer = document.querySelector('[data-testid="readiness-checkin-footer"]');
    const header = card.firstElementChild;
    return {
      total: header.offsetHeight + body.scrollHeight + footer.offsetHeight,
      bodyScroll: body.scrollHeight,
      bodyClient: body.clientHeight,
    };
  });
  assert(
    heights.total <= 1.3 * VIEWPORT_H,
    `(c) modal content height ${heights.total}px ≤ 1.3× viewport (${Math.round(1.3 * VIEWPORT_H)}px)`
  );

  // (d) sticky footer fully visible at top, middle, and bottom scroll
  const footer = page.getByTestId('readiness-checkin-footer');
  let footerAlwaysVisible = true;
  for (const frac of [0, 0.5, 1]) {
    await page.evaluate((f) => {
      const body = document.querySelector('[data-testid="readiness-checkin-body"]');
      body.scrollTop = f * (body.scrollHeight - body.clientHeight);
    }, frac);
    await page.waitForTimeout(100);
    const box = await footer.boundingBox();
    const startBtnVisible = await page.getByRole('button', { name: 'Start Workout' }).isVisible();
    if (!box || box.y < 0 || box.y + box.height > VIEWPORT_H || !startBtnVisible) {
      footerAlwaysVisible = false;
    }
  }
  assert(footerAlwaysVisible, '(d) sticky footer (Start Workout / Skip) visible at every scroll position');
  await page.screenshot({ path: `${out}readiness-checkin-2-scrolled.png` });
  await page.evaluate(() => {
    document.querySelector('[data-testid="readiness-checkin-body"]').scrollTop = 0;
  });

  // (e) controls still function
  // Slider: keyboard-step it and watch the live readout change.
  const slider = modal.locator('input[type="range"]');
  const readoutBefore = await modal.locator('text=/^\\d+(\\.\\d+)?h$/').first().textContent();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  const readoutAfter = await modal.locator('text=/^\\d+(\\.\\d+)?h$/').first().textContent();
  assert(readoutBefore !== readoutAfter, `(e) sleep slider works (${readoutBefore} → ${readoutAfter})`);

  // Sleep Quality segment (first 1–5 row): 4 → "Good"
  await modal.getByRole('button', { name: '4', exact: true }).first().click();
  assert(await modal.locator('span:text-is("Good")').first().isVisible(), '(e) Sleep Quality segment selects (4 → Good)');

  // Stress segment (second 1–5 row): 2 → "High"
  await modal.getByRole('button', { name: '2', exact: true }).nth(1).click();
  assert(await modal.locator('span:text-is("High")').first().isVisible(), '(e) Stress segment selects (2 → High)');

  // Soreness chips (quads trained yesterday → row present)
  const mildChip = modal.getByRole('button', { name: 'Mild', exact: true });
  await mildChip.waitFor({ state: 'visible', timeout: 10000 });
  await mildChip.click();
  const mildSelected = await mildChip.evaluate((el) => el.className.includes('bg-primary-500'));
  assert(mildSelected, '(e) soreness chip toggles selected state');

  // Bodyweight inline input
  const bw = page.locator('#checkin-bodyweight');
  await bw.fill('177.2');
  assert((await bw.inputValue()) === '177.2', '(e) bodyweight input accepts a value');
  await page.screenshot({ path: `${out}readiness-checkin-3-interacted.png` });

  // (b) X dismisses without submitting
  await closeBtn.click();
  await modal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  assert(!(await modal.isVisible().catch(() => false)), '(b) X closes the modal');
  assert(
    !checkInWrites.some((b) => b.includes('pre_workout_check_in')),
    '(b) X dismissal submitted no check-in data'
  );

  // Reopen and (b) scrim tap dismisses without submitting
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Readiness', exact: true }).click();
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await page.mouse.click(8, 8); // top-left corner = backdrop
  await modal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  assert(!(await modal.isVisible().catch(() => false)), '(b) scrim tap closes the modal');
  assert(
    !checkInWrites.some((b) => b.includes('pre_workout_check_in')),
    '(b) scrim dismissal submitted no check-in data'
  );

  // Workout screen untouched underneath.
  assert(
    await page.getByRole('button', { name: 'Finish', exact: true }).isVisible(),
    'workout screen still present after open/close cycles'
  );
  await page.screenshot({ path: `${out}readiness-checkin-4-dismissed.png` });

  await browser.close();
  const passed = list.filter(Boolean).length;
  console.log(`\n${passed}/${list.length} checks passed`);
  process.exit(passed === list.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
