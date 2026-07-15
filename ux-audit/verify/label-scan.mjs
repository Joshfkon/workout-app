/**
 * Playwright verification for the "Scan Label" flow (Add Food → Scan Label →
 * create-food form review → save).
 *
 * OCR is injected via the `window.__hypertrackMockLabelOcr` test hook (the
 * LabelScanner skips the tesseract.js WASM run when it's set), so the spec
 * exercises the real capture → parse → review → save pipeline without a
 * camera:
 *
 *  A. High-confidence scan: photo → form prefilled (macros + serving size,
 *     "Scanned" badges) → edit protein → save → custom_foods insert payload
 *     is correct.
 *  B. Low-confidence scan (protein misread, Atwater mismatch): review screen
 *     shows the warning + "Try AI scan" offer; offline disables the AI button
 *     with explanatory copy while manual entry stays reachable; "use anyway"
 *     lands in the form with the suspect field marked "Check".
 *
 * Run (server on :3000): node ux-audit/verify/label-scan.mjs
 */
import fs from 'node:fs';
import { BASE, json, newHarness } from './lib.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

const CLEAN_LABEL_TEXT = [
  'Nutrition Facts',
  '2 servings per container',
  'Serving size 1 Tray (340g)',
  'Calories 490',
  'Total Fat 20g 26%',
  'Saturated Fat 4.5g 23%',
  'Trans Fat 0g',
  'Cholesterol 55mg 18%',
  'Sodium 850mg 37%',
  'Total Carbohydrate 36g 13%',
  'Dietary Fiber 3g 11%',
  'Total Sugars 5g',
  'Protein 40g',
].join('\n');

// Same label with protein OCR-misread as 140g → Atwater mismatch (884 vs 490)
const PROTEIN_MISREAD_TEXT = CLEAN_LABEL_TEXT.replace('Protein 40g', 'Protein 140g');

// 1x1 white JPEG — the mock-OCR path never decodes it, it just needs a file.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

