#!/usr/bin/env node
/**
 * `npm run simulate` — the harness CLI.
 *
 *   npm run simulate                                     fast suite
 *   npm run simulate -- --full                           ~6 simulated months x 50 seeds
 *   npm run simulate -- --persona=detrainer --seed=1234  reproduce one run
 *   npm run simulate -- --scenario=SET3_MISS             deterministic scenarios
 *
 * The simulation itself runs under Jest (the repo has no standalone TypeScript
 * runtime). This script owns the argument surface so the command a failure
 * prints is the command a developer actually types.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

if (flag('help')) {
  console.log(`
Usage: npm run simulate -- [options]

  --full                 ~6 simulated months x 50 seeds per persona (slow)
  --persona=<name>       run one persona
  --seed=<seed>          run one seed (reproduce a reported failure)
  --sessions=<n>         override the number of simulated sessions
  --scenario=<name>      run the deterministic regression scenarios
  --help                 this message
`);
  process.exit(0);
}

const scenario = flag('scenario');
const jestArgs = scenario
  ? ['jest', '--runTestsByPath', 'simulation/__tests__/scenarios.test.ts']
  : [
      'jest',
      '--runTestsByPath',
      'simulation/cli/simulateEntry.ts',
      '--testMatch',
      '**/simulateEntry.ts',
      // jest.config.js ignores simulation/cli so `npm test` never picks the
      // whole harness up. Running it explicitly has to lift that.
      '--testPathIgnorePatterns',
      '/node_modules/',
    ];

const env = { ...process.env };
if (flag('full')) env.SIM_MODE = 'full';
if (typeof flag('persona') === 'string') env.SIM_PERSONA = flag('persona');
if (typeof flag('seed') === 'string') env.SIM_SEED = flag('seed');
if (typeof flag('sessions') === 'string') env.SIM_SESSIONS = flag('sessions');
if (typeof scenario === 'string') env.SIM_SCENARIO = scenario;

const result = spawnSync('npx', jestArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
