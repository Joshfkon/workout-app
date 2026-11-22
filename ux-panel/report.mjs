#!/usr/bin/env node
/**
 * Re-render a run's readout, optionally against a baseline run (two builds).
 *
 *   node ux-panel/report.mjs runs/<new>                       → runs/<new>/report.html
 *   node ux-panel/report.mjs runs/<new> --baseline=runs/<old> → runs/<new>/compare-<old>.html
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderReport } from './lib/report.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const baseArg = args.find((a) => a.startsWith('--baseline='))?.split('=')[1];
if (!dir) {
  console.error('usage: node ux-panel/report.mjs <runDir> [--baseline=<runDir>]');
  process.exit(1);
}
const load = async (d) => JSON.parse(await readFile(path.join(d, 'run.json'), 'utf8'));
const run = await load(dir);
const baseline = baseArg ? await load(baseArg) : null;
const out = path.join(dir, baseline ? `compare-${path.basename(baseArg)}.html` : 'report.html');
await writeFile(out, renderReport(run, { baseline }));
console.log(out);
