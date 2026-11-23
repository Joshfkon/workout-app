#!/usr/bin/env node
/**
 * Re-render a pricing study's readout from its pricing.json (re-running the
 * aggregation, so analysis changes apply to old runs without new LLM calls).
 *
 *   node ux-panel/pricing/report.mjs ux-panel/runs/<id>   → runs/<id>/pricing-report.html
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPricingReport } from './render.mjs';
import { analyse, compareTiers } from './analysis.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node ux-panel/pricing/report.mjs <runDir>');
  process.exit(1);
}
const run = JSON.parse(await readFile(path.join(dir, 'pricing.json'), 'utf8'));
const design = { ggPrices: run.design.ggPrices, annualMultiples: run.design.annualMultiples, lifetimePrices: run.design.lifetimePrices, packages: run.design.packages, features: run.design.features };
const survey = run.responses.filter((r) => r.tier === 'survey');
const handsOn = run.responses.filter((r) => r.tier === 'hands-on');
run.analysis = { survey: analyse(survey, design) };
if (handsOn.length) {
  const ids = new Set(handsOn.map((r) => r.personaId));
  run.analysis.handsOn = analyse(handsOn, design);
  run.analysis.surveySubset = analyse(survey.filter((r) => ids.has(r.personaId)), design);
  run.analysis.tierAgreement = compareTiers(run.analysis.surveySubset, run.analysis.handsOn);
}
const out = path.join(dir, 'pricing-report.html');
await writeFile(out, renderPricingReport(run));
console.log(out);
