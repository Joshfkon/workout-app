#!/usr/bin/env node
/**
 * Synthetic user panel — run personas through journeys against a LOCAL build
 * and write a readout. See ux-panel/README.md.
 *
 *   node ux-panel/run.mjs --dry-run --fake-llm        free pipeline check (2 personas × 1 journey)
 *   node ux-panel/run.mjs --dry-run                    2 × 1 with the real model (asks before spending)
 *   node ux-panel/run.mjs --personas=6 --journeys=core --label="build 7"
 *   node ux-panel/run.mjs --journeys=stories           persona user stories (generated once, reused)
 *   node ux-panel/run.mjs --estimate                   print the cost estimate and exit
 */
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { JOURNEYS, journeyById } from './journeys.mjs';
import { QUESTIONS } from './anchors.mjs';
import { adminClient, createAccount, newCredentials, seedReturningUser, tagAccount, assertLocalSupabase } from './lib/accounts.mjs';
import { runJourney, writeReview, LENSES } from './lib/agent.mjs';
import { anthropicLLM, fakeLLM, Ledger, DEFAULT_MODEL } from './lib/llm.mjs';
import { createEmbedder } from './lib/embed.mjs';
import { ssrPmf } from './lib/ssr.mjs';
import { aggregateScores, clusterFrictions, completionRates } from './lib/aggregate.mjs';
import { ensureStories, storyToJourney } from './lib/stories.mjs';
import { writeReadout, plainReadout } from './lib/readout.mjs';
import { problemsToFrictions } from './lib/issues.mjs';
import { renderReport } from './lib/report.mjs';
import { estimateCost, formatEstimate } from './lib/cost.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const DRY = !!flag('dry-run');
const FAKE = !!flag('fake-llm');
const opts = {
  baseUrl: flag('base-url', 'http://localhost:3100'),
  model: flag('model', DEFAULT_MODEL),
  effort: flag('effort', 'low'),
  embed: flag('embed', 'local'),
  label: flag('label', ''),
  lens: flag('lens', '') || null,
  concurrency: Number(flag('concurrency', 2)),
  personas: flag('personas', DRY ? '2' : 'all'),
  journeys: flag('journeys', DRY ? 'log-meal' : 'core'),
  storiesPerPersona: Number(flag('stories-per-persona', 3)),
  regenStories: !!flag('regen-stories'),
  yes: !!flag('yes'),
  estimateOnly: !!flag('estimate'),
  readout: !flag('no-readout'),
  reuse: flag('reuse', ''),
  rerun: String(flag('rerun', '')).split(',').filter(Boolean),
};

// ---------- env (.env.local, never printed) ----------
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile(path.join(REPO, '.env.local'));

const taskIdOf = (persona, journey) => `${persona.id}__${journey.id.replace(/[^a-z0-9-]+/gi, '_')}`;

/**
 * --reuse=<runDir>: keep a previous run's session when it finished cleanly
 * (completed or gave up, no local-environment errors), so fixing the test
 * environment only costs the sessions it broke.
 */
function reusableResult(reuseDir, taskId) {
  if (!reuseDir || opts.rerun.includes(taskId)) return null;
  const file = path.join(reuseDir, 'tasks', taskId, 'result.json');
  if (!existsSync(file)) return null;
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  return ['completed', 'gave_up'].includes(rec.outcome) && !(rec.envErrors ?? []).length && rec.review ? rec : null;
}

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

