/**
 * muscle-map.mjs — 390px Playwright spec for the SVG body-map (MuscleMap)
 * across its three surfaces: the volume page (mode=volume), the in-workout
 * readiness sheet (mode=recovery) and the exercise details modal
 * (mode=highlight).
 *
 * REQUIRES A RUNNING APP on :3000 (see ./README.md). Dark theme is the app
 * default, so all screenshots here are the required 390px dark-mode set.
 *
 * Deterministic logic (taxonomy coverage, zone/recovery parity with the
 * bars/rows, left-right color equality, tap callback) is covered headlessly
 * in Jest (`lib/muscleMap/__tests__`, `components/muscleMap/__tests__`,
 * `volumeSurfaceParity.test.ts`); this spec verifies the in-app behavior:
 * rendering, tap-to-scroll, collapse persistence, view toggle, DOM-level
 * color parity with the live bars, and dark-mode legibility of the figure.
 */

import { newHarness, json, BASE } from './lib.mjs';

const SESSION_ID = 'sess-map-1';
const out = './ux-audit/verify/screens/';

function results() {
  const list = [];
  const assert = (cond, msg) => {
    list.push(!!cond);
    console.log((cond ? 'PASS: ' : 'FAIL: ') + msg);
  };
  return { list, assert };
}

const rgbOf = (str) => {
  const m = /rgba?\(([^)]+)\)/.exec(str);
  return m ? m[1].split(',').slice(0, 3).map((n) => Number(n.trim())) : null;
};

async function inViewport(page, testid) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }, testid);
}

// Weekly-volume blocks: quads in-zone (green), back over MRV (red), biceps
// below MEV (amber), everything untrained gray. Same shape the weekly-volume
// query returns (joined exercises + set_logs).
function volumeBlocks() {
  const block = (id, name, primary, secondary, sets) => ({
    id,
    exercise_id: id,
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    workout_sessions: { id: `ws-${id}`, completed_at: new Date().toISOString(), user_id: 'test-user-id', state: 'completed' },
    set_logs: Array.from({ length: sets }, (_, i) => ({ id: `${id}-s${i}`, is_warmup: false })),
  });
  return [
    block('sq', 'Back Squat', 'quads', ['glutes'], 10),
    block('row', 'Barbell Row', 'lats', [], 30),
    block('curl', 'Dumbbell Curl', 'biceps', [], 2),
  ];
}

