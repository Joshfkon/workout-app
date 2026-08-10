/**
 * Assertions — what the harness actually checks.
 *
 * Three classes, and the difference between them is a policy decision, not a
 * strength-of-belief one:
 *
 *   INVARIANT  Bookkeeping and state integrity. Unconditional. A failure here
 *              means the app has corrupted its own records, and there is no
 *              product argument that makes it acceptable.
 *
 *   CONTRACT   Documented HyperTracker behaviour. Also a hard failure, but it
 *              fails because the app disagrees with a written promise — so the
 *              fix might be the promise. Escalate, don't assume.
 *
 *   GUARDRAIL  "That looks wrong." Reported with full diagnostics, never fails
 *              the run. A guardrail becomes a contract only when Josh promotes
 *              it, and never by an agent quietly changing its class to make a
 *              run go green.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No check recomputes a prescription, a volume credit, or an e1RM and compares
 * it to the engine's. Every invariant below is about PRIMITIVES — do the rows
 * add up, are the references live, are the numbers numbers — because the
 * moment the harness owns a second implementation of the rules, a disagreement
 * stops being evidence about the app.
 *
 * The Phase 0 audit makes that cheaper than it sounds: volume has no
 * materialised aggregate anywhere (it is derived from `set_logs` on every
 * read), so "aggregates update exactly once" is structurally guaranteed and
 * what remains is checking that the primitives themselves are sound.
 */
import type { SetLog } from '@/types/schema';
import type { SetRecommendation } from '@/services/setRecommender';
import type { PerformanceOutcome } from './persona';

export type Severity = 'INVARIANT' | 'CONTRACT' | 'GUARDRAIL';

/** Where in a run something went wrong — everything needed to replay it. */
export interface AssertionContext {
  persona: string;
  seed: string | number;
  /** Simulated instant, ISO. */
  simulatedAt: string;
  /** Simulated local day. */
  simulatedDay: string;
  operation: string;
  sessionId?: string;
  exerciseId?: string;
  sessionIndex?: number;
}

export interface Finding {
  name: string;
  severity: Severity;
  message: string;
  context: AssertionContext;
  expected?: unknown;
  actual?: unknown;
  /** Anything that helps diagnose — recent sets, the offending prescription. */
  detail?: Record<string, unknown>;
}

export function isHardFailure(f: Finding): boolean {
  return f.severity === 'INVARIANT' || f.severity === 'CONTRACT';
}

/** One-command reproduction line, printed with every finding. */
export function reproCommand(f: Finding): string {
  return `npm run simulate -- --persona=${f.context.persona} --seed=${f.context.seed}`;
}

export function formatFinding(f: Finding): string {
  const lines = [
    `[${f.severity}] ${f.name}`,
    `  ${f.message}`,
    `  persona=${f.context.persona} seed=${f.context.seed}`,
    `  simulated=${f.context.simulatedAt} (day ${f.context.simulatedDay})`,
    `  operation=${f.context.operation}`,
  ];
  if (f.context.sessionId) lines.push(`  session=${f.context.sessionId}`);
  if (f.context.exerciseId) lines.push(`  exercise=${f.context.exerciseId}`);
  if (f.expected !== undefined) lines.push(`  expected: ${JSON.stringify(f.expected)}`);
  if (f.actual !== undefined) lines.push(`  actual:   ${JSON.stringify(f.actual)}`);
  if (f.detail) lines.push(`  detail: ${JSON.stringify(f.detail, null, 2)}`);
  lines.push(`  repro: ${reproCommand(f)}`);
  return lines.join('\n');
}

function finding(
  name: string,
  severity: Severity,
  message: string,
  ctx: AssertionContext,
  extra: Partial<Finding> = {}
): Finding {
  return { name, severity, message, context: ctx, ...extra };
}

// ---------------------------------------------------------------------------
// 3.1 Correctness invariants
// ---------------------------------------------------------------------------

/**
 * Primitive accounting: the loaded view of a session must be exactly the rows
 * the database holds for it — no set counted twice, none silently dropped.
 *
 * This is intentionally a comparison of PRIMITIVES against PRIMITIVES. It does
 * not recompute volume; per the audit there is no stored aggregate to disagree
 * with, so the only way tonnage can be wrong is if the underlying rows are.
 */
