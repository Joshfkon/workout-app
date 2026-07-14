/**
 * analytics-restructure.mjs — drives the real Progress page on :3000 to verify
 * the 5→4 tab restructure and the Phase-1 data fixes. Forges a local session
 * and intercepts Supabase (no real credentials), modeled on lib.mjs.
 *
 * Run (dev server on :3000): node ux-audit/verify/analytics-restructure.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { authCookies, json, BASE, CHROME } from './lib.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (cond, msg) => {
  results.push(!!cond);
  console.log((cond ? 'PASS: ' : 'FAIL: ') + msg);
};

// ---- Fixtures -------------------------------------------------------------
const UID = 'test-user-id';
const iso = (d) => `${d}T00:00:00.000Z`;

// 3 DEXA scans (trustworthy trend). Latest lean 71.4 + bone 3.1.
const SCANS = [
  { id: 's3', user_id: UID, scan_date: '2026-06-20', weight_kg: 88, lean_mass_kg: 71.4, fat_mass_kg: 13.6, body_fat_percent: 15.5, bone_mass_kg: 3.1, regional_data: null, notes: null, created_at: iso('2026-06-20') },
  { id: 's2', user_id: UID, scan_date: '2026-05-20', weight_kg: 87, lean_mass_kg: 71.0, fat_mass_kg: 13.0, body_fat_percent: 14.9, bone_mass_kg: 3.1, regional_data: null, notes: null, created_at: iso('2026-05-20') },
  { id: 's1', user_id: UID, scan_date: '2026-04-20', weight_kg: 86, lean_mass_kg: 70.4, fat_mass_kg: 12.6, body_fat_percent: 14.6, bone_mass_kg: 3.0, regional_data: null, notes: null, created_at: iso('2026-04-20') },
];

// Coaching session with a STALE frozen FFMI (16.6) — the Strength card must
// now show the canonical value, not this.
const COACHING = [{
  id: 'c1', user_id: UID, status: 'completed', created_at: iso('2026-02-01'),
  strength_profile: {
    overallScore: 68, strengthLevel: 'intermediate', balanceScore: 82,
    bodyComposition: { ffmi: 16.6, leanMassKg: 68, bodyFatPercent: 15, weightKg: 84 },
    calibratedLifts: [
      { benchmarkId: 'b1', lift: 'Barbell Back Squat', estimated1RM: 142, strengthLevel: 'intermediate', percentileScore: { vsGeneralPopulation: 70, vsTrainedPopulation: 55, vsBodyComposition: 60 } },
    ],
    imbalances: [],
  },
  calibrated_lifts: [],
  body_composition: { ffmi: 16.6, leanMassKg: 68, bodyFatPercent: 15, weightKg: 84 },
}];

// Daily weigh-ins (so the projection renders — bug 3).
const WEIGHTS = Array.from({ length: 30 }, (_, i) => {
  const day = String(15 + (i % 15) === 0 ? 1 : ((i % 28) + 1)).padStart(2, '0');
  const month = i < 15 ? '06' : '07';
  return { logged_at: `2026-${month}-${day}`, weight: 193 + i * 0.1, unit: 'lb' };
});

// Two measurement rows: latest has a NULL left_calf and a >15% neck outlier.
const MEASUREMENTS = [
  { id: 'm2', user_id: UID, logged_at: '2026-07-13', neck: 45, shoulders: 130, chest: 106, waist: 84, left_bicep: 40, right_bicep: 40, left_forearm: 31, right_forearm: 31, hips: 100, left_thigh: 62, right_thigh: 62, left_calf: null, right_calf: 39, upper_back: 45, lower_back: 40, created_at: iso('2026-07-13') },
  { id: 'm1', user_id: UID, logged_at: '2026-07-05', neck: 38, shoulders: 129, chest: 105, waist: 85, left_bicep: 39, right_bicep: 39, left_forearm: 30.5, right_forearm: 30.5, hips: 100, left_thigh: 61.5, right_thigh: 61.5, left_calf: 39, right_calf: 39, upper_back: 45, lower_back: 40, created_at: iso('2026-07-05') },
];

const TARGETS = [{
  id: 't1', user_id: UID, is_active: true, name: 'Lean bulk', target_weight_kg: 90, target_body_fat_percent: 13, target_ffmi: 23,
  mesocycle_id: 'meso1', target_date: '2026-09-12', notes: null, created_at: iso('2026-06-18'), updated_at: iso('2026-06-18'),
}];

const MESOS = [{
  id: 'meso1', user_id: UID, name: 'Hypertrophy block', state: 'active', is_active: true,
  total_weeks: 6, current_week: 2, deload_week: 6, days_per_week: 4, split_type: 'upper_lower',
  fatigue_score: 30, preferred_workout_days: null, session_duration_minutes: 60,
  // Started 6 days ago: lifts straddle it, <3 sessions since → calibrating.
  started_at: iso('2026-07-08'), start_date: '2026-07-08', created_at: iso('2026-07-08'), completed_at: null,
}];

// Check-ins: sleep + energy + soreness logged; mood/focus/libido/stress/hunger
// NEVER logged (null) → must be absent from the main chart/sparklines and only
// appear under "More" with a log affordance.
const CHECKINS = Array.from({ length: 8 }, (_, i) => ({
  date: `2026-07-${String(6 + i).padStart(2, '0')}`,
  sleep_hours: 7 + (i % 3) * 0.4, sleep_quality: 4,
  energy_level: 3 + (i % 2), soreness_level: 2 + (i % 2),
  mood_rating: null, focus_rating: null, libido_rating: null, stress_level: null, hunger_level: null,
}));

const HYDRATION = [
  { logged_at: '2026-07-13', amount_ml: 2000 },
  { logged_at: '2026-07-12', amount_ml: 1800 },
];
const CARDIO = [
  { logged_at: '2026-07-13', minutes: 30, modality: 'incline_walk' },
  { logged_at: '2026-07-11', minutes: 25, modality: 'bike' },
];

// Workout sessions with nested blocks — one exercise (Back Squat, quads) with
// 4 sessions straddling the meso start (3 before, 1 after → calibrating).
const mkBlock = (exId, name, muscle, w, reps) => ({
  id: `blk-${exId}-${w}`,
  exercises: { id: exId, name, primary_muscle: muscle, secondary_muscles: [] },
  set_logs: [
    { id: `sl-${exId}-${w}-1`, weight_kg: w, reps, is_warmup: false, logged_at: iso('2026-07-10') },
    { id: `sl-${exId}-${w}-2`, weight_kg: w, reps, is_warmup: false, logged_at: iso('2026-07-10') },
    { id: `sl-${exId}-${w}-3`, weight_kg: w, reps, is_warmup: false, logged_at: iso('2026-07-10') },
  ],
});
const SESSIONS = [
  { id: 'w1', started_at: iso('2026-06-25'), completed_at: iso('2026-06-25'), duration_seconds: 3600, session_rpe: 8, state: 'completed', exercise_blocks: [mkBlock('ex-sq', 'Barbell Back Squat', 'quads', 130, 8)] },
  { id: 'w2', started_at: iso('2026-07-01'), completed_at: iso('2026-07-01'), duration_seconds: 3700, session_rpe: 8, state: 'completed', exercise_blocks: [mkBlock('ex-sq', 'Barbell Back Squat', 'quads', 132.5, 8)] },
  { id: 'w3', started_at: iso('2026-07-05'), completed_at: iso('2026-07-05'), duration_seconds: 3500, session_rpe: 7, state: 'completed', exercise_blocks: [mkBlock('ex-sq', 'Barbell Back Squat', 'quads', 135, 8)] },
  { id: 'w4', started_at: iso('2026-07-12'), completed_at: iso('2026-07-12'), duration_seconds: 3800, session_rpe: 9, state: 'completed', exercise_blocks: [mkBlock('ex-sq', 'Barbell Back Squat', 'quads', 137.5, 8)] },
];

// exercise_blocks for the weekly MEV summary (last 7 days).
const EX_BLOCKS = [{
  id: 'wb1',
  exercises: { id: 'ex-sq', name: 'Barbell Back Squat', primary_muscle: 'quads', secondary_muscles: ['glutes'] },
  set_logs: [{ id: 'a', is_warmup: false }, { id: 'b', is_warmup: false }, { id: 'c', is_warmup: false }],
  workout_sessions: { user_id: UID, completed_at: iso('2026-07-12'), state: 'completed' },
}];

async function routeFixtures(page) {
  const R = (table, body) => page.route(`**/rest/v1/${table}**`, (r) => json(r, body));
  await page.route('**/rest/v1/users**', (r) => json(r, { id: UID, height_cm: 180, goal: 'bulk', experience: 'intermediate', target_body_fat_percent: 13, target_weight_kg: 90, sex: 'male' }));
  await R('dexa_scans', SCANS);
  await R('progress_photos', []);
  await R('coaching_sessions', COACHING);
  await R('weight_log', WEIGHTS);
  await R('body_measurements', MEASUREMENTS);
  await R('body_composition_targets', TARGETS);
  await R('mesocycles', MESOS);
  await R('daily_check_ins', CHECKINS);
  await R('hydration_log', HYDRATION);
  await R('cardio_log', CARDIO);
  await R('nutrition_targets', []);
  await R('workout_sessions', SESSIONS);
  await R('exercise_blocks', EX_BLOCKS);
}

const clickTab = async (page, id) => {
  await page.locator(`[data-testid="analytics-tab-${id}"]`).first().click().catch(() => {});
  await page.waitForTimeout(900);
};
const numOf = (s) => {
  const m = (s || '').match(/(\d+\.?\d*)/);
  return m ? m[1] : '';
};

async function run() {
  const { user, cookies } = authCookies();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block',
    colorScheme: 'dark',
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.route('**/auth/v1/**', (r) => json(r, user));
  await routeFixtures(page);

  // ---- Body tab (default) -------------------------------------------------
  await page.goto(`${BASE}/dashboard/analytics`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="analytics-content"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}restructure-body.png`, fullPage: true });

  const tabButtons = await page.locator('nav button, div button').allInnerTexts().catch(() => []);
  const labelsPresent = ['Body', 'Strength', 'Training', 'Wellness'].every((l) =>
    tabButtons.some((t) => t.includes(l)));
  assert(labelsPresent, 'four tabs present: Body · Strength · Training · Wellness');
  assert(!tabButtons.some((t) => t.trim() === 'Goals'), 'Goals tab removed');

  const bodyFfmi = numOf(await page.locator('[data-testid="body-ffmi-value"]').first().innerText().catch(() => ''));
  assert(/\d/.test(bodyFfmi), `Body FFMI stat renders (${bodyFfmi})`);

  // Range selector must NOT appear on Body (dead control removed).
  const rangeOnBody = await page.locator('[data-testid="analytics-range-selector"]').count();
  assert(rangeOnBody === 0, 'range selector hidden on Body tab');

  // Measurements: outlier chip present, null site hidden (no dash-delta row).
  const outlierChips = await page.locator('[data-testid^="measurement-outlier-"]').count();
  assert(outlierChips >= 1, `measurement outlier "check entry" chip present (${outlierChips})`);
  const dashDeltaText = await page.locator('text=/- (in|cm) ↓/').count();
  assert(dashDeltaText === 0, 'no dash-delta ("- in ↓NN") rows in the compare grid');
  const calfVisibleBefore = await page.locator('[data-testid="measurement-missing-left_calf"]').count();
  assert(calfVisibleBefore === 0, 'null-current site hidden from grid before "Show all"');
  // Reveal hidden sites.
  await page.locator('[data-testid="measurements-show-all-toggle"]').first().click().catch(() => {});
  await page.waitForTimeout(300);
  const calfVisibleAfter = await page.locator('[data-testid="measurement-missing-left_calf"]').count();
  assert(calfVisibleAfter >= 1, 'null-current site appears under "Show all" with add affordance');

  // Proportions & targets card present (Goals content rehomed).
  assert((await page.locator('[data-testid="proportions-targets-card"]').count()) === 1,
    'Proportions & Targets card present on Body (once)');

  // Only ONE legacy "Body Composition Trends" area chart title should NOT exist
  // (deleted); the combined trend module's title is "Body Composition Trend".
  const legacyTitle = await page.locator('text="Body Composition Trends"').count();
  assert(legacyTitle === 0, 'legacy duplicate "Body Composition Trends" chart deleted');

  // ---- Strength tab -------------------------------------------------------
  await clickTab(page, 'strength');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}restructure-strength.png`, fullPage: true });

  const scoreCards = await page.locator('[data-testid="strength-score-card"]').count();
  assert(scoreCards === 1, `strength score card rendered exactly once (${scoreCards})`);

  const strengthFfmi = numOf(await page.locator('[data-testid="strength-ffmi-stat"]').first().innerText().catch(() => ''));
  assert(strengthFfmi === bodyFfmi && /\d/.test(strengthFfmi),
    `FFMI equal across Body & Strength (Body ${bodyFfmi} == Strength ${strengthFfmi}) and NOT the stale 16.6`);
  assert(strengthFfmi !== '16.6', 'Strength FFMI is the canonical value, not the frozen 16.6');

  const rangeOnStrength = await page.locator('[data-testid="analytics-range-selector"]').count();
  assert(rangeOnStrength === 0, 'range selector hidden on Strength tab');

  // ---- Training tab -------------------------------------------------------
  await clickTab(page, 'training');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}restructure-training.png`, fullPage: true });

  const rangeOnTraining = await page.locator('[data-testid="analytics-range-selector"]').count();
  assert(rangeOnTraining >= 1, 'range selector present on Training tab (it scopes this data)');
  assert((await page.locator('text="Volume vs your targets"').count()) >= 1,
    'Training shows shared MEV–MRV "Volume vs your targets" (not hardcoded table)');
  assert((await page.locator('text=/Week 2 of 6/').count()) >= 1, 'mesocycle progress row present on Training');

  // ---- Wellness tab -------------------------------------------------------
  await clickTab(page, 'wellness');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}restructure-wellness.png`, fullPage: true });

  const hydrationCards = await page.locator('[data-testid="hydration-tracker-card"]').count();
  assert(hydrationCards === 1, `exactly ONE hydration card in the DOM (${hydrationCards})`);
  assert((await page.locator('[data-testid="wellness-trends-card"]').count()) === 1,
    'ONE consolidated Wellness Trends card');

  // Never-logged metric (mood) absent as a primary chip; present under "More"
  // as a log affordance.
  const moodChipBefore = await page.locator('[data-testid="wellness-chip-moodRating"]').count();
  assert(moodChipBefore === 0, 'never-logged metric (mood) absent from primary chips');
  await page.locator('[data-testid="wellness-chip-more"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
  const moodLog = await page.locator('[data-testid="wellness-log-moodRating"]').count();
  assert(moodLog >= 1, 'never-logged metric (mood) appears under "More" with a log affordance');
  // Soreness (logged, inverted) has a "lower is better" footnote when active.
  await page.locator('[data-testid="wellness-tile-sorenessLevel"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
  const lowerNote = await page.locator('[data-testid="lower-is-better-note"]').count();
  assert(lowerNote >= 1, 'inverted metric shows a "lower is better" footnote (axis not flipped)');

  // ---- Goals deep-link redirect ------------------------------------------
  await page.goto(`${BASE}/dashboard/analytics?tab=goals&section=body-targets`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="analytics-content"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  const bodyStripAfterGoals = await page.locator('[data-testid="body-stat-strip"]').count();
  const bodyTargetsReachable = await page.locator('#body-targets').count();
  assert(bodyStripAfterGoals >= 1 && bodyTargetsReachable >= 1,
    '?tab=goals lands on Body with the targets editor reachable (#body-targets)');

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