async function volumePageChecks(page, assert) {
  await page.route('**/rest/v1/exercise_blocks**', (r) => json(r, volumeBlocks()));

  await page.goto(`${BASE}/dashboard/volume`, { waitUntil: 'domcontentloaded' });
  const map = page.getByTestId('volume-muscle-map');
  await map.waitFor({ state: 'visible', timeout: 20000 });
  assert(await map.isVisible(), 'volume page: body map renders above the bars');
  assert(
    (await page.locator('[data-testid="volume-muscle-map"] [data-testid="muscle-map-front"]').count()) === 1 &&
      (await page.locator('[data-testid="volume-muscle-map"] [data-testid="muscle-map-back"]').count()) === 1,
    'volume page: both front and back figures render side by side'
  );

  // DOM-level zone parity with the live bars: quads green, back red, biceps amber.
  const quadsPath = page.locator('[data-testid="volume-muscle-map"] path[data-muscle="quads"]').first();
  const latsPath = page.locator('[data-testid="volume-muscle-map"] path[data-muscle="lats"]').first();
  const bicepsPath = page.locator('[data-testid="volume-muscle-map"] path[data-muscle="biceps"]').first();
  assert((await quadsPath.getAttribute('class')).includes('fill-success-500'), 'volume page: quads region green (in zone)');
  assert((await latsPath.getAttribute('class')).includes('fill-danger-500'), 'volume page: lats region red (over MRV)');
  assert((await bicepsPath.getAttribute('class')).includes('fill-warning-500'), 'volume page: biceps region amber (below MEV)');
  const quadsBar = await page
    .locator('[data-testid="volume-row-quads"] .bg-success-500')
    .count();
  assert(quadsBar > 0, 'volume page: quads BAR is also green — map and bar agree on screen');

  // Dark-mode legibility: the figure's base tone must differ from the page bg.
  const headFill = rgbOf(
    await page
      .locator('[data-testid="volume-muscle-map"] path[data-region="head"]')
      .evaluate((el) => getComputedStyle(el).fill)
  );
  const bodyBg = rgbOf(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const distinct =
    headFill && bodyBg && headFill.some((c, i) => Math.abs(c - bodyBg[i]) > 8);
  assert(distinct, `volume page: base figure legible against dark bg (fill ${headFill} vs bg ${bodyBg})`);

  await map.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}muscle-map-1-volume.png` });

  // Tap quads on the map → scrolls to the quads bar row.
  await page.evaluate(() => window.scrollTo(0, 0));
  await quadsPath.click();
  await page.waitForTimeout(900); // smooth scroll
  assert(await inViewport(page, 'volume-row-quads'), 'volume page: tapping quads region scrolls to the quads bar row');
  await page.screenshot({ path: `${out}muscle-map-2-volume-scrolled.png` });

  // Collapse is persisted across a reload (localStorage preference).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('volume-map-toggle').click();
  assert(!(await map.isVisible().catch(() => false)), 'volume page: Hide collapses the map');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('volume-map-toggle').waitFor({ state: 'visible', timeout: 20000 });
  assert(
    (await page.getByTestId('volume-muscle-map').count()) === 0,
    'volume page: collapsed preference survives a reload'
  );
  await page.getByTestId('volume-map-toggle').click();
  assert(await page.getByTestId('volume-muscle-map').isVisible(), 'volume page: Show expands it again');
}

async function workoutSurfacesChecks(page, assert) {
  // In-progress session with one exercise and two logged sets, so quads has
  // live volume AND a just-trained (Fatigued) recovery status.
  await page.route('**/rest/v1/workout_sessions**', (r) =>
    json(r, [
      { id: SESSION_ID, user_id: 'test-user-id', state: 'in_progress', started_at: new Date(Date.now() - 20 * 60000).toISOString(), completed_at: null },
    ])
  );
  const setLog = (n) => ({
    id: `s${n}`,
    exercise_block_id: 'blk-1',
    set_number: n,
    weight_kg: 100,
    reps: 5,
    rpe: 8,
    rest_seconds: 120,
    is_warmup: false,
    set_type: 'normal',
    logged_at: new Date(Date.now() - (3 - n) * 5 * 60000).toISOString(),
  });
  await page.route('**/rest/v1/exercise_blocks**', (r) =>
    json(r, [
      {
        id: 'blk-1',
        workout_session_id: SESSION_ID,
        exercise_id: 'ex-squat',
        order: 1,
        target_sets: 3,
        target_rep_range: [5, 8],
        target_rir: 2,
        target_weight_kg: 100,
        target_rest_seconds: 120,
        exercises: {
          id: 'ex-squat',
          name: 'Back Squat',
          primary_muscle: 'quads',
          secondary_muscles: ['glutes', 'erectors'],
          default_rep_range: [5, 8],
          min_weight_increment_kg: 2.5,
        },
        workout_sessions: { id: SESSION_ID, completed_at: null, user_id: 'test-user-id', state: 'in_progress' },
        set_logs: [setLog(1), setLog(2)],
      },
    ])
  );

  // The page loads the session's logged sets via a flat set_logs select —
  // feeding it the same two sets makes quads "just trained" (Fatigued) so the
  // recovery map shows a real status color.
  await page.route('**/rest/v1/set_logs**', (r) => json(r, [setLog(1), setLog(2)]));

  await page.goto(`${BASE}/dashboard/workout/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });

  // --- Readiness sheet (mode=recovery) --------------------------------------
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId('readiness-sheet-trigger').click();
  const sheet = page.getByTestId('readiness-sheet');
  await sheet.waitFor({ state: 'visible', timeout: 15000 });
  const rMap = page.getByTestId('readiness-muscle-map');
  await rMap.waitFor({ state: 'visible', timeout: 15000 });
  assert(await rMap.isVisible(), 'readiness sheet: recovery map renders above the rows');
  assert(
    (await page.locator('[data-testid="readiness-muscle-map"] [data-testid="muscle-map-front"]').count()) === 1 &&
      (await page.locator('[data-testid="readiness-muscle-map"] [data-testid="muscle-map-back"]').count()) === 0,
    'readiness sheet: compact map shows a single view at a time (front by default)'
  );
  await page.screenshot({ path: `${out}muscle-map-3-readiness.png` });

  // Recovery parity with the row badge, live in the DOM: quads badge status
  // must match the quads region color family. Quads is Fatigued (just
  // trained) so it sinks below the "+N more" cap — tapping its map region
  // must reveal the full list and scroll to it.
  await page.locator('[data-testid="readiness-muscle-map"] path[data-muscle="quads"]').first().click();
  await page.waitForTimeout(900);
  assert(await inViewport(page, 'readiness-row-quads'), 'readiness sheet: tapping a capped-away muscle reveals the list and scrolls to its row');
  const badgeText = (await page.getByTestId('readiness-badge-quads').textContent()).trim();
  const quadsClass = await page
    .locator('[data-testid="readiness-muscle-map"] path[data-muscle="quads"]')
    .first()
    .getAttribute('class');
  const expectedFill =
    badgeText === 'Fresh' ? 'fill-success-500' : badgeText === 'Recovering' ? 'fill-warning-500' : badgeText === 'Fatigued' ? 'fill-surface-600' : 'fill-surface-800';
  assert(
    quadsClass.includes(expectedFill),
    `readiness sheet: quads region color (${quadsClass.match(/fill-[\w-]+/)?.[0]}) matches its "${badgeText}" badge`
  );

  // Recovery/Volume toggle repaints the same regions with volume zones —
  // quads have logged sets this week, so the region must switch from the
  // status gray to a zone color family, then back.
  await page.getByTestId('readiness-map-mode-volume').click();
  const quadsVolumeClass = await page
    .locator('[data-testid="readiness-muscle-map"] path[data-muscle="quads"]')
    .first()
    .getAttribute('class');
  assert(
    /fill-(success|warning|danger)-500/.test(quadsVolumeClass),
    `readiness sheet: Volume toggle paints quads by zone (${quadsVolumeClass.match(/fill-[\w-]+/)?.[0]})`
  );
  await page.screenshot({ path: `${out}muscle-map-3b-readiness-volume.png` });
  await page.getByTestId('readiness-map-mode-recovery').click();
  assert(
    (
      await page
        .locator('[data-testid="readiness-muscle-map"] path[data-muscle="quads"]')
        .first()
        .getAttribute('class')
    ).includes(expectedFill),
    'readiness sheet: Recovery toggle restores the status paint'
  );

  // Front/back toggle swaps the figure.
  await page.getByTestId('readiness-map-view-back').click();
  assert(
    (await page.locator('[data-testid="readiness-muscle-map"] [data-testid="muscle-map-back"]').count()) === 1,
    'readiness sheet: Back toggle switches to the posterior view'
  );
  await page.screenshot({ path: `${out}muscle-map-4-readiness-back.png` });
  await page.getByTestId('readiness-map-view-front').click();

  // Dismiss the sheet.
  await page.mouse.click(5, 5);
  await sheet.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // --- Exercise details modal (mode=highlight) -------------------------------
  await page.getByRole('button', { name: 'Back Squat' }).first().click();
  const eMap = page.getByTestId('exercise-muscle-map');
  await eMap.waitFor({ state: 'visible', timeout: 15000 });
  assert(await eMap.isVisible(), 'exercise details: highlight map renders in Muscles Worked');

  const primaryPath = page.locator('[data-testid="exercise-muscle-map"] path[data-muscle="quads"]').first();
  const secondaryPath = page.locator('[data-testid="exercise-muscle-map"] path[data-muscle="glutes"]').first();
  const erectorsPath = page.locator('[data-testid="exercise-muscle-map"] path[data-muscle="erectors"]').first();
  assert(
    (await primaryPath.getAttribute('class')).includes('fill-primary-500') &&
      (await primaryPath.getAttribute('fill-opacity')) === '1',
    'exercise details: primary muscle (quads) at full accent'
  );
  assert(
    (await secondaryPath.getAttribute('fill-opacity')) === '0.4' &&
      (await erectorsPath.getAttribute('fill-opacity')) === '0.4',
    'exercise details: secondaries (glutes, erectors) dimmed to 40%'
  );
  await eMap.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}muscle-map-5-exercise-detail.png` });
}

async function main() {
  const { list, assert } = results();

  // Surface 1 runs in its own context so its routes/storage don't leak.
  {
    const { browser, page } = await newHarness();
    await volumePageChecks(page, assert);
    await browser.close();
  }
  // Surfaces 2 + 3 share the workout page.
  {
    const { browser, page } = await newHarness();
    await workoutSurfacesChecks(page, assert);
    await browser.close();
  }

  const passed = list.filter(Boolean).length;
  console.log(`\n${passed}/${list.length} checks passed`);
  process.exit(passed === list.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
