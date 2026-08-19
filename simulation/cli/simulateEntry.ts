/**
 * `npm run simulate` entry point.
 *
 * Executed through Jest rather than directly: the repo has no TypeScript
 * runtime (no tsx, no ts-node), and Jest already resolves the `@/` aliases and
 * compiles TS. It is NOT part of `npm test` — jest.config.js excludes
 * `simulation/cli/`, and this file is named so the default testMatch skips it.
 *
 * Arguments arrive as env vars from scripts/simulate.mjs, which owns the
 * user-facing CLI surface.
 */
import { runSuite, formatReport, blockingFailures, seedRange, FAST_SESSIONS, FULL_SESSIONS, FAST_SEEDS, FULL_SEEDS } from '../suite';
import { PERSONA_NAMES, type PersonaName } from '../personas';
import { __setDriverForTests } from '@/lib/offline/setOutbox';
import { createMemoryOutbox } from '../fixtures';
import { resetClock } from '@/lib/clock';

/**
 * Defects already reported with their own deterministic reproduction. Listed
 * here so a known bug does not fail the build twice; it is still printed in
 * full. Removing an entry is how a fix gets verified.
 */
const KNOWN_OPEN_DEFECTS = ['REGRESSION_SET3_UNATTAINED_TARGET'];

jest.mock('@/lib/actions/workout-calories', () => ({
  // The real action is a SERVER action and cannot resolve headlessly; it also
  // reports { success }, which the post-finish settlement checks. A mock
  // returning undefined reads as a failed run and leaves work items behind.
  calculateAndSaveWorkoutCalories: jest.fn().mockResolvedValue({ success: true }),
}));

const MODE = process.env.SIM_MODE ?? 'fast';
const PERSONA = process.env.SIM_PERSONA;
const SEED = process.env.SIM_SEED;
const SESSIONS = process.env.SIM_SESSIONS ? Number(process.env.SIM_SESSIONS) : undefined;

jest.setTimeout(60 * 60 * 1000);

test('simulate', async () => {
  __setDriverForTests(createMemoryOutbox() as never);

  const full = MODE === 'full';
  const personas: PersonaName[] = PERSONA ? [PERSONA as PersonaName] : [...PERSONA_NAMES];
  for (const p of personas) {
    if (!PERSONA_NAMES.includes(p)) {
      throw new Error(`Unknown persona "${p}". Known: ${PERSONA_NAMES.join(', ')}`);
    }
  }

  const seeds = SEED ? [SEED] : seedRange(full ? FULL_SEEDS : FAST_SEEDS);
  const sessions = SESSIONS ?? (full ? FULL_SESSIONS : FAST_SESSIONS);
  const label = SEED || PERSONA
    ? `repro · persona=${personas.join(',')} seed=${seeds.join(',')} sessions=${sessions}`
    : `${MODE} suite · ${personas.length} personas × ${seeds.length} seeds × ${sessions} sessions`;

  // collectAll in repro mode: a developer chasing one seed wants every finding
  // in that run, not just the first.
  const report = await runSuite({ personas, seeds, sessions, collectAll: Boolean(SEED || PERSONA) });

  // eslint-disable-next-line no-console -- this IS the program's output
  console.log(formatReport(report, label));

  resetClock();
  __setDriverForTests(null);

  const blocking = blockingFailures(report, KNOWN_OPEN_DEFECTS);
  if (report.crashes.length > 0) {
    throw new Error(`Simulation crashed: production code threw in ${report.crashes.length} run(s).`);
  }
  if (blocking.length > 0) {
    throw new Error(
      `Simulation failed: ${blocking.length} unexpected INVARIANT/CONTRACT violation(s). ` +
        `See the report above; each carries a one-command reproduction.`
    );
  }
});