export function checkSetAccounting(
  loadedSets: SetLog[],
  dbRows: { id: string; exercise_block_id: string; set_number: number; reps: number; weight_kg: number }[],
  blockIds: Set<string>,
  ctx: AssertionContext
): Finding[] {
  const findings: Finding[] = [];
  const relevant = dbRows.filter((r) => blockIds.has(r.exercise_block_id));

  const ids = loadedSets.map((s) => s.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    findings.push(
      finding('SET_COUNTED_TWICE', 'INVARIANT', 'A logged set appears more than once', ctx, {
        actual: duplicates,
      })
    );
  }

  if (relevant.length !== loadedSets.length) {
    findings.push(
      finding(
        'SET_COUNT_MISMATCH',
        'INVARIANT',
        'The loaded session does not hold the same number of sets as the database',
        ctx,
        { expected: relevant.length, actual: loadedSets.length }
      )
    );
  }

  const dbIds = new Set(relevant.map((r) => r.id));
  const missing = ids.filter((id) => !dbIds.has(id));
  if (missing.length > 0) {
    findings.push(
      finding('SET_NOT_PERSISTED', 'INVARIANT', 'A set in the session view is not in the database', ctx, {
        actual: missing,
      })
    );
  }

  // set_number must be unique within a block: the database enforces it via
  // UNIQUE(exercise_block_id, set_number), so a collision in the loaded view
  // means the view and the constraint disagree.
  const byBlock = new Map<string, Set<number>>();
  for (const s of loadedSets) {
    if (s.isWarmup) continue;
    const seen = byBlock.get(s.exerciseBlockId) ?? new Set<number>();
    if (seen.has(s.setNumber)) {
      findings.push(
        finding('DUPLICATE_SET_NUMBER', 'INVARIANT', 'Two working sets share a set number in one block', ctx, {
          actual: { blockId: s.exerciseBlockId, setNumber: s.setNumber },
        })
      );
    }
    seen.add(s.setNumber);
    byBlock.set(s.exerciseBlockId, seen);
  }

  return findings;
}

/** Every set points at a live block; no dangling references. */
export function checkStateIntegrity(
  loadedSets: SetLog[],
  blockIds: Set<string>,
  ctx: AssertionContext
): Finding[] {
  const findings: Finding[] = [];
  for (const s of loadedSets) {
    if (!blockIds.has(s.exerciseBlockId)) {
      findings.push(
        finding('DANGLING_SET_REFERENCE', 'INVARIANT', 'A set references a block not in the session', ctx, {
          actual: { setId: s.id, blockId: s.exerciseBlockId },
        })
      );
    }
  }
  return findings;
}

/** No NaN, no Infinity, no negatives where the domain forbids them. */
export function checkNumericSanity(loadedSets: SetLog[], ctx: AssertionContext): Finding[] {
  const findings: Finding[] = [];
  for (const s of loadedSets) {
    const checks: [string, number][] = [
      ['weightKg', s.weightKg],
      ['reps', s.reps],
      ['rpe', s.rpe],
      ['setNumber', s.setNumber],
    ];
    for (const [field, value] of checks) {
      if (!Number.isFinite(value)) {
        findings.push(
          finding('NON_FINITE_VALUE', 'INVARIANT', `${field} is not a finite number`, ctx, {
            actual: { setId: s.id, field, value },
          })
        );
      } else if (value < 0) {
        findings.push(
          finding('NEGATIVE_VALUE', 'INVARIANT', `${field} is negative`, ctx, {
            actual: { setId: s.id, field, value },
          })
        );
      }
    }
    if (s.setNumber < 1) {
      findings.push(
        finding('SET_NUMBER_BELOW_ONE', 'INVARIANT', 'Set numbers are 1-based', ctx, {
          actual: { setId: s.id, setNumber: s.setNumber },
        })
      );
    }
  }
  return findings;
}

