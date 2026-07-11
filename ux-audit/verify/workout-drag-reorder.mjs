/**
 * workout-drag-reorder.mjs — 390px Playwright spec for drag-to-reorder in the
 * active-workout exercise list.
 *
 * REQUIRES A RUNNING APP on :3000 (see ./README.md for the build/start + auth
 * cookie setup). Intercepts the workout screen's session/blocks loads and the
 * reorder PATCH writes.
 *
 * Asserts the contract of the pointer-capture reorder:
 *   1. Pointer-down on a ☰ handle + a small move ENGAGES the drag — the drag
 *      state is visible (a floating drag-preview mounts, the picked-up row gets
 *      data-dragging) without any long-press wait.
 *   2. Dropping over a new slot PERSISTS the new order through the existing
 *      exercise_blocks reorder writes (two-pass PATCH of the `order` column).
 *   3. A reload RETAINS the reordered list (server now serves the new order).
 *
 * Stable contracts asserted: data-drag-handle, data-block-index,
 * data-dragging, and data-testid="drag-preview".
 */

import { newHarness, json, BASE } from './lib.mjs';

const SESSION_ID = 'sess-drag-e2e';
const out = './ux-audit/verify/screens/';

function results() {
  const list = [];
  const assert = (cond, msg) => {
    list.push(!!cond);
    console.log((cond ? 'PASS: ' : 'FAIL: ') + msg);
  };
  return { list, assert };
}

// Three exercises. Order is what the loader sorts by; block 1 is the current
// (main-list) card, blocks 2 & 3 render as compact "Up next" rows.
function blocksInOrder(order) {
  const byId = {
    'blk-a': { id: 'blk-a', exercise_id: 'ex-squat', name: 'Back Squat', primary_muscle: 'quads' },
    'blk-b': { id: 'blk-b', exercise_id: 'ex-bench', name: 'Bench Press', primary_muscle: 'chest' },
    'blk-c': { id: 'blk-c', exercise_id: 'ex-row', name: 'Barbell Row', primary_muscle: 'back' },
  };
  return order.map((id, i) => {
    const b = byId[id];
    return {
      id: b.id,
      exercise_id: b.exercise_id,
      order: i + 1,
      target_sets: 3,
      target_rep_range: [8, 12],
      target_rir: 2,
      exercises: { id: b.exercise_id, name: b.name, primary_muscle: b.primary_muscle, secondary_muscles: [], equipment_required: ['barbell'] },
      workout_sessions: { id: SESSION_ID, completed_at: null, user_id: 'test-user-id', state: 'in_progress' },
      set_logs: [],
    };
  });
}

