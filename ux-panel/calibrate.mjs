#!/usr/bin/env node
/**
 * Check the SSR anchors against real people. Pulls recent public App Store
 * reviews of comparable apps (text + the reviewer's own 1–5 stars), scores
 * each review with the panel's anchors, and reports how well the SSR score
 * tracks the stars.
 *
 *   node ux-panel/calibrate.mjs                 # Hevy, Strong, MacroFactor
 *   node ux-panel/calibrate.mjs --per-star=60 --refetch
 *
 * Free: the default local embedding model runs on this machine and no LLM is
 * called. Review text is cached in .cache/ (gitignored) and never committed;
 * only aggregate numbers are written to calibration/latest.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { QUESTIONS } from './anchors.mjs';
import { createEmbedder } from './lib/embed.mjs';
import { balanceByStars, calibrateQuestion } from './lib/calibration.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  return a === undefined ? dflt : a.includes('=') ? a.split('=').slice(1).join('=') : true;
};

/** Comparable apps (App Store ids). Override with --apps=name:id,name:id */
const DEFAULT_APPS = { Hevy: 1458862350, Strong: 464254577, MacroFactor: 1553503471 };
const apps = flag('apps') ? Object.fromEntries(String(flag('apps')).split(',').map((p) => p.split(':'))) : DEFAULT_APPS;
const perStar = Number(flag('per-star', 40));
const provider = String(flag('embed', 'local'));
const cacheDir = path.join(HERE, '.cache', 'calibration');

async function fetchReviews(app, id) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://itunes.apple.com/us/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;
    const res = await fetch(url);
    if (!res.ok) break;
    const entries = (await res.json())?.feed?.entry ?? [];
    const reviews = entries.filter((e) => e['im:rating']);
    if (!reviews.length) break;
    for (const e of reviews) {
      const text = `${e.title?.label ?? ''}. ${e.content?.label ?? ''}`.trim();
      out.push({ app, stars: Number(e['im:rating'].label), text });
    }
  }
  return out;
}

async function loadReviews() {
  const file = path.join(cacheDir, 'reviews.json');
  if (!flag('refetch')) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      /* fetch */
    }
  }
  await mkdir(cacheDir, { recursive: true });
  const all = [];
  for (const [app, id] of Object.entries(apps)) {
    const r = await fetchReviews(app, id);
    console.log(`  fetched ${r.length} ${app} reviews`);
    all.push(...r);
  }
  await writeFile(file, JSON.stringify(all));
  return all;
}

const fmt = (x, d = 2) => (x == null ? '  –  ' : x.toFixed(d));

async function main() {
  const reviews = (await loadReviews()).filter((r) => r.text.length >= 20 && r.stars >= 1 && r.stars <= 5);
  const embedder = await createEmbedder({ provider, cacheDir });
  console.log(`Embedding ${reviews.length} reviews with ${embedder.id}…`);
  const vecs = await embedder.embed(reviews.map((r) => r.text));
  reviews.forEach((r, i) => (r.vec = vecs[i]));

  // Interleave apps before balancing so each star bucket mixes apps.
  const byApp = Object.keys(apps).map((a) => reviews.filter((r) => r.app === a));
  const interleaved = [];
  for (let i = 0; byApp.some((l) => i < l.length); i++) for (const l of byApp) if (i < l.length) interleaved.push(l[i]);
  const balanced = balanceByStars(interleaved, perStar);

  const starCounts = [1, 2, 3, 4, 5].map((s) => reviews.filter((r) => r.stars === s).length);
  console.log(`\n${reviews.length} reviews (stars 1–5: ${starCounts.join(' / ')}); balanced sample: ${balanced.length} (≤ ${perStar} per star)\n`);

  const anchorsHash = createHash('sha1').update(JSON.stringify(QUESTIONS)).digest('hex').slice(0, 12);
  const result = { createdAt: new Date().toISOString(), embed: embedder.id, anchorsHash, apps, totalReviews: reviews.length, starCounts, perStar, questions: {} };
  for (const q of QUESTIONS) {
    const anchorVecs = await Promise.all(q.anchorSets.map((s) => embedder.embed(s)));
    const bal = calibrateQuestion(balanced, anchorVecs);
    const full = calibrateQuestion(reviews, anchorVecs);
    result.questions[q.id] = { label: q.label, spearman: bal.spearman, byStar: bal.byStar, monotonic: bal.monotonic, perSet: bal.perSet, apps: full.apps };
    console.log(`${q.id.padEnd(10)} Spearman ρ vs stars = ${fmt(bal.spearman)}   ${bal.monotonic ? 'monotonic' : 'NOT monotonic'}`);
    console.log(`           mean SSR score by star:  ${bal.byStar.map((b) => `${b.stars}★ ${fmt(b.meanScore)}`).join('  ')}`);
    console.log(`           per anchor set ρ:        ${bal.perSet.map((r) => fmt(r)).join('  ')}`);
    console.log(`           per app (all reviews):   ${full.apps.map((a) => `${a.app} KS ${fmt(a.ks)} (SSR ${fmt(a.predictedMean)} vs ★ ${fmt(a.actualMean)})`).join(' · ')}\n`);
  }
  const outDir = path.join(HERE, 'calibration');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'latest.json'), JSON.stringify(result, null, 2));
  console.log(`Saved ux-panel/calibration/latest.json (aggregates only, no review text).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
