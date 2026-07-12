/**
 * Playwright verification for the add-food Recent + Meals views (390px).
 *
 * Asserts, against a fully-intercepted Supabase:
 *  - the add-food sheet opens with RECENT as the default view, deduped, with
 *    localDay date labels (Today / Yesterday),
 *  - quick-add (+) from Recent re-logs into today and bumps the macro totals,
 *    without closing the sheet,
 *  - the Meals view groups prior meals; expanding one and adding a single item,
 *    plus "Add all" from another, both bump the totals.
 *
 * The localDay midnight-boundary labeling is covered deterministically by the
 * Jest unit test (lib/nutrition/__tests__/recentFoods.test.ts → dayLabel).
 *
 * Run (server on :3000): node ux-audit/verify/nutrition-recents-meals.mjs
 */
import { newHarness, json as j, BASE } from './lib.mjs';
import fs from 'node:fs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const localDate = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TODAY = localDate(0);
const YESTERDAY = localDate(-1);
const TWO_AGO = localDate(-2);

const row = (o) => ({
  user_id: 'test-user-id', serving_size: '1 serving', servings: 1, protein: 0, carbs: 0,
  fat: 0, source: 'manual', food_id: null, nutritionix_id: null,
  created_at: `${o.logged_at}T08:00:00Z`, ...o,
});

const foodByDate = {
  [TODAY]: [
    row({ id: 't1', logged_at: TODAY, meal_type: 'breakfast', food_name: 'Oats', serving_size: '1 cup', calories: 300, protein: 10, carbs: 54, fat: 5 }),
    row({ id: 't2', logged_at: TODAY, meal_type: 'lunch', food_name: 'Chicken', serving_size: '200g', servings: 2, calories: 400, protein: 74, carbs: 0, fat: 8 }),
  ],
  [YESTERDAY]: [],
  [TWO_AGO]: [],
};

// The recents/meals window (last ~90d, newest first). Chicken appears twice →
// must dedupe. Meals excludes TODAY, leaving yesterday's + two-days-ago meals.
const RECENTS = [
  ...foodByDate[TODAY],
  row({ id: 'y1', logged_at: YESTERDAY, meal_type: 'lunch', food_name: 'Chicken', serving_size: '150g', servings: 1, calories: 250, protein: 46, carbs: 0, fat: 5 }),
  row({ id: 'y2', logged_at: YESTERDAY, meal_type: 'dinner', food_name: 'Salmon', serving_size: '150g', calories: 280, protein: 39, carbs: 0, fat: 13 }),
  row({ id: 'z1', logged_at: TWO_AGO, meal_type: 'dinner', food_name: 'Rice', serving_size: '1 cup', calories: 200, protein: 4, carbs: 44, fat: 1 }),
];

const targets = { id: 'nt1', user_id: 'test-user-id', calories: 2500, protein: 180, carbs: 250, fat: 70, meals_per_day: 4, meal_names: null };