async function main() {
  const host = new URL(opts.baseUrl).hostname;
  if (!['localhost', '127.0.0.1'].includes(host) && !flag('allow-remote-preview')) {
    throw new Error(`--base-url ${opts.baseUrl} is not local. The panel runs against \`npm run dev\` (or a preview with --allow-remote-preview); never production.`);
  }
  assertLocalSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://missing');
  if (opts.lens && !LENSES[opts.lens]) throw new Error(`unknown --lens=${opts.lens} (available: ${Object.keys(LENSES).join(', ')})`);

  const { personas: allPersonas } = JSON.parse(await readFile(path.join(HERE, 'personas.json'), 'utf8'));
  const personas =
    opts.personas === 'all'
      ? allPersonas
      : /^\d+$/.test(opts.personas)
        ? allPersonas.slice(0, Number(opts.personas))
        : opts.personas.split(',').map((id) => allPersonas.find((p) => p.id === id) ?? (() => { throw new Error(`unknown persona ${id}`); })());

  const ledger = new Ledger();
  const llm = FAKE ? fakeLLM({ ledger }) : anthropicLLM({ model: opts.model, effort: opts.effort, ledger });

  // Journey selection: core ids, 'core', 'stories', 'all', or a comma list.
  const wantCore = ['core', 'all'].includes(opts.journeys);
  const wantStories = ['stories', 'all'].includes(opts.journeys);
  const coreJourneys = wantCore ? JOURNEYS : wantStories ? [] : opts.journeys.split(',').map(journeyById);
  const storiesFile = path.join(HERE, 'stories.json');

  // Task list (persona × journey), honouring per-persona skips.
  let tasks = [];
  for (const p of personas) for (const j of coreJourneys) if (!(p.skip ?? []).includes(j.id)) tasks.push({ persona: p, journey: j });
  const storyCount = wantStories ? personas.length * opts.storiesPerPersona : 0;

  const reuseDir = opts.reuse ? path.resolve(opts.reuse) : '';
  if (reuseDir) {
    const prev = JSON.parse(await readFile(path.join(reuseDir, 'run.json'), 'utf8'));
    if (prev.model !== opts.model) throw new Error(`--reuse run used ${prev.model}, this run uses ${opts.model}; mixing models would muddy the scores.`);
    if ((prev.lens ?? null) !== (opts.lens ?? null)) {
      throw new Error(`--reuse run used lens "${prev.lens ?? 'none'}", this run uses "${opts.lens ?? 'none'}"; reused sessions would carry the other lens's prompts.`);
    }
  }
  const fresh = tasks.filter((t) => !reusableResult(reuseDir, taskIdOf(t.persona, t.journey)));
  if (reuseDir) console.log(`Reusing ${tasks.length - fresh.length} clean session(s) from ${path.relative(process.cwd(), reuseDir)}; running ${fresh.length}.`);

  const estimate = estimateCost({ tasks: [...fresh.map((t) => t.journey), ...Array(storyCount).fill({ maxSteps: 25 })], personas, model: opts.model, storiesToGenerate: wantStories ? personas.length : 0 });
  console.log(formatEstimate(estimate, { model: opts.model, sessions: fresh.length + storyCount }));
  if (opts.estimateOnly) return;
  if (!FAKE && !opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Spend up to ~$${estimate.high.toFixed(2)} of Anthropic credit on this run? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) return console.log('Cancelled; nothing was spent.');
  }

  let storiesHash = null;
  if (wantStories) {
    const { data } = await ensureStories({ file: storiesFile, personas, llm, perPersona: opts.storiesPerPersona, regenerate: opts.regenStories });
    storiesHash = sha(JSON.stringify(data));
    for (const p of personas) for (const s of data.personas[p.id] ?? []) tasks.push({ persona: p, journey: storyToJourney(p.id, s) });
  }

  const runId = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${sha(String(Math.random())).slice(0, 4)}`;
  const runDir = path.resolve(flag('out', path.join(HERE, 'runs', runId)));
  await mkdir(runDir, { recursive: true });
  const admin = adminClient();
  const browser = await chromium.launch({ headless: !flag('headed') });

  // Fail before creating any accounts if the API can't be used (no credit, bad auth).
  if (!FAKE) {
    try {
      await llm.call({ max_tokens: 16, messages: [{ role: 'user', content: 'Reply with: ok' }] });
    } catch (e) {
      throw new Error(`Anthropic API check failed, nothing was run: ${apiErrorMessage(e)}`);
    }
  }

  const results = [];
  let next = 0;
  let fatal = '';
  async function worker() {
    while (next < tasks.length && !fatal) {
      const { persona, journey } = tasks[next++];
      const taskId = taskIdOf(persona, journey);
      const outDir = path.join(runDir, 'tasks', taskId);
      const prior = reusableResult(reuseDir, taskId);
      if (prior) {
        await cp(path.join(reuseDir, 'tasks', taskId), outDir, { recursive: true });
        results.push({ ...prior, reused: true });
        console.log(`  reused    ${taskId} (${prior.outcome})`);
        continue;
      }
      const goalText = journey.goal(persona);
      const t0 = Date.now();
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'en-US', timezoneId: 'America/New_York' });
      // Hide the Next.js dev error badge: real users never see it, and it sits
      // over the bottom-left tab, swallowing taps on Home.
      await context.addInitScript(() => {
        const hide = () => { const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(st); };
        if (document.head) hide(); else document.addEventListener('DOMContentLoaded', hide);
      });
      const page = await context.newPage();
      const envErrors = watchSchemaErrors(page);
      const creds = newCredentials(persona.id, runId, journey.id.replace(/[^a-z0-9]+/gi, '').slice(0, 12));
      let rec = { taskId, personaId: persona.id, journeyId: journey.id, goal: goalText };
      try {
        if (journey.account === 'returning') {
          const userId = await createAccount(admin, creds, runId);
          await seedReturningUser(admin, userId, persona);
          await signIn(page, creds);
        }
        const run = await runJourney({ page, llm, persona, journey, goalText, credentials: journey.account === 'fresh' ? creds : null, outDir, baseUrl: opts.baseUrl, lens: opts.lens });
        if (journey.account === 'fresh') await tagAccount(admin, creds.email, runId);
        const review = await writeReview({ llm, persona, goalText, run, lens: opts.lens });
        rec = { ...rec, ...run, frictions: run.frictions.map((f) => ({ ...f, taskId, personaId: persona.id, journeyId: journey.id, source: 'live' })), review };
        // Problems listed in the review count too (small annoyances rarely get flagged mid-task).
        rec.frictions.push(...problemsToFrictions(rec));
      } catch (e) {
        rec = { ...rec, outcome: 'error', error: apiErrorMessage(e), log: [], frictions: [] };
        if (isFatalApiError(e)) fatal = rec.error;
        if (journey.account === 'fresh') await tagAccount(admin, creds.email, runId).catch(() => {});
      } finally {
        await context.close();
      }
      rec.seconds = Math.round((Date.now() - t0) / 1000);
      rec.envErrors = [...envErrors];
      await writeFile(path.join(outDir, 'result.json'), JSON.stringify(rec, null, 2)).catch(() => {});
      results.push(rec);
      console.log(`  ${rec.outcome.padEnd(9)} ${taskId} (${rec.steps ?? 0} actions, ${rec.seconds}s)${rec.error ? ' — ' + rec.error : ''}  [$${ledger.dollars().toFixed(2)} so far]`);
    }
  }
  console.log(`Running ${tasks.length} sessions → ${path.relative(process.cwd(), runDir)}`);
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  await browser.close();
  if (fatal) {
    console.error(`\nStopped early: ${fatal}\nRemove this run's accounts with: node ux-panel/cleanup.mjs --run=${runId}`);
    process.exit(1);
  }

  // ---------- scoring ----------
  const embedder = await createEmbedder({ provider: opts.embed, cacheDir: path.join(HERE, '.cache') });
  const anchorVecs = {};
  for (const q of QUESTIONS) anchorVecs[q.id] = await Promise.all(q.anchorSets.map((s) => embedder.embed(s)));
  for (const r of results) {
    if (!r.review) continue;
    r.scores = {};
    for (const q of QUESTIONS) {
      const [v] = await embedder.embed([r.review[q.id]]);
      r.scores[q.id] = ssrPmf(v, anchorVecs[q.id]);
    }
  }
  const allFrictions = results.flatMap((r) => r.frictions ?? []);
  const vecs = await embedder.embed(allFrictions.map((f) => f.text));
  allFrictions.forEach((f, i) => (f.embedding = vecs[i]));

  results.sort((a, b) => a.taskId.localeCompare(b.taskId));
  const run = {
    schema: 1,
    runId,
    label: opts.label,
    lens: opts.lens,
    createdAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    gitSha: safeGit('git rev-parse --short HEAD') + (safeGit('git status --porcelain --untracked-files=no') ? '+dirty' : ''),
    model: FAKE ? 'fake' : opts.model,
    embed: embedder.id,
    anchorsHash: sha(await readFile(path.join(HERE, 'anchors.mjs'), 'utf8')),
    storiesHash,
    reusedFrom: reuseDir ? path.basename(reuseDir) : null,
    reusedSessions: results.filter((r) => r.reused).length,
    panel: { personas: personas.length, journeys: [...new Set(tasks.map((t) => t.journey.id))] },
    journeyLabels: Object.fromEntries(tasks.map((t) => [t.journey.id, t.journey.label])),
    personas: Object.fromEntries(personas.map((p) => [p.id, { name: p.name, age: p.age, tagline: p.summary.split('. ')[0] }])),
    results: results.map(({ log, ...r }) => ({ ...r, frictions: (r.frictions ?? []).map(({ embedding, ...f }) => f), actions: log })),
    completion: completionRates(results),
    scores: aggregateScores(results.filter((r) => r.scores), QUESTIONS.map((q) => q.id)),
    frictions: clusterFrictions(allFrictions),
  };
  run.readout = opts.readout && !FAKE ? await writeReadout({ llm, run }).catch((e) => ({ ...plainReadout(run), error: e.message })) : plainReadout(run);
  run.cost = ledger.toJSON();
  await writeFile(path.join(runDir, 'run.json'), JSON.stringify(run, null, 1));
  await writeFile(path.join(runDir, 'report.html'), renderReport(run));
  console.log(`\nDone. ${results.filter((r) => r.outcome === 'completed').length}/${results.length} completed · ${run.frictions.length} issues · cost ≈ $${run.cost.dollars.toFixed(2)}`);
  console.log(`Report: ${path.relative(process.cwd(), path.join(runDir, 'report.html'))}`);
  console.log(`Synthetic accounts stay in the local DB for inspection; remove them with: node ux-panel/cleanup.mjs --run=${runId}`);
}

