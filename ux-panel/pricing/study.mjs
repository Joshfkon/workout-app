/**
 * The pricing study runner (PRICING_STUDY.md), reached through
 *
 *   node ux-panel/run.mjs --study=pricing [--n=100] [--seed=1] [--hands-on=N] --model=… --base-url=…
 *
 * Tier A (survey, every persona): no browsing. Each persona reads the tour
 * (pricing/tour.mjs) and answers four question blocks; four calls per
 * persona, each a fresh request sharing a cached prefix (system prompt with
 * the competitor list, then the tour).
 *
 * Tier B (--hands-on=N): a quota-balanced subset of N personas first uses
 * the real local app for the core journeys plus the end-of-week review (a
 * normal panel run, as a child `run.mjs --persona-file=…`, so it is exactly
 * the panel's own code path), then answers the same four blocks with a
 * digest of their week added.
 *
 * Output: runs/<id>/pricing.json and runs/<id>/pricing-report.html.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { samplePricingPersonas, quotaBalancedSubset, QUOTAS } from '../personas/pricing.mjs';
import { JOURNEYS, personaRunsJourney } from '../journeys.mjs';
import { anthropicLLM, Ledger, PRICES, toolUses } from '../lib/llm.mjs';
import { createEmbedder } from '../lib/embed.mjs';
import { ssrPmf, cosine, SHARP_TEMPERATURE } from '../lib/ssr.mjs';
import { estimateCost } from '../lib/cost.mjs';
import { tourBlocks, TOUR } from './tour.mjs';
import { PRICING_QUESTIONS, pricingAnchorHashes } from './anchors.mjs';
import { parseVanWestendorp, parseVariantChoice, normaliseRanking, parseStance } from './parse.mjs';
import { analyse, acceptableMonthly, compareTiers, saidYes } from './analysis.mjs';
import { pricingFakeLLM } from './fake.mjs';
import { renderPricingReport } from './render.mjs';
import {
  COMPETITORS,
  GG_PRICES,
  ANNUAL_MULTIPLES,
  LIFETIME_PRICES,
  PACKAGES,
  RANKABLE_FEATURES,
  ONE_THING_LABELS,
  VW_TOOL,
  GG_TOOL,
  PLANS_TOOL,
  PACKAGES_TOOL,
  QUESTION_TEXT,
  surveySystemPrompt,
  personaBrief,
  ggOrder,
  annualOffers,
  to99,
} from './questions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(HERE, '..');
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

export const DESIGN = { ggPrices: GG_PRICES, annualMultiples: ANNUAL_MULTIPLES, lifetimePrices: LIFETIME_PRICES, packages: PACKAGES, features: RANKABLE_FEATURES };

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * Per survey call: a shared prefix (system ≈ 0.5k + the tour ≈ 6 × 0.45k image
 * tokens + 1k caption text ≈ 4k) that caches across personas, plus the
 * persona brief and question (≈ 1.3k; +0.8k for the hands-on week digest),
 * and ≈ 700 output tokens (answers plus low-effort thinking). Expected assumes
 * cache reads on the shared prefix; "at most" assumes no caching and 1.5×
 * the output. Not yet calibrated on a real run.
 */
export const PRICING_TOKENS = { sharedIn: 4000, ownIn: 1300, digestIn: 800, out: 700, callsPerPersona: 4 };

export function estimatePricingCost({ n, handsOnPersonas = [], model, tokens = PRICING_TOKENS }) {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const call = (extraIn = 0) => ({
    expected: ((tokens.ownIn + extraIn) * p.input + tokens.sharedIn * p.cacheRead + tokens.out * p.output) / 1e6,
    high: ((tokens.sharedIn + tokens.ownIn + extraIn) * p.input + tokens.out * 1.5 * p.output) / 1e6,
  });
  const survey = call();
  const cacheWrites = (4 * tokens.sharedIn * p.input * 1.25) / 1e6; // one write per question block
  const surveyCalls = n * tokens.callsPerPersona;
  const out = {
    survey: { calls: surveyCalls, expected: surveyCalls * survey.expected + cacheWrites, high: surveyCalls * survey.high },
    handsOn: null,
  };
  if (handsOnPersonas.length) {
    const tasks = handsOnPersonas.flatMap((pp) => JOURNEYS.filter((j) => personaRunsJourney(pp, j)));
    const weekReviews = handsOnPersonas.filter((pp) => JOURNEYS.filter((j) => personaRunsJourney(pp, j)).length >= 2).length;
    const panel = estimateCost({ tasks, personas: handsOnPersonas, model, weekReviews });
    const d = call(tokens.digestIn);
    const calls = handsOnPersonas.length * tokens.callsPerPersona;
    out.handsOn = {
      sessions: tasks.length,
      weekReviews,
      steps: panel.steps,
      expected: panel.expected + calls * d.expected,
      high: panel.high + calls * d.high,
    };
  }
  out.expected = out.survey.expected + (out.handsOn?.expected ?? 0);
  out.high = out.survey.high + (out.handsOn?.high ?? 0);
  return out;
}