async function run() {
  const { browser, page } = await newHarness();

  await page.route('**/rest/v1/nutrition_targets**', (r) => j(r, targets));
  await page.route('**/rest/v1/users**', (r) => j(r, { id: 'test-user-id', height_cm: 180, age: 30, sex: 'male', goal: 'maintenance' }));
  await page.route('**/rest/v1/user_preferences**', (r) => j(r, { weight_unit: 'lb' }));
  await page.route('**/rest/v1/user_volume_profiles**', (r) => j(r, { training_age: 'intermediate', is_enhanced: false }));
  await page.route('**/rest/v1/food_log**', (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      return j(r, { id: 'new-' + Math.random().toString(36).slice(2), user_id: 'test-user-id', logged_at: TODAY, created_at: `${TODAY}T20:00:00Z`, ...body });
    }
    const url = req.url();
    const eq = url.match(/logged_at=eq\.([0-9-]+)/);
    if (eq) return j(r, foodByDate[eq[1]] ?? []);
    // The recents/meals query is the only one ordering by created_at.
    if (url.includes('created_at')) return j(r, RECENTS);
    return j(r, []); // frequent / protein aggregations — irrelevant here
  });

  const results = [];
  const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };
  const macroText = () => page.locator('[data-testid="nutrition-macro-summary"]').innerText();

  // ---- Cold start ----
  await page.goto(`${BASE}/dashboard/nutrition`, { waitUntil: 'domcontentloaded' });
  assert(!page.url().includes('/login'), 'not redirected to /login (auth bypass works)');
  await page.locator('[data-testid="nutrition-macro-summary"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(500);

  // ---- Open add-food → Recent is the default view ----
  await page.getByRole('button', { name: 'Add Food' }).first().click();
  await page.locator('[data-testid="recent-foods-list"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-testid="recent-food-row"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: OUT + 'recents-01-default.png' });

  const recentList = page.locator('[data-testid="recent-foods-list"]');
  const chickenRows = await recentList.getByText('Chicken', { exact: true }).count();
  assert(chickenRows === 1, `Chicken is deduped to a single recent row (saw ${chickenRows})`);
  const listText = await recentList.innerText();
  assert(/Today/.test(listText) && /Yesterday/.test(listText), 'recent rows show localDay date labels (Today / Yesterday)');

  // ---- Quick-add from Recent bumps totals, sheet stays open ----
  const before = await macroText();
  const chickenRow = recentList.locator('[data-testid="recent-food-row"]', { hasText: 'Chicken' }).first();
  await chickenRow.getByRole('button', { name: /quick-add/i }).click();
  await page.waitForTimeout(400);
  assert((await page.locator('[data-testid="recent-foods-list"]').count()) > 0, 'sheet stays open after quick-add (no close)');
  // Close the sheet to read the (behind-modal) macro summary.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterQuickAdd = await macroText();
  assert(afterQuickAdd !== before, 'quick-add from Recent updated the macro totals immediately');
  await page.screenshot({ path: OUT + 'recents-02-after-quickadd.png' });

  // ---- Meals view: expand + add one item, then Add all ----
  await page.getByRole('button', { name: 'Add Food' }).first().click();
  await page.locator('[data-testid="recent-foods-list"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByTestId('add-food-view-meals').click();
  await page.locator('[data-testid="prior-meals-list"]').waitFor({ state: 'visible', timeout: 10000 });
  const meals = page.locator('[data-testid="prior-meals-list"]');
  const mealsText = await meals.innerText();
  assert(/Yesterday/.test(mealsText) && !/Oats/.test(mealsText), 'Meals groups prior days and excludes today (no Oats)');
  await page.screenshot({ path: OUT + 'recents-03-meals.png' });

  const beforeMeals = before; // totals baseline pre-any-add (before quick-add)
  // Collapsed meals don't render their foods — target meals by their header
  // label (dayLabel · mealLabel). "Yesterday · Dinner" = Salmon (unique: the
  // two-days-ago dinner's label is a date, not "Yesterday").
  const yDinner = meals.locator('[data-testid="prior-meal"]').filter({ hasText: 'Yesterday' }).filter({ hasText: 'Dinner' });
  await yDinner.getByRole('button').first().click(); // expand
  await page.waitForTimeout(200);
  await yDinner.locator('[data-testid="prior-meal-food"]', { hasText: 'Salmon' })
    .getByRole('button', { name: /add salmon/i }).click();
  await page.waitForTimeout(300);
  // "Add all" from Yesterday · Lunch (Chicken).
  await meals.locator('[data-testid="prior-meal"]').filter({ hasText: 'Yesterday' }).filter({ hasText: 'Lunch' })
    .getByTestId('prior-meal-add-all').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterMeals = await macroText();
  assert(afterMeals !== afterQuickAdd && afterMeals !== beforeMeals, 'adding from Meals (single + Add all) updated totals again');
  await page.screenshot({ path: OUT + 'recents-04-after-meals.png' });

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