/** A prescription must be usable: finite, non-negative, with reps > 0. */
export function checkPrescriptionSanity(
  rx: SetRecommendation,
  ctx: AssertionContext
): Finding[] {
  const findings: Finding[] = [];
  const numbers: [string, number][] = [
    ['weightKg', rx.weightKg],
    ['reps', rx.reps],
    ['rir', rx.rir],
  ];
  for (const [field, value] of numbers) {
    if (!Number.isFinite(value)) {
      findings.push(
        finding('PRESCRIPTION_NOT_FINITE', 'INVARIANT', `Prescribed ${field} is not a finite number`, ctx, {
          actual: rx,
        })
      );
    } else if (value < 0) {
      findings.push(
        finding('PRESCRIPTION_NEGATIVE', 'INVARIANT', `Prescribed ${field} is negative`, ctx, {
          actual: rx,
        })
      );
    }
  }
  if (Number.isFinite(rx.reps) && rx.reps < 1) {
    findings.push(
      finding('PRESCRIPTION_ZERO_REPS', 'INVARIANT', 'A prescription asked for no reps', ctx, {
        actual: rx,
      })
    );
  }
  return findings;
}

/** A deleted set must be gone — `set_logs` has no soft-delete (audit H3). */
export function checkDeletionIsHard(
  deletedSetId: string,
  dbRows: { id: string }[],
  ctx: AssertionContext
): Finding[] {
  return dbRows.some((r) => r.id === deletedSetId)
    ? [
        finding('DELETED_SET_STILL_PRESENT', 'INVARIANT', 'A deleted set is still in the database', ctx, {
          actual: deletedSetId,
        }),
      ]
    : [];
}

// ---------------------------------------------------------------------------
// 3.2 Explicit prescription contracts
// ---------------------------------------------------------------------------

/**
 * The enumerated reasons a repeated unattained target is acceptable.
 *
 * IT IS EMPTY, AND IT STAYS EMPTY. Extending it requires Josh's explicit
 * approval in a separate change. An agent fixing a bug may not add an entry to
 * make this contract pass — that converts a real defect into a documented
 * feature by fiat, which is the exact failure this list exists to prevent.
 */
export const APPROVED_REPETITION_REASONS: readonly string[] = [];

export interface SetAttempt {
  prescribed: SetRecommendation;
  outcome: PerformanceOutcome;
  /** Target RIR the set was prescribed at. */
  targetRir: number;
}

/**
 * REGRESSION_SET3_UNATTAINED_TARGET.
 *
 * When a working set MISSES its prescribed rep target and the reported RIR is
 * at or below target — the user could not do more, and said so — the next
 * same-session prescription for that exercise must not be the identical
 * (load, reps) pair. Re-serving a target the lifter has just demonstrably
 * failed, with no new information, is the defect this contract names.
 *
 * `reasonCode` is whatever provenance the engine attached. Since the approved
 * list is empty, ANY reason is a violation; the parameter exists so the report
 * can say which one was claimed.
 */
export function checkSet3Contract(
  attempt: SetAttempt,
  nextPrescription: SetRecommendation,
  ctx: AssertionContext,
  reasonCode?: string
): Finding[] {
  const missedTarget = attempt.outcome.repsAchieved < attempt.prescribed.reps;
  const atOrBelowTargetRir = attempt.outcome.reportedRIR <= attempt.targetRir;
  if (!missedTarget || !atOrBelowTargetRir) return [];

  const identical =
    nextPrescription.weightKg === attempt.prescribed.weightKg &&
    nextPrescription.reps === attempt.prescribed.reps;
  if (!identical) return [];

  if (reasonCode && APPROVED_REPETITION_REASONS.includes(reasonCode)) return [];

  return [
    finding(
      'REGRESSION_SET3_UNATTAINED_TARGET',
      'CONTRACT',
      'The same unattained target was prescribed again after a set that missed it at or below target RIR',
      ctx,
      {
        expected: `a target other than ${attempt.prescribed.weightKg}kg x ${attempt.prescribed.reps}`,
        actual: `${nextPrescription.weightKg}kg x ${nextPrescription.reps}`,
        detail: {
          achieved: attempt.outcome.repsAchieved,
          reportedRIR: attempt.outcome.reportedRIR,
          targetRir: attempt.targetRir,
          reasonCode: reasonCode ?? null,
          approvedReasons: APPROVED_REPETITION_REASONS,
        },
      }
    ),
  ];
}