async function main() {
  const { browser, page } = await newHarness();
  const { list, assert } = results();

  // Server-side "truth" for block order. The reorder PATCHes mutate it so a
  // reload reflects the persisted order.
  let serverOrder = ['blk-a', 'blk-b', 'blk-c'];
  const patchedOrders = []; // capture every { id, order } written

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

  await page.route('**/rest/v1/exercise_blocks**', (r) => {
    const req = r.request();
    if (req.method() === 'PATCH') {
      // Reorder write: URL carries id=eq.<blockId>, body carries { order }.
      const url = new URL(req.url());
      const idFilter = url.searchParams.get('id') || '';
      const id = idFilter.replace('eq.', '');
      let order = null;
      try { order = JSON.parse(req.postData() || '{}').order; } catch { /* noop */ }
      if (id && typeof order === 'number') {
        patchedOrders.push({ id, order });
        // Apply only the FINAL pass (1..n); ignore the parking offset (1001+).
        if (order <= 100) {
          const next = [...serverOrder];
          const from = next.indexOf(id);
          if (from !== -1) next.splice(from, 1);
          next.splice(Math.min(order - 1, next.length), 0, id);
          serverOrder = next;
        }
      }
      return json(r, []);
    }
    return json(r, blocksInOrder(serverOrder));
  });

  // The exercise rows are server-rendered, but the ☰ pointer handlers only work
  // once React has hydrated — settle the network and give hydration a beat so a
  // pointer-down actually engages the drag.
  const settle = async () => {
    await page.locator('[data-drag-handle]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
  };

  // --- Load the workout ----------------------------------------------------
  await page.goto(`${BASE}/dashboard/workout/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await settle();

  const NAMES = ['Back Squat', 'Bench Press', 'Barbell Row'];
  // Order by block-index, reading each row's own name out of its text (robust to
  // whether the name sits in the compact row or the expanded group header).
  const domOrder = () =>
    page.$$eval('[data-block-index]', (els, names) => {
      const seen = new Map();
      for (const el of els) {
        const i = Number(el.getAttribute('data-block-index'));
        if (seen.has(i)) continue;
        const txt = el.innerText || '';
        seen.set(i, names.find((n) => txt.includes(n)) || '?');
      }
      return [...seen.keys()].sort((a, b) => a - b).map((i) => seen.get(i));
    }, NAMES);

  const before = await domOrder();
  assert(before.join(',') === 'Back Squat,Bench Press,Barbell Row', `initial order: ${before.join(' → ')}`);

  // Reorder two adjacent "Up next" rows: drag block 2 (Barbell Row) up above
  // block 1 (Bench Press). Both live near the bottom of a tall page, so scroll
  // them into view first — off-viewport coordinates receive no pointer events.
  const rowB = page.locator('[data-block-index="1"]');
  const rowC = page.locator('[data-block-index="2"]');
  await rowC.scrollIntoViewIfNeeded();
  const handleC = rowC.locator('[data-drag-handle]');
  const hBox = await handleC.boundingBox();
  const bBox = await rowB.boundingBox();
  const startX = hBox.x + hBox.width / 2;
  const startY = hBox.y + hBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // ~12px move crosses the ~8px activation threshold — drag engages, no long-press.
  await page.mouse.move(startX, startY - 12, { steps: 3 });

  const preview = page.getByTestId('drag-preview');
  await preview.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  assert(await preview.isVisible().catch(() => false), 'drag ENGAGED on pointer-down + ~12px: floating drag-preview mounted (no long-press)');
  const draggingCount = await page.locator('[data-block-index][data-dragging="true"]').count();
  assert(draggingCount === 1, 'exactly one row marked data-dragging while dragging');
  await page.screenshot({ path: `${out}drag-1-engaged.png` });

  // Move up past block 1's midpoint and drop.
  await page.mouse.move(startX, bBox.y + 2, { steps: 6 });
  await page.mouse.up();

  await preview.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  assert(!(await preview.isVisible().catch(() => false)), 'drag-preview removed on drop');

  // Persistence runs async off the drop (two-pass PATCH of the `order` column);
  // wait for the final pass to land before asserting on it.
  const deadline = Date.now() + 5000;
  while (patchedOrders.filter((p) => p.order <= 100).length < 3 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }

  // --- Order persisted through the existing reorder writes ------------------
  const finalPass = patchedOrders.filter((p) => p.order <= 100);
  assert(finalPass.length >= 3, `reorder persisted via exercise_blocks PATCH (${finalPass.length} final-order writes)`);
  assert(serverOrder.join(',') === 'blk-a,blk-c,blk-b', `Barbell Row moved above Bench Press server-side (order: ${serverOrder.join(', ')})`);

  // Optimistic local order updated immediately (no reload needed).
  const afterDrop = await domOrder();
  assert(afterDrop[1] === 'Barbell Row', `optimistic reorder in the DOM: ${afterDrop.join(' → ')}`);

  // --- Reload retains the persisted order ----------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  const afterReload = await domOrder();
  assert(afterReload.join(',') === 'Back Squat,Barbell Row,Bench Press', `order retained after reload: ${afterReload.join(' → ')}`);
  await page.screenshot({ path: `${out}drag-2-reloaded.png` });

  await browser.close();
  const passed = list.filter(Boolean).length;
  console.log(`\n${passed}/${list.length} checks passed`);
  process.exit(passed === list.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
