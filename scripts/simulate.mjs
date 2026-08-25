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

/**
 * Deterministic scenarios, by the token their `describe` block starts with in
 * simulation/__tests__/scenarios.test.ts. Passing one through as a `-t` filter
 * is what makes `--scenario=X` actually run X rather than the whole file; the
 * list exists so a typo fails loudly instead of silently running everything.
 * Adding a scenario means adding it here too — if the two drift, jest reports
 * "0 tests" for that name, which is visible in its summary.
 */
const SCENARIOS = {
  SET3_MISS: 'SET3_MISS',
  REGRESSION_SET3_UNATTAINED_TARGET: 'REGRESSION_SET3_UNATTAINED_TARGET',
  position_match: 'position_match variant',
};

if (flag('help')) {
  console.log(`
Usage: npm run simulate -- [options]

  --full                 ~6 simulated months x 50 seeds per persona (slow)
  --persona=<name>       run one persona
  --seed=<seed>          run one seed (reproduce a reported failure)
  --sessions=<n>         override the number of simulated sessions
  --scenario=<name>      run ONE deterministic regression scenario
  --scenario=all         run every deterministic regression scenario
  --help                 this message

Scenarios: ${Object.keys(SCENARIOS).join(', ')}
`);
  process.exit(0);
}

const scenario = flag('scenario');
if (typeof scenario === 'string' && scenario !== 'all' && !(scenario in SCENARIOS)) {
  console.error(
    `Unknown scenario "${scenario}". Known: ${Object.keys(SCENARIOS).join(', ')}, all.`
  );
  process.exit(1);
}
if (scenario === true) {
  console.error(`--scenario needs a name. Known: ${Object.keys(SCENARIOS).join(', ')}, all.`);
  process.exit(1);
}

const jestArgs = scenario
  ? [
      'jest',
      '--runTestsByPath',
      'simulation/__tests__/scenarios.test.ts',
      // Without this filter every --scenario value ran the entire file, so a
      // "targeted" reproduction could be broken by an unrelated scenario.
      ...(scenario === 'all' ? [] : ['-t', SCENARIOS[scenario]]),
    ]
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

const result = spawnSync('npx', jestArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