export function formatPricingEstimate(e, { model, n, handsOn }) {
  return [
    `Pricing study cost estimate (${model}):`,
    `  survey:   ${n} personas × ${PRICING_TOKENS.callsPerPersona} calls = ${e.survey.calls} calls · expected ≈ $${e.survey.expected.toFixed(2)} · at most ≈ $${e.survey.high.toFixed(2)}`,
    e.handsOn
      ? `  hands-on: ${handsOn} personas, ${e.handsOn.sessions} app sessions (~${e.handsOn.steps.expected}–${e.handsOn.steps.max} agent steps) + ${e.handsOn.weekReviews} week reviews + pricing questions · expected ≈ $${e.handsOn.expected.toFixed(2)} · at most ≈ $${e.handsOn.high.toFixed(2)}`
      : '  hands-on: none (--hands-on=N adds a quota-balanced subset that uses the real app first)',
    `  total:    expected ≈ $${e.expected.toFixed(2)} · at most ≈ $${e.high.toFixed(2)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/** One question block: shared cached prefix (system + tour), then the persona and the question. */
export async function askBlock({ llm, tool, persona, tour, question, digest = '' }) {
  const tourContent = tour.blocks.map((b, i) => (i === tour.blocks.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b));
  const brief = [personaBrief(persona), digest, question].filter(Boolean).join('\n\n');
  const params = {
    system: [{ type: 'text', text: surveySystemPrompt(), cache_control: { type: 'ephemeral' } }],
    tools: [tool],
    messages: [{ role: 'user', content: [...tourContent, { type: 'text', text: brief }] }],
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await llm.call(params);
    const use = toolUses(msg).find((u) => u.name === tool.name);
    if (use) return use.input;
    params.messages[0].content.at(-1).text = `${brief}\n\nAnswer using the ${tool.name} tool.`;
  }
  throw new Error(`persona did not answer with ${tool.name}`);
}

/**
 * Score a block of would-buy verdicts ({answer, why} per key). Only the
 * one-sentence `answer` is embedded. `yes` is the per-persona call: the
 * stance the answer opens with when it is clear, else the sharp SSR score.
 * @param {Array<[string|number, {answer?: string, why?: string}|string|undefined]>} entries
 */
export async function scoreVerdicts(entries, qid, score) {
  const out = { answers: {}, why: {}, scores: {}, sharp: {}, stance: {}, yes: {} };
  for (const [key, raw] of entries) {
    const text = (typeof raw === 'string' ? raw : raw?.answer) ?? '';
    const s = await score(text, qid);
    const stance = parseStance(text);
    out.answers[key] = text;
    out.why[key] = typeof raw === 'object' ? raw?.why ?? '' : '';
    out.scores[key] = s.pmf;
    out.sharp[key] = s.sharp;
    out.stance[key] = stance;
    out.yes[key] = stance ? stance === 'yes' : saidYes(s.sharp);
  }
  return out;
}

/**
 * Ask one persona all four blocks and score the answers.
 * `score(text, questionId)` → {pmf, sharp}; `nearestLabel(text)` → label.
 */
export async function surveyPersona({ llm, persona, tour, seed, tier = 'survey', digest = '', score, nearestLabel }) {
  const rec = { personaId: persona.id, tier, segment: persona.pricing.segment, experience: persona.pricing.experienceLevel };

  const vwAnswers = await askBlock({ llm, tool: VW_TOOL, persona, tour, digest, question: QUESTION_TEXT.vw() });
  // The text is kept beside every parsed number (and how it was read).
  const { parsed, ...vw } = parseVanWestendorp(vwAnswers);
  rec.vw = { answers: vwAnswers, ...vw, kinds: Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v.kind])) };

  const order = ggOrder(persona.id, seed);
  const ggRaw = await askBlock({ llm, tool: GG_TOOL, persona, tour, digest, question: QUESTION_TEXT.gg(order) });
  const ords = ['first', 'second', 'third', 'fourth', 'fifth'];
  rec.gg = { order, ...(await scoreVerdicts(order.map((price, i) => [price, ggRaw[ords[i]]]), 'subscribe', score)) };

  // The persona's acceptable monthly price: the highest Gabor-Granger price
  // they said yes to, else their Van Westendorp "bargain", else the lowest
  // tested price.
  const ggYes = acceptableMonthly(rec.gg.yes, GG_PRICES);
  rec.acceptableMonthly = ggYes ?? (rec.vw.valid && rec.vw.cheap > 0 ? to99(rec.vw.cheap) : GG_PRICES[0]);
  rec.acceptableSource = ggYes != null ? 'gabor-granger' : rec.vw.valid && rec.vw.cheap > 0 ? 'van-westendorp' : 'lowest-tested';
  const offers = annualOffers(rec.acceptableMonthly);
  const plans = await askBlock({ llm, tool: PLANS_TOOL, persona, tour, digest, question: QUESTION_TEXT.plans(rec.acceptableMonthly, ggYes != null) });
  rec.annual = { offers, ...(await scoreVerdicts(ANNUAL_MULTIPLES.map((m) => [m, plans[`annual_${m}x`]]), 'annual', score)) };
  rec.lifetime = await scoreVerdicts(LIFETIME_PRICES.map((x) => [x, plans[`lifetime_${Math.floor(x)}`]]), 'lifetime', score);

  const pk = await askBlock({ llm, tool: PACKAGES_TOOL, persona, tour, digest, question: QUESTION_TEXT.packages() });
  rec.packages = await scoreVerdicts(PACKAGES.map((v) => [v.id, pk[v.id.toLowerCase()]]), 'package', score);
  rec.packages.choiceText = pk.choice ?? '';
  rec.packages.choice = parseVariantChoice(pk.choice);
  rec.packages.ranking = normaliseRanking(pk.feature_ranking, RANKABLE_FEATURES);
  rec.packages.oneThing = pk.one_thing ?? '';
  rec.packages.oneThingLabel = pk.one_thing ? await nearestLabel(pk.one_thing) : null;
  return rec;
}

/** What a hands-on persona did in the app, for their pricing prompts. */
export function handsOnDigest(run, personaId) {
  const sessions = (run.results ?? []).filter((r) => r.personaId === personaId);
  if (!sessions.length) return '';
  const week = (run.weekReviews ?? []).find((w) => w.personaId === personaId)?.review;
  const lines = sessions.map((r) => {
    const how = r.outcome === 'completed' ? 'got it done' : r.outcome === 'gave_up' ? 'gave up' : 'it errored';
    return `- ${run.journeyLabels?.[r.journeyId] ?? r.journeyId}: you ${how}. ${[r.summary, r.review?.liked && `Liked: ${r.review.liked}`, r.review?.confusing && `Bothered you: ${r.review.confusing}`].filter(Boolean).join(' ')}`;
  });
  // The week verdict's pay_price answer named today's Pro price; leaving it
  // out keeps that number from anchoring the price questions.
  return [
    `You have now used HyperTrack yourself for a week (the real app, not just the tour):\n${lines.join('\n')}`,
    week ? `Your end-of-week verdict: ${week.switch} ${week.switch_why ?? ''} Best thing: ${week.best}. Dealbreaker: ${week.dealbreaker}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * @param {{n:number, seed:string|number, handsOn:number, model:string, effort:string, baseUrl:string, embed:string,
 *   yes:boolean, fake:boolean, estimateOnly:boolean, concurrency:number, label:string, out?:string, gitSha?:string,
 *   allowRemotePreview?:boolean, headed?:boolean}} opts
 */
export async function runPricingStudy(opts) {
  const host = new URL(opts.baseUrl).hostname;
  if (opts.handsOn > 0 && !['localhost', '127.0.0.1'].includes(host) && !opts.allowRemotePreview) {
    throw new Error(`--base-url ${opts.baseUrl} is not local. Hands-on runs use the local build only; never production.`);
  }
  const personas = samplePricingPersonas({ n: opts.n, seed: opts.seed });
  const handsOnPersonas = opts.handsOn > 0 ? quotaBalancedSubset(personas, opts.handsOn) : [];
  const estimate = estimatePricingCost({ n: personas.length, handsOnPersonas, model: opts.model });
  console.log(formatPricingEstimate(estimate, { model: opts.model, n: personas.length, handsOn: handsOnPersonas.length }));
  if (opts.estimateOnly) return { estimate };
  if (!opts.fake && !opts.yes) {
    if (!process.stdin.isTTY) {
      console.log('Not spending without confirmation: rerun with --yes (or interactively).');
      return { estimate };
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Spend up to ~$${estimate.high.toFixed(2)} of Anthropic credit on this study? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Cancelled; nothing was spent.');
      return { estimate };
    }
  }

  const ledger = new Ledger();
  const llm = opts.fake ? pricingFakeLLM({ ledger }) : anthropicLLM({ model: opts.model, effort: opts.effort, ledger });
  if (!opts.fake) {
    try {
      await llm.call({ max_tokens: 16, messages: [{ role: 'user', content: 'Reply with: ok' }] });
    } catch (e) {
      throw new Error(`Anthropic API check failed, nothing was run: ${e?.message ?? e}`);
    }
  }

  const runId = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${sha(`${process.pid}:${Date.now()}:pricing`).slice(0, 4)}`;
  const runDir = path.resolve(opts.out || path.join(PANEL, 'runs', runId));
  await mkdir(runDir, { recursive: true });

  // Scoring: anchors embedded once; answers embedded (and cached) as they come.
  const embedder = await createEmbedder({ provider: opts.embed, cacheDir: path.join(PANEL, '.cache') });
  const anchorVecs = {};
  for (const q of PRICING_QUESTIONS) anchorVecs[q.id] = await Promise.all(q.anchorSets.map((set) => embedder.embed(set)));
  const labelVecs = await embedder.embed(ONE_THING_LABELS);
  const score = async (text, qid) => {
    const [v] = await embedder.embed([text || '(no answer)']);
    return { pmf: ssrPmf(v, anchorVecs[qid]), sharp: ssrPmf(v, anchorVecs[qid], { temperature: SHARP_TEMPERATURE }) };
  };
  const nearestLabel = async (text) => {
    const [v] = await embedder.embed([text]);
    let best = 0;
    labelVecs.forEach((lv, i) => (cosine(lv, v) > cosine(labelVecs[best], v) ? (best = i) : null));
    return ONE_THING_LABELS[best];
  };

  const tour = tourBlocks();
  console.log(`Tour: ${tour.mode === 'images' ? 'screenshots' : 'captions + key visible text (no screenshots captured; see pricing/capture-tour.mjs)'}`);

  const responses = [];
  const errors = [];
  let fatal = '';
  async function pool(list, tier, digestOf = () => '') {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
        while (next < list.length && !fatal) {
          const persona = list[next++];
          try {
            const rec = await surveyPersona({ llm, persona, tour, seed: opts.seed, tier, digest: digestOf(persona), score, nearestLabel });
            responses.push(rec);
            console.log(`  ${tier.padEnd(8)} ${persona.id}  [$${ledger.dollars().toFixed(2)} so far]`);
          } catch (e) {
            const msg = e?.error?.error?.message || e?.message || String(e);
            errors.push({ personaId: persona.id, tier, error: msg });
            console.log(`  ${tier.padEnd(8)} ${persona.id} failed: ${msg}`);
            if ([401, 403].includes(e?.status) || /credit balance|billing|invalid x-api-key|authentication/i.test(msg)) fatal = msg;
          }
        }
      }),
    );
  }

  const write = async (extra = {}) => {
    const byTier = (t) => responses.filter((r) => r.tier === t).sort((a, b) => a.personaId.localeCompare(b.personaId));
    const survey = byTier('survey');
    const handsOn = byTier('hands-on');
    const subsetIds = new Set(handsOn.map((r) => r.personaId));
    const analysis = { survey: analyse(survey, DESIGN) };
    if (handsOn.length) {
      analysis.handsOn = analyse(handsOn, DESIGN);
      analysis.surveySubset = analyse(survey.filter((r) => subsetIds.has(r.personaId)), DESIGN);
      analysis.tierAgreement = compareTiers(analysis.surveySubset, analysis.handsOn);
    }
    const out = {
      schema: 1,
      study: 'pricing',
      runId,
      label: opts.label,
      createdAt: new Date().toISOString(),
      gitSha: opts.gitSha ?? '',
      model: opts.fake ? 'fake' : opts.model,
      embed: embedder.id,
      seed: opts.seed,
      n: personas.length,
      quotas: QUOTAS,
      tour: { mode: tour.mode, screens: TOUR.map(({ id, title, caption, image }) => ({ id, title, caption, image })) },
      anchorHashes: pricingAnchorHashes(),
      sharpTemperature: SHARP_TEMPERATURE,
      design: { competitors: COMPETITORS, ggPrices: GG_PRICES, annualMultiples: ANNUAL_MULTIPLES, lifetimePrices: LIFETIME_PRICES, packages: PACKAGES, features: RANKABLE_FEATURES },
      personas: personas.map((p) => ({ id: p.id, name: p.name, age: p.age, summary: p.summary, pricing: p.pricing })),
      handsOnPersonas: handsOnPersonas.map((p) => p.id),
      responses: [...survey, ...handsOn],
      errors,
      analysis,
      estimate,
      cost: ledger.toJSON(),
      ...extra,
    };
    await writeFile(path.join(runDir, 'pricing.json'), JSON.stringify(out, null, 1));
    await writeFile(path.join(runDir, 'pricing-report.html'), renderPricingReport(out));
    return out;
  };

  console.log(`Survey: ${personas.length} personas → ${path.relative(process.cwd(), runDir)}`);
  await pool(personas, 'survey');
  let result = await write();
  if (fatal) throw new Error(`Stopped early: ${fatal}`);

  if (handsOnPersonas.length) {
    const handsDir = path.join(runDir, 'hands-on');
    await mkdir(handsDir, { recursive: true });
    const personaFile = path.join(handsDir, 'personas.json');
    await writeFile(personaFile, JSON.stringify({ personas: handsOnPersonas }, null, 1));
    console.log(`\nHands-on: ${handsOnPersonas.length} personas use the local app first (core journeys + week review)…`);
    const args = [
      path.join(PANEL, 'run.mjs'),
      `--persona-file=${personaFile}`,
      '--personas=all',
      '--journeys=core',
      `--out=${handsDir}`,
      `--model=${opts.model}`,
      `--effort=${opts.effort}`,
      `--base-url=${opts.baseUrl}`,
      `--embed=${opts.embed}`,
      `--concurrency=${Math.min(opts.concurrency, 2)}`,
      `--label=pricing hands-on ${runId}`,
      '--yes',
      ...(opts.fake ? ['--fake-llm'] : []),
      ...(opts.allowRemotePreview ? ['--allow-remote-preview'] : []),
      ...(opts.headed ? ['--headed'] : []),
    ];
    const code = await new Promise((resolve) => spawn(process.execPath, args, { stdio: 'inherit' }).on('exit', resolve));
    const runFile = path.join(handsDir, 'run.json');
    if (code !== 0 || !existsSync(runFile)) {
      result = await write({ handsOnError: `hands-on panel run exited with code ${code}` });
      throw new Error(`Hands-on panel run failed (exit ${code}); the survey results are saved in ${runDir}.`);
    }
    const handsRun = JSON.parse(await readFile(runFile, 'utf8'));
    await pool(handsOnPersonas, 'hands-on', (p) => handsOnDigest(handsRun, p.id));
    result = await write({ handsOnRun: { dir: 'hands-on', runId: handsRun.runId, cost: handsRun.cost } });
  }

  const rec = result.analysis.survey.recommendation;
  console.log(`\nDone. ${result.responses.length} response sets (${errors.length} failed) · cost ≈ $${(ledger.dollars() + (result.handsOnRun?.cost?.dollars ?? 0)).toFixed(2)}`);
  console.log(`Recommendation (relative, not a forecast): ${rec.summary}`);
  console.log(`Data:   ${path.relative(process.cwd(), path.join(runDir, 'pricing.json'))}`);
  console.log(`Report: ${path.relative(process.cwd(), path.join(runDir, 'pricing-report.html'))}`);
  return result;
}
