/**
 * Suites and reporting — what `npm run simulate` actually executes.
 *
 * Two shapes, and the split is about feedback latency rather than rigour:
 *
 *   fast  1 simulated month x 5 seeds per persona. Runs in CI on every push.
 *   full  ~6 simulated months x 50 seeds per persona. Nightly or on demand.
 *
 * The fast suite is a smaller SAMPLE of the same simulation, never a weaker
 * one — same personas, same assertions, same production code paths. Per the
 * harness constraints, if runtime becomes a problem the answer is to optimise
 * the harness, never to loosen an assertion or skip a production path.
 */
import { runSimulation, hardFailures, guardrailWarnings, type RunResult } from './runner';
import { formatFinding, type Finding } from './assertions';
import { PERSONA_NAMES, type PersonaName } from './personas';
import { createSimulationWorld, SIM_SESSION_ID, SIM_USER_ID } from './fixtures';

/** Sessions per run. At ~3 sessions/week: 12 ≈ one month, 78 ≈ six months. */
export const FAST_SESSIONS = 12;
export const FULL_SESSIONS = 78;
export const FAST_SEEDS = 5;
export const FULL_SEEDS = 50;

export const SIM_START = '2026-04-06T09:00:00';

export interface SuiteOptions {
  personas?: PersonaName[];
  seeds?: (string | number)[];
  sessions?: number;
  /** Collect every finding instead of stopping at the first hard failure. */
  collectAll?: boolean;
  onRunComplete?: (result: RunResult) => void;
}

export interface SuiteReport {
  runs: number;
  loggedSets: number;
  sessionsSimulated: number;
  hardFailures: Finding[];
  guardrails: Finding[];
  crashes: { persona: string; seed: string | number; message: string }[];
  durationMs: number;
}

export function seedRange(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Run a matrix of personas x seeds and aggregate the findings. */
export async function runSuite(options: SuiteOptions = {}): Promise<SuiteReport> {
  const personas = options.personas ?? [...PERSONA_NAMES];
  const seeds = options.seeds ?? seedRange(FAST_SEEDS);
  const sessions = options.sessions ?? FAST_SESSIONS;

  const report: SuiteReport = {
    runs: 0,
    loggedSets: 0,
    sessionsSimulated: 0,
    hardFailures: [],
    guardrails: [],
    crashes: [],
    durationMs: 0,
  };
  // Wall-clock, deliberately: this measures the harness, not simulated time,
  // and must not follow the injected clock.
  const started = Date.now();

  for (const persona of personas) {
    for (const seed of seeds) {
      const result = await runSimulation({
        persona,
        seed,
        fake: createSimulationWorld(),
        userId: SIM_USER_ID,
        sessionId: SIM_SESSION_ID,
        startAt: SIM_START,
        sessions,
        stopOnFailure: !options.collectAll,
      });

      report.runs += 1;
      report.loggedSets += result.trace.length;
      report.sessionsSimulated += result.sessionsCompleted;
      report.hardFailures.push(...hardFailures(result));
      report.guardrails.push(...guardrailWarnings(result));
      if (result.crash) {
        report.crashes.push({ persona, seed, message: result.crash.message });
      }
      options.onRunComplete?.(result);
    }
  }

  report.durationMs = Date.now() - started;
  return report;
}

/** Guardrail counts by name — the summary line, not the full diagnostics. */
export function guardrailSummary(report: SuiteReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of report.guardrails) counts[g.name] = (counts[g.name] ?? 0) + 1;
  return counts;
}

/**
 * Human-readable report.
 *
 * Hard failures are printed in FULL, every one of them. Truncating to "and 17
 * more" is how a harness trains people to ignore it — each finding carries the
 * one command that reproduces it, and that is only useful if it is visible.
 * Guardrails are summarised by count, because they are advisory by definition.
 */
export function formatReport(report: SuiteReport, label: string): string {
  const lines: string[] = [];
  const seconds = (report.durationMs / 1000).toFixed(1);

  lines.push(`\n${'='.repeat(72)}`);
  lines.push(`SIMULATION — ${label}`);
  lines.push('='.repeat(72));
  lines.push(
    `${report.runs} runs · ${report.sessionsSimulated} simulated sessions · ` +
      `${report.loggedSets} logged sets · ${seconds}s`
  );

  const guardrails = guardrailSummary(report);
  if (Object.keys(guardrails).length > 0) {
    lines.push('\nGuardrails (advisory — these do not fail the run):');
    for (const [name, count] of Object.entries(guardrails).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${count.toString().padStart(6)}  ${name}`);
    }
  }

  if (report.crashes.length > 0) {
    lines.push('\nCRASHES (production code threw):');
    for (const c of report.crashes) {
      lines.push(`  ${c.persona} seed=${c.seed}: ${c.message}`);
    }
  }

  if (report.hardFailures.length === 0) {
    lines.push('\nNo INVARIANT or CONTRACT violations.');
  } else {
    lines.push(`\n${report.hardFailures.length} HARD FAILURE(S):\n`);
    for (const f of report.hardFailures) {
      lines.push(formatFinding(f));
      lines.push('');
    }
  }

  lines.push('='.repeat(72));
  return lines.join('\n');
}

/**
 * Findings that should fail the process.
 *
 * `known` names defects already reported and tracked with their own
 * deterministic reproduction (see docs/SIMULATION_FINDING_*). They are still
 * printed — suppressing them from the report would let a known bug quietly
 * become invisible — but they do not turn the build red a second time.
 */
export function blockingFailures(report: SuiteReport, known: string[]): Finding[] {
  return report.hardFailures.filter((f) => !known.includes(f.name));
}
