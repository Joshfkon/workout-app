/**
 * Regression spec for the Edit Food amount/unit corruption fix.
 *
 * Drives the REAL nutrition page + EditFoodModal at 390px against a mocked
 * food_log, reproducing the exact user path that corrupted the Giant Eagle
 * fries record:
 *   1. Edit a 140 cal / 85 g "1 serving" entry, type 180 with unit "serving"
 *      (the user's mistake), save. Reopen → per-serving line must still read
 *      "Per serving: 140 cal" (food reference intact, no corruption).
 *   2. Switch to grams, enter 180 → Updated Nutrition ~296 cal (180/85×140).
 *   3. Save, reopen → amount displays "180" in grams, not a serving fraction.
 * Also asserts every PATCH persists serving_size and never writes a mutated
 * per-serving nutrition back to the food.
 *
 * Run: node ux-audit/verify/nutrition-edit-food-corruption.mjs
 * (requires `npm run dev` on :3000)
 */
import { newHarness, json, BASE } from './lib.mjs';

const OUT = 'ux-audit/verify/screens/';

const results = [];
const assert = (cond, msg) => {
  results.push(!!cond);
  console.log((cond ? 'PASS: ' : 'FAIL: ') + msg);
};

const friesEntry = {
  id: 'log-fries-1',
  user_id: 'test-user-id',
  logged_at: new Date().toISOString().slice(0, 10),
  meal_type: 'breakfast',
  food_name: 'Giant Eagle French Fried Potatoes',
  serving_size: '1 serving (85g)',
  servings: 1,
  calories: 140,
  protein: 3,
  carbs: 21,
  fat: 5,
  source: 'nutritionix',
  food_id: null,
  nutritionix_id: null,
  created_at: new Date().toISOString(),
};

async function main() {
  const { browser, page } = await newHarness();

  // Mutable server-side copy of the entry + a log of every PATCH we receive.
  let stored = { ...friesEntry };
  const patches = [];

  // food_log routes win over the harness catch-all (registered later).
  await page.route('**/rest/v1/food_log**', async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET') return json(route, [stored]);
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      patches.push(body);
      stored = { ...stored, ...body };
      return route.fulfill({ status: 204, body: '' });
    }
    return json(route, []);
  });

  await page.goto(`${BASE}/dashboard/nutrition`, { waitUntil: 'domcontentloaded' });

  const entryButton = page.getByRole('button', { name: /French Fried Potatoes/i });
  await entryButton.first().waitFor({ state: 'visible', timeout: 20000 });
  await page.screenshot({ path: `${OUT}edit-corruption-1-day.png` });

  // ---- Step 1: mistaken "180 servings" ----
  await entryButton.first().click();
  await page.getByTestId('edit-food-per-serving').waitFor({ state: 'visible', timeout: 10000 });
  assert(
    (await page.getByTestId('edit-food-per-serving').textContent())?.includes('Per serving: 140 cal'),
    'per-serving line reads 140 cal on first open'
  );

  const amount = page.getByTestId('edit-food-amount');
  await amount.fill('180'); // unit still "serving"
  assert(
    (await page.getByTestId('edit-food-calories').textContent())?.trim() === '25200',
    'entering 180 servings previews 25200 cal (the mistake)'
  );
  await page.screenshot({ path: `${OUT}edit-corruption-2-180-servings.png` });
  await page.getByRole('button', { name: /save changes/i }).click();
  await page.getByTestId('edit-food-per-serving').waitFor({ state: 'hidden', timeout: 10000 });

  const p1 = patches.at(-1) || {};
  assert(p1.serving_size === '180 serving (15300g)', 'PATCH persists the new serving_size string');
  assert(p1.servings === 180 && p1.calories === 25200, 'PATCH stores servings=180, totals=25200');
  assert(!('perServing' in p1) && p1.protein === 540, 'PATCH does not write mutated per-serving nutrition');

  // ---- Step 1b: reopen — food reference must be intact (no corruption) ----
  await entryButton.first().click();
  await page.getByTestId('edit-food-per-serving').waitFor({ state: 'visible', timeout: 10000 });
  assert(
    (await page.getByTestId('edit-food-per-serving').textContent())?.includes('Per serving: 140 cal'),
    'reopen after 180-servings save STILL reads 140 cal per serving (fix works)'
  );
  assert((await amount.inputValue()) === '180', 'reopen shows amount 180 (servings), not a fraction');
  await page.screenshot({ path: `${OUT}edit-corruption-3-reopen.png` });

  // ---- Step 2: correct to grams ----
  await page.getByTestId('edit-food-unit').selectOption('g');
  await amount.fill('180');
  const gramsCal = Number((await page.getByTestId('edit-food-calories').textContent())?.trim());
  assert(gramsCal >= 293 && gramsCal <= 299, `180 g previews ~296 cal (got ${gramsCal})`);
  await page.screenshot({ path: `${OUT}edit-corruption-4-180-grams.png` });
  await page.getByRole('button', { name: /save changes/i }).click();
  await page.getByTestId('edit-food-per-serving').waitFor({ state: 'hidden', timeout: 10000 });

  const p2 = patches.at(-1) || {};
  assert(p2.serving_size === '180g', 'grams PATCH persists serving_size "180g"');
  assert(!('perServing' in p2), 'grams PATCH does not mutate the food record');

  // ---- Step 3: reopen — displays "180 g", per-serving intact ----
  await entryButton.first().click();
  await page.getByTestId('edit-food-amount').waitFor({ state: 'visible', timeout: 10000 });
  assert((await amount.inputValue()) === '180', 'grams entry reopens showing 180');
  assert(
    (await page.getByTestId('edit-food-unit').inputValue()) === 'g',
    'grams entry reopens with the grams unit selected'
  );
  assert(
    (await page.getByTestId('edit-food-per-serving').textContent())?.includes('Per serving: 140 cal'),
    'grams entry reopens with per-serving reference still 140 cal'
  );
  await page.screenshot({ path: `${OUT}edit-corruption-5-grams-reopen.png` });

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