function safeGit(cmd) {
  try {
    return execSync(cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** Sign a seeded persona in through the app's own login form (local only). */
async function signIn(page, { email, password }) {
  // Wait for 'load' (hydration): filling before React attaches makes the
  // click submit a plain HTML form and the sign-in silently goes nowhere.
  await page.goto(new URL('/login', opts.baseUrl).toString(), { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(500);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000, waitUntil: 'commit' });
  } catch {
    const alert = await page.getByRole('alert').allInnerTexts().catch(() => []);
    const body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`sign-in did not leave /login (${alert.join(' | ') || body})`);
  }
}

/**
 * Supabase "missing column/table" responses mean the LOCAL schema has drifted
 * from what the app expects (see local-db/fixups.sql) — an environment bug,
 * not a UX finding. Collected per session and shown separately in the report.
 */
const SCHEMA_CODES = new Set(['42703', 'PGRST205', '42P01', 'PGRST200', 'PGRST204']);
function watchSchemaErrors(page) {
  const seen = new Set();
  page.on('response', async (r) => {
    if (r.status() < 400 || !/\/rest\/v1\//.test(r.url())) return;
    const body = await r.json().catch(() => null);
    if (body && SCHEMA_CODES.has(body.code)) seen.add(body.message);
  });
  return seen;
}

/** Billing/auth/permission errors won't fix themselves on the next session. */
function isFatalApiError(e) {
  return [401, 403].includes(e?.status) || /credit balance|billing|invalid x-api-key|authentication/i.test(String(e?.message));
}

function apiErrorMessage(e) {
  return e?.error?.error?.message || e?.message || String(e);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