async function openLabelScanner(page) {
  await page.locator('button:has-text("Add Food")').first().click();
  await page.locator('button:has-text("Label")').first().click();
  await page.locator('[data-testid="label-scanner"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function injectPhoto(page) {
  await page.setInputFiles('[data-testid="label-photo-input"]', {
    name: 'label.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG,
  });
}

async function run() {
  const { browser, context, page } = await newHarness();

  // Capture custom_foods inserts; PostgREST .select().single() → one object.
  let insertedFood = null;
  await page.route('**/rest/v1/custom_foods**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      insertedFood = request.postDataJSON();
      return json(route, { id: 'cf-test-1', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z', ...insertedFood }, 201);
    }
    return json(route, []);
  });

  await page.goto(`${BASE}/dashboard/nutrition`, { waitUntil: 'domcontentloaded' });
  await page.locator('button:has-text("Add Food")').first().waitFor({ state: 'visible', timeout: 20000 });

  // ---------------------------------------------------------------------------
  // Scenario A: high-confidence scan → prefilled form → edit → save
  // ---------------------------------------------------------------------------
  await page.evaluate((text) => { window.__hypertrackMockLabelOcr = text; }, CLEAN_LABEL_TEXT);
  await openLabelScanner(page);
  await page.screenshot({ path: `${OUT}label-1-scanner.png` });
  await injectPhoto(page);

  const banner = page.locator('[data-testid="label-scan-banner"]');
  await banner.waitFor({ state: 'visible', timeout: 15000 });
  assert(true, 'high-confidence scan lands directly in the create-food form');
  await page.screenshot({ path: `${OUT}label-2-prefilled-form.png` });

  assert((await page.inputValue('[data-testid="custom-food-serving-size"]')) === '1 Tray (340g)', 'serving size prefilled from the label serving text');
  assert((await page.inputValue('[data-testid="custom-food-calories"]')) === '490', 'calories prefilled (490)');
  assert((await page.inputValue('[data-testid="custom-food-protein"]')) === '40', 'protein prefilled (40)');
  assert((await page.inputValue('[data-testid="custom-food-carbs"]')) === '36', 'carbs prefilled (36)');
  assert((await page.inputValue('[data-testid="custom-food-fat"]')) === '20', 'fat prefilled (20)');
  assert((await page.locator('[data-testid="scan-badge-protein"]').textContent()) === 'Scanned', 'scanned fields are visually marked');
  assert((await banner.textContent()).includes('review before saving'), 'banner says values are for review, never auto-saved');

  // Edit a field, name the food, save.
  await page.fill('[data-testid="custom-food-protein"]', '42');
  await page.fill('input[placeholder="e.g., Homemade Granola"]', 'Frozen Lasagna');
  await page.locator('button:has-text("Create")').click();
  await page.waitForTimeout(1000);

  assert(!!insertedFood, 'saving creates the custom food');
  if (insertedFood) {
    assert(insertedFood.food_name === 'Frozen Lasagna', 'saved name is the user-entered one');
    assert(insertedFood.serving_size === '1 Tray (340g)', 'saved serving size matches the label');
    assert(insertedFood.calories === 490, 'saved calories: 490');
    assert(insertedFood.protein === 42, 'saved protein reflects the user edit (42, not 40)');
    assert(insertedFood.carbs === 36 && insertedFood.fat === 20, 'saved carbs/fat match the scan');
  }
  await page.screenshot({ path: `${OUT}label-3-saved.png` });

  // ---------------------------------------------------------------------------
  // Scenario B: low-confidence scan → warnings + AI offer + offline behavior
  // ---------------------------------------------------------------------------
  await page.evaluate((text) => { window.__hypertrackMockLabelOcr = text; }, PROTEIN_MISREAD_TEXT);
  await openLabelScanner(page);
  await injectPhoto(page);

  const review = page.locator('[data-testid="label-scan-review"]');
  await review.waitFor({ state: 'visible', timeout: 15000 });
  assert(true, 'low-confidence scan stops at the review step instead of prefilled form');
  const reviewText = await review.textContent();
  assert(reviewText.includes('double-check protein'), 'Atwater warning names the suspect field (protein)');
  assert(await page.locator('[data-testid="label-try-ai"]').isEnabled(), 'AI fallback offered as a user-triggered choice');
  await page.screenshot({ path: `${OUT}label-4-low-confidence-review.png` });

  // Offline: AI disabled with copy; manual path still reachable.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert(await page.locator('[data-testid="label-try-ai"]').isDisabled(), 'AI scan button disabled while offline');
  assert((await review.textContent()).includes('offline'), 'offline state explained in plain copy');
  assert(await page.locator('[data-testid="label-enter-manually"]').isVisible(), 'manual entry stays reachable offline');
  await page.screenshot({ path: `${OUT}label-5-offline.png` });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Use the values anyway → suspect field arrives amber-marked in the form.
  await page.locator('[data-testid="label-use-anyway"]').click();
  await banner.waitFor({ state: 'visible', timeout: 15000 });
  assert((await banner.textContent()).includes('double-check protein'), 'form banner repeats the Atwater warning');
  assert((await page.locator('[data-testid="scan-badge-protein"]').textContent()) === 'Check', 'suspect field marked "Check" (amber) in the form');
  assert((await page.inputValue('[data-testid="custom-food-protein"]')) === '140', 'suspect value still shown for the user to correct');
  await page.screenshot({ path: `${OUT}label-6-low-confidence-form.png` });

  // ---------------------------------------------------------------------------
  // Barcode flow regression: shared Add Food sheet still opens the barcode tab
  // ---------------------------------------------------------------------------
  await page.locator('button[aria-label="Close"], button:has-text("Cancel")').first().click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('button:has-text("Add Food")').first().click();
  await page.locator('button:has-text("Barcode")').first().click();
  const barcodeOk = await page.locator('text=Scan Barcode').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
  assert(barcodeOk, 'barcode tab still renders its scanner (no regression)');
  await page.screenshot({ path: `${OUT}label-7-barcode-regression.png` });

  await browser.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
