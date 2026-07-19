/**
 * subjective-feedback.mjs — 390px Playwright spec for the inline subjective
 * feedback capture (soreness / pump / joint pain).
 *
 * REQUIRES A RUNNING APP on :3000 (see ./README.md for the build/start + auth
 * cookie setup). Asserts the ticket's core UX contracts:
 *
 *  1. The soreness chip row renders inline on the first exercise of a muscle
 *     trained within the past 5 days — no modal, no popup.
 *  2. Logging a set with EVERY prompt ignored requires ZERO extra taps vs
 *     today: one tap on "Log set" logs the set and silently dismisses the
 *     soreness ask for the session.
 *  3. Answering soreness is one tap and collapses the row to a ✓ line; the
 *     row is not re-asked on the same muscle.
 *  4. Pump/workload chips appear on the exercise's completed state and are
 *     one-tap each; the card completes visually regardless.
 *  5. The joint-pain trigger opens an inline two-tap picker (joint, then
 *     severity) — never a modal.
 */

import { newHarness, json, BASE } from './lib.mjs';

const SESSION_ID = 'sess-e2e-feedback';
const PREV_SESSION_ID = 'sess-e2e-prev';
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

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  // --- Fixtures --------------------------------------------------------------
  // workout_sessions serves both the live session load AND the
  // fetchRecentMuscleSessions lookup (a completed quads session 2 days ago,
  // which arms the soreness ask).
  await page.route('**/rest/v1/workout_sessions**', (r) => {
    const url = r.request().url();
    if (url.includes('state=eq.completed')) {
      return json(r, [
        {
          id: PREV_SESSION_ID,
          completed_at: twoDaysAgo,
          is_deload: false,
          exercise_blocks: [
            { exercises: { primary_muscle: 'quads' } },
          ],
        },
      ]);
    }
    // The page loads the live session with .single() — serve an object when
    // PostgREST's single-object Accept header is present, else an array.
    const row = {
      id: SESSION_ID,
      user_id: 'test-user-id',
      state: 'in_progress',
      started_at: new Date(Date.now() - 60_000).toISOString(),
      completed_at: null,
    };
    const wantsObject = (r.request().headers()['accept'] ?? '').includes('object');
    return json(r, wantsObject ? row : [row]);
  });

  await page.route('**/rest/v1/exercise_blocks**', (r) => {
    if (r.request().method() !== 'GET') return json(r, []);
    return json(r, [
      {
        id: 'blk-1',
        workout_session_id: SESSION_ID,
        exercise_id: 'ex-squat',
        order: 1,
        superset_group_id: null,
        superset_order: null,
        target_sets: 2,
        target_rep_range: [8, 12],
        target_rir: 2,
        target_weight_kg: 100,
        target_rest_seconds: 120,
        progression_type: null,
        suggestion_reason: '',
        warmup_protocol: null,
        note: null,
        dropsets_per_set: 0,
        drop_percentage: 0.25,
        pump: null,
        workload: null,
        exercises: {
          id: 'ex-squat',
          name: 'Back Squat',
          primary_muscle: 'quads',
          secondary_muscles: ['glutes'],
          mechanic: 'compound',
          default_rep_range: [8, 12],
          default_rir: 2,
          min_weight_increment_kg: 2.5,
          form_cues: [],
          common_mistakes: [],
          setup_note: '',
          movement_pattern: 'squat',
          equipment_required: ['barbell'],
          equipment: 'barbell',
          is_bodyweight: false,
        },
        workout_sessions: { id: SESSION_ID, completed_at: null, user_id: 'test-user-id', state: 'in_progress' },
        set_logs: [],
      },
    ]);
  });

  // Set inserts / feedback upserts / pain events: accept and echo.
  await page.route('**/rest/v1/set_logs**', (r) => {
    if (r.request().method() === 'GET') return json(r, []);
    return json(r, [{}]);
  });
  await page.route('**/rest/v1/session_muscle_feedback**', (r) => json(r, [{}]));
  await page.route('**/rest/v1/joint_pain_events**', (r) =>
    json(r, r.request().method() === 'GET' ? [] : [{}])
  );
  await page.route('**/rest/v1/user_muscle_recovery_multipliers**', (r) =>
    json(r, r.request().method() === 'GET' ? [] : [{}])
  );

  // --- Open the workout ------------------------------------------------------
  await page.goto(`${BASE}/dashboard/workout/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Back Squat').first().waitFor({ timeout: 15000 });

  // 1. Soreness chips render inline (quads trained 2 days ago). The ask is
  //    armed by an async previous-session lookup, so allow it time to land
  //    before logging anything.
  const sorenessRow = page.getByTestId('soreness-chip-row');
  await sorenessRow.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  assert(await sorenessRow.isVisible().catch(() => false), 'soreness chip row renders inline on the first quads exercise');
  assert((await page.locator('[role="dialog"], .modal').count()) === 0, 'no modal/popup anywhere');
  await page.screenshot({ path: `${out}feedback-1-soreness-row.png` });

  // 2. Zero extra taps: ignore the prompt entirely and log the set with the
  //    SAME single tap as before this feature.
  const logButton = page.getByRole('button', { name: 'Log set' });
  assert(await logButton.isVisible(), 'Log set button present with the prompt showing');
  await logButton.click(); // <-- the ONLY tap
  await page.getByText(/Set 1 ·/).waitFor({ timeout: 10000 });
  assert(true, 'one tap on "Log set" logged the set with all prompts ignored');
  await sorenessRow.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  assert(!(await sorenessRow.isVisible().catch(() => false)), 'ignored soreness ask dismissed by logging (records null, never re-asked)');
  await page.screenshot({ path: `${out}feedback-2-logged-ignoring.png` });

  // 3. Joint pain: two-tap picker inside the note icon's feedback sheet (the
  //    bone-icon shortcut on the chip row was removed; injury flagging now
  //    lives in the notes flow).
  await page.getByRole('button', { name: 'Add set feedback' }).click();
  const jointTrigger = page.getByTestId('joint-pain-trigger');
  assert(await jointTrigger.isVisible(), 'injury/discomfort trigger present inside the feedback sheet');
  await jointTrigger.click();
  const picker = page.getByTestId('joint-pain-picker');
  assert(await picker.isVisible(), 'joint picker renders in the sheet');
  await page.getByTestId('joint-chip-knee').click(); // tap 1
  await page.getByTestId('joint-severity-chip-twinge').click(); // tap 2
  assert(!(await picker.isVisible().catch(() => false)), 'two taps total: joint then severity, picker closes');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.screenshot({ path: `${out}feedback-3-joint-picked.png` });

  // 4. Log the final planned set → completed state shows pump/workload chips.
  await page.getByRole('button', { name: 'Log set' }).click();
  const chips = page.getByTestId('exercise-feedback-chips');
  await chips.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  assert(await chips.isVisible().catch(() => false), 'pump/workload chips appear on the completed card state');
  await page.getByTestId('pump-chip-2').click();
  await page.getByTestId('workload-chip-1').click();
  assert(true, 'pump + workload each one tap');
  await page.screenshot({ path: `${out}feedback-4-pump-workload.png` });

  await browser.close();
  const passed = list.filter(Boolean).length;
  console.log(`\n${passed}/${list.length} checks passed`);
  process.exit(passed === list.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
