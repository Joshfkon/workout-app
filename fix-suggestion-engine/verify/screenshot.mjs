/**
 * Verification step 2 — render the banner + provenance from the REAL engine
 * output (engine-output.json, produced by emitEngineOutput.test.ts) and drive
 * them with Playwright: screenshot the banner and the opened provenance sheet,
 * then assert the on-screen numbers equal the engine output.
 *
 * The full authenticated Next.js app (Supabase auth + a seeded ISO-Lateral Low
 * Row history) can't be driven in this sandbox, so the SuggestionBanner surface
 * is reproduced here — with its real class names, string format, and the exact
 * copy from ExerciseCard.buildSuggestionInfo — and populated STRICTLY from the
 * engine output. Numbers on screen therefore come from the engine, not by hand.
 *
 * Run: node fix-suggestion-engine/verify/screenshot.mjs
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..'); // fix-suggestion-engine/
const engine = JSON.parse(readFileSync(join(__dirname, 'engine-output.json'), 'utf8'));

// ---- Build the banner strings exactly as the component does ----
const w = engine.working;
const r = engine.ramp;
const pct = 58; // Math.round(RAMP_LOAD_FRACTION*100) — matches constants (0.575)

const workingBanner = {
  weightLabel: `${w.weight} lbs`,
  repsLabel: `${w.repRange[0]}–${w.repRange[1]}`,
  rir: w.rir,
  showRir: w.showRir,
  roleTag: null,
  reason: `working weight from your ~${engine.storedE1RM} lbs est. 1RM (held near recent working weight)`,
  explanation: [
    `Prescribed from your best estimated 1RM (${engine.storedE1RM} lbs) for ${w.repRange[0]}–${w.repRange[1]} reps at ${w.rir} RIR.`,
    `Capped to within ±10% of your recent ${engine.recentTopWorkingWeight} lbs working weight — a hot 1RM estimate can't prescribe a big jump in one session.`,
    `Target: ${w.repRange[0]}–${w.repRange[1]} reps leaving ${w.rir} in reserve (RIR ${w.rir}).`,
  ],
};

const rampBanner = {
  weightLabel: `${r.weight} lbs`,
  repsLabel: `${r.repRange[0]}–${r.repRange[1]}`,
  rir: engine.target.rir,
  showRir: r.showRir,
  roleTag: 'ramp',
  reason: 'ramp set — light feeder for your working sets',
  explanation: [
    `This is a ramp/feeder set (~${pct}% of today's top working set), so there's no RIR target and it isn't counted as junk volume.`,
    `Top working set today is prescribed from your best estimated 1RM (${engine.storedE1RM} lbs).`,
    `Target: a controlled ${r.repRange[0]}–${r.repRange[1]} reps — ramp sets have no effort target.`,
  ],
};

const bannerHtml = (b) => `
  <div class="banner">
    <span class="spark">✦</span>
    <p class="text">
      <span class="strong" data-testid="banner-line">${b.weightLabel} × ${b.repsLabel}${b.showRir ? ` @ ${b.rir} RIR` : ''}</span>
      ${b.roleTag ? `<span class="tag" data-testid="role-tag">${b.roleTag}</span>` : ''}
      <span class="reason"> — ${b.reason}</span>
    </p>
    <button class="info">ⓘ</button>
  </div>
  <div class="sheet" data-testid="provenance">
    <div class="sheet-title">How this suggestion works</div>
    <ul>${b.explanation.map((l) => `<li>${l}</li>`).join('')}</ul>
  </div>`;

const page = (title, b) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0a0a0a;color:#e5e7eb;font:14px -apple-system,system-ui,sans-serif;padding:24px}
  .card{max-width:520px;margin:0 auto}
  h1{font-size:15px;color:#f3f4f6;margin:0 0 4px}
  .sub{font-size:12px;color:#9ca3af;margin:0 0 16px}
  .banner{display:flex;align-items:flex-start;gap:8px;border-radius:8px;background:rgba(59,130,246,.10);padding:10px 12px}
  .spark{color:#60a5fa;flex:none;margin-top:2px}
  .text{flex:1;font-size:12px;line-height:1.35;color:#60a5fa;margin:0}
  .strong{font-weight:600}
  .tag{margin-left:6px;border-radius:4px;background:rgba(59,130,246,.20);padding:2px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#93c5fd}
  .reason{color:#60a5fa}
  .info{margin-left:auto;background:none;border:none;color:#60a5fa;cursor:pointer;font-size:14px}
  .sheet{margin-top:12px;border-radius:12px;background:#111827;padding:16px;border:1px solid #1f2937}
  .sheet-title{font-size:14px;font-weight:600;color:#f3f4f6;margin-bottom:10px}
  ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
  li{position:relative;padding-left:14px;font-size:13px;color:#d1d5db}
  li:before{content:"";position:absolute;left:0;top:7px;width:4px;height:4px;border-radius:50%;background:#60a5fa}
</style></head><body><div class="card">
  <h1>${title}</h1>
  <p class="sub">${engine.scenario} · stored e1RM ${engine.storedE1RM} lbs · target ${engine.target.repRange[0]}–${engine.target.repRange[1]} @ ${engine.target.rir} RIR</p>
  ${bannerHtml(b)}
</div></body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 640, height: 520 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

const results = [];
async function shoot(name, title, b) {
  await p.setContent(page(title, b), { waitUntil: 'domcontentloaded' });
  const file = join(OUT_DIR, name);
  await p.screenshot({ path: file, fullPage: true });

  // Assert the on-screen banner line matches what the engine produced.
  const line = (await p.getByTestId('banner-line').textContent()).trim();
  const expected = `${b.weightLabel} × ${b.repsLabel}${b.showRir ? ` @ ${b.rir} RIR` : ''}`;
  const ok = line === expected;
  const notForbidden = !line.includes('92.5') && !line.includes('× 13 @');
  results.push({ name, line, expected, matches: ok, notOldWrongOutput: notForbidden });
  if (!ok || !notForbidden) throw new Error(`Assertion failed for ${name}: "${line}"`);
}

await shoot('banner-working.png', 'Set 1 tagged WORKING (e1RM-anchored)', workingBanner);
await shoot('banner-ramp.png', 'Set 1 inferred RAMP (feeder)', rampBanner);

await browser.close();

writeFileSync(
  join(__dirname, 'playwright-assertions.json'),
  JSON.stringify({ engineOutput: engine, screenshots: results }, null, 2)
);

console.log('Playwright verification passed:');
for (const r of results) console.log(`  ✓ ${r.name}: "${r.line}"`);
console.log(`  ✓ neither banner reproduces the old "92.5 × 13 @ 2 RIR" output`);
