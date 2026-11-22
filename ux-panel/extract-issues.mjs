#!/usr/bin/env node
/**
 * Back-fill a run recorded before reviews had a `problems` list: split each
 * review into separate problems (one model call for the whole run), count
 * them as issues next to the live friction reports, re-cluster, rewrite the
 * readout and re-render the report.
 *
 *   node ux-panel/extract-issues.mjs ux-panel/runs/<id> [--model=claude-sonnet-5-5]
 *
 * Costs about $0.05–0.10 on Sonnet. Rewrites run.json and report.html.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anthropicLLM, Ledger } from './lib/llm.mjs';
import { extractProblems, problemsToFrictions } from './lib/issues.mjs';
import { createEmbedder } from './lib/embed.mjs';
import { clusterFrictions } from './lib/aggregate.mjs';
import { writeReadout, plainReadout } from './lib/readout.mjs';
import { renderReport } from './lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const runDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '');
const model = (args.find((a) => a.startsWith('--model=')) ?? '').split('=')[1];
if (!existsSync(path.join(runDir, 'run.json'))) throw new Error(`usage: extract-issues.mjs <runDir>  (no run.json in ${runDir})`);
const envFile = path.join(HERE, '..', '.env.local');
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const run = JSON.parse(await readFile(path.join(runDir, 'run.json'), 'utf8'));
const ledger = new Ledger();
const llm = anthropicLLM({ model: model || run.model, ledger });

// Full logs live in each task's result.json (run.json keeps them as `actions`).
const logs = new Map();
for (const r of run.results) {
  const f = path.join(runDir, 'tasks', r.taskId, 'result.json');
  logs.set(r.taskId, existsSync(f) ? JSON.parse(await readFile(f, 'utf8')).log : r.actions);
}
const withLog = (r) => ({ ...r, log: logs.get(r.taskId) ?? [] });

const missing = run.results.filter((r) => r.review && !r.review.problems);
if (missing.length) {
  const byTask = await extractProblems({ llm, results: missing.map(withLog) });
  for (const r of missing) r.review.problems = byTask.get(r.taskId) ?? [];
}

const frictions = run.results.flatMap((r) => [
  ...(r.frictions ?? []).filter((f) => f.source !== 'review').map((f) => ({ ...f, source: f.source ?? 'live' })),
  ...problemsToFrictions(withLog(r)),
]);
const embedder = await createEmbedder({
  provider: String(run.embed ?? '').startsWith('openai') ? 'openai' : 'local',
  cacheDir: path.join(HERE, '.cache'),
});
const vecs = await embedder.embed(frictions.map((f) => f.text));
frictions.forEach((f, i) => (f.embedding = vecs[i]));
run.frictions = clusterFrictions(frictions);
for (const r of run.results) {
  r.frictions = frictions.filter((f) => f.taskId === r.taskId).map(({ embedding, ...f }) => f);
}
run.readout = await writeReadout({ llm, run }).catch((e) => ({ ...plainReadout(run), error: e.message }));
run.cost = { ...run.cost, dollars: +((run.cost?.dollars ?? 0) + ledger.dollars()).toFixed(4), backfill: ledger.toJSON() };
run.issuesFrom = 'live friction reports + problems listed in reviews (back-filled)';
await writeFile(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
await writeFile(path.join(runDir, 'report.html'), renderReport(run));
console.log(`${run.frictions.length} issues from ${frictions.length} problem reports · back-fill cost ≈ $${ledger.dollars().toFixed(3)}`);
console.log(`Report: ${path.relative(process.cwd(), path.join(runDir, 'report.html'))}`);
