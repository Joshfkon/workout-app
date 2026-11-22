#!/usr/bin/env node
/**
 * Delete synthetic panel accounts (and, by cascade, their rows) from the
 * LOCAL Supabase. Only users with an @synthetic-panel.test email AND
 * user_metadata.synthetic_panel = true are touched.
 *
 *   node ux-panel/cleanup.mjs              all panel accounts
 *   node ux-panel/cleanup.mjs --run=<id>   one run's accounts
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient, cleanupSynthetic } from './lib/accounts.mjs';

const env = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
if (existsSync(env)) for (const l of readFileSync(env, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const runId = process.argv.find((a) => a.startsWith('--run='))?.split('=')[1];
const n = await cleanupSynthetic(adminClient(), { runId });
console.log(`Deleted ${n} synthetic account(s)${runId ? ` from run ${runId}` : ''}.`);