/**
 * A week with no sessions must not throw, produce NaN, or corrupt state.
 *
 * Expressed as "the next prescription after an empty period is still valid" —
 * the failure mode is a divide-by-zero or an empty-window average leaking a
 * NaN into a target, which then poisons everything downstream.
 */
export function checkEmptyPeriodSurvived(
  rx: SetRecommendation | null,
  ctx: AssertionContext
): Finding[] {
  if (!rx) {
    return [
      finding('EMPTY_PERIOD_NO_PRESCRIPTION', 'CONTRACT', 'No prescription available after an empty period', ctx),
    ];
  }
  return checkPrescriptionSanity(rx, ctx).map((f) => ({
    ...f,
    name: `EMPTY_PERIOD_${f.name}`,
    severity: 'CONTRACT' as const,
  }));
}

// ---------------------------------------------------------------------------
// 3.3 Guardrails (warnings — never fail a run)
// ---------------------------------------------------------------------------

export const GUARDRAIL_LOAD_JUMP_PCT = 0.1;
export const GUARDRAIL_E1RM_JUMP_PCT = 0.15;

/** Session-to-session prescribed load moved more than 10%. */
export function guardLoadJump(
  previousLoadKg: number,
  nextLoadKg: number,
  ctx: AssertionContext
): Finding[] {
  if (previousLoadKg <= 0) return [];
  const change = (nextLoadKg - previousLoadKg) / previousLoadKg;
  if (Math.abs(change) <= GUARDRAIL_LOAD_JUMP_PCT) return [];
  return [
    finding('GUARDRAIL_LOAD_JUMP', 'GUARDRAIL', 'Prescribed load moved more than 10% between sessions', ctx, {
      expected: `within ±${GUARDRAIL_LOAD_JUMP_PCT * 100}%`,
      actual: `${(change * 100).toFixed(1)}% (${previousLoadKg} → ${nextLoadKg} kg)`,
    }),
  ];
}

/**
 * A prescription grew while measured performance stayed flat for months —
 * the ratcheting signature the plateauer persona exists to surface.
 */
export function guardRatchetOnFlatPerformance(
  history: { day: string; prescribedLoadKg: number; bestRepsAchieved: number }[],
  ctx: AssertionContext,
  minSessions = 8
): Finding[] {
  if (history.length < minSessions) return [];
  const window = history.slice(-minSessions);
  const loads = window.map((h) => h.prescribedLoadKg);
  const reps = window.map((h) => h.bestRepsAchieved);

  const loadGrew = loads[loads.length - 1] > loads[0] * 1.05;
  const repsFlat = Math.abs(reps[reps.length - 1] - reps[0]) <= 1;
  if (!loadGrew || !repsFlat) return [];

  return [
    finding(
      'GUARDRAIL_RATCHET_ON_FLAT_PERFORMANCE',
      'GUARDRAIL',
      'Prescribed load kept climbing while achieved reps stayed flat',
      ctx,
      { detail: { window } }
    ),
  ];
}

/** The prescription flip-flopped between the same two targets. */
export function guardOscillation(
  recentTargets: { weightKg: number; reps: number }[],
  ctx: AssertionContext
): Finding[] {
  if (recentTargets.length < 4) return [];
  const key = (t: { weightKg: number; reps: number }) => `${t.weightKg}x${t.reps}`;
  const last4 = recentTargets.slice(-4).map(key);
  const alternating =
    last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1];
  if (!alternating) return [];
  return [
    finding('GUARDRAIL_OSCILLATION', 'GUARDRAIL', 'The prescription alternated between two targets', ctx, {
      actual: last4,
    }),
  ];
}

/** An immediate load increase on the first session back from a long layoff. */
export function guardProgressionAfterLayoff(
  daysSinceLastSession: number,
  previousLoadKg: number,
  nextLoadKg: number,
  ctx: AssertionContext,
  layoffDays = 14
): Finding[] {
  if (daysSinceLastSession < layoffDays) return [];
  if (nextLoadKg <= previousLoadKg) return [];
  return [
    finding(
      'GUARDRAIL_PROGRESSION_AFTER_LAYOFF',
      'GUARDRAIL',
      'Load increased on the first session back after a long gap',
      ctx,
      {
        detail: { daysSinceLastSession, previousLoadKg, nextLoadKg },
      }
    ),
  ];
}
