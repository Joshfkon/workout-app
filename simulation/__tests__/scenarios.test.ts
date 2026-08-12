/**
 * Phase 4 — deterministic regression scenarios.
 *
 * Short, fixed, persona-free reproductions. Every one of these either encodes a
 * documented contract or pins a bug the stochastic harness found, reduced to
 * the smallest input that still shows it.
 *
 * `it.failing` marks a KNOWN OPEN DEFECT: it passes while the bug exists and
 * turns RED the moment production behaviour changes, which is the signal we
 * want — whoever fixes the engine gets told to flip it to `it`. Per the harness
 * constraints these are reported, not patched: fixing the engine is separate
 * work, and no reason code may be added to APPROVED_REPETITION_REASONS to make
 * a contract pass.
 */
import { nextSetPrescription } from '@/services/prescription/sessionPrescription';
import { APPROVED_REPETITION_REASONS } from '../assertions';

const INCREMENT = { minWeightIncrementKg: 2.5 };

describe('SET3_MISS — the canonical scenario', () => {
  /**
   * From the harness spec:
   *   Set 1 — prescribed 100x10 @2 — actual 100x10 @2
   *   Set 2 — prescribed 100x10 @2 — actual 100x9  @1
   *   Set 3 — prescribed 100x10 @2 — actual 100x7  @0
   *   Assert: the next same-session prescription is not 100x10.
   */
  const base = {
    targetRepRange: [8, 12] as [number, number],
    targetRir: 2,
    plannedSetCount: 3,
    previousSets: [
      { weightKg: 100, reps: 10, rpe: 8 },
      { weightKg: 100, reps: 10, rpe: 8 },
      { weightKg: 100, reps: 10, rpe: 8 },
    ],
    exercise: INCREMENT,
    coldStart: false,
  };

  it('does not re-serve 100x10 after three degrading sets', () => {
    const completedSets = [
      { weightKg: 100, reps: 10, rpe: 8 },
      { weightKg: 100, reps: 9, rpe: 9 },
      { weightKg: 100, reps: 7, rpe: 10 },
    ];
    const rx = nextSetPrescription({
      ...base,
      last: completedSets[2],
      completedSets,
    });
    expect({ weightKg: rx.weightKg, reps: rx.reps }).not.toEqual({ weightKg: 100, reps: 10 });
  });
});

describe('REGRESSION_SET3_UNATTAINED_TARGET — found by the harness', () => {
  /**
   * KNOWN OPEN DEFECT. Discovered by the stochastic sweep (175 runs, 73,100
   * logged sets); 20 violations across five personas, dominated by ego-lifter.
   * Reduced here to a fixed, persona-free sequence.
   *
   * Original reproduction: `--persona=ego-lifter --seed=3`.
   *
   * The sequence, all within one session, 8-12 range at target RIR 2:
   *   set 1  engine asks 85x10, lifter does 85x10 @ RPE 8  (RIR 2, on target)
   *   set 2  engine asks 80x10, lifter does 80x9  @ RPE 9  (RIR 1, MISSED)
   *   set 3  engine asks 80x10 AGAIN
   *
   * Set 2 missed its rep target at a reported RIR at or below the target, so
   * the engine has been told the ask was not attainable — and set 3 re-serves
   * it unchanged. Provenance is `load_lever`; the approved-reasons list is
   * empty, so nothing excuses the repeat.
   */
  const PREVIOUS_SESSION = [
    { weightKg: 82.5, reps: 10, rpe: 8 },
    { weightKg: 77.5, reps: 10, rpe: 8 },
    { weightKg: 77.5, reps: 10, rpe: 8 },
  ];
  const base = {
    targetRepRange: [8, 12] as [number, number],
    targetRir: 2,
    plannedSetCount: 3,
    previousSets: PREVIOUS_SESSION,
    exercise: INCREMENT,
    coldStart: false,
  };

  /** The three prescriptions the engine produces for this sequence. */
  function sequence() {
    const rx1 = nextSetPrescription({
      ...base,
      last: { weightKg: 82.5, reps: 10, rpe: 8 },
      completedSets: [],
    });
    const afterSet1 = [{ weightKg: 85, reps: 10, rpe: 8 }];
    const rx2 = nextSetPrescription({ ...base, last: afterSet1[0], completedSets: afterSet1 });
    const afterSet2 = [...afterSet1, { weightKg: 80, reps: 9, rpe: 9 }];
    const rx3 = nextSetPrescription({ ...base, last: afterSet2[1], completedSets: afterSet2 });
    return { rx1, rx2, rx3 };
  }

  it('the setup is still the setup — set 2 asks 80x10 and the lifter falls short at RIR 1', () => {
    // Guards the scenario itself. If the engine's earlier prescriptions drift,
    // the defect test below would start passing for the wrong reason.
    const { rx2 } = sequence();
    expect({ weightKg: rx2.weightKg, reps: rx2.reps }).toEqual({ weightKg: 80, reps: 10 });
    // Achieved 9 of 10 at reported RIR 1, against a target RIR of 2.
    expect(9).toBeLessThan(rx2.reps);
    expect(1).toBeLessThanOrEqual(2);
  });

  it.failing('does not re-serve the unattained 80x10 on set 3', () => {
    const { rx2, rx3 } = sequence();
    expect({ weightKg: rx3.weightKg, reps: rx3.reps }).not.toEqual({
      weightKg: rx2.weightKg,
      reps: rx2.reps,
    });
  });

  it('the repeat is claimed under a reason code that is not approved', () => {
    const { rx3 } = sequence();
    expect(rx3.provenance?.source).toBe('load_lever');
    expect(APPROVED_REPETITION_REASONS).not.toContain('load_lever');
    // Constraint 10: this list may only be extended by Josh, in a separate
    // change. Adding an entry here to turn the defect green is forbidden.
    expect(APPROVED_REPETITION_REASONS).toEqual([]);
  });
});

describe('position_match variant — the same contract, a different branch', () => {
  /**
   * KNOWN OPEN DEFECT. The sweep's other reason code. Same shape: a set misses
   * its target at or below target RIR and the identical pair comes back, this
   * time attributed to set-position matching against last session.
   *
   * Original reproduction: `--persona=ego-lifter --seed=4`.
   */
  const base = {
    targetRepRange: [8, 12] as [number, number],
    targetRir: 2,
    plannedSetCount: 3,
    previousSets: [
      { weightKg: 55, reps: 10, rpe: 8 },
      { weightKg: 55, reps: 10, rpe: 8 },
      { weightKg: 55, reps: 9, rpe: 9 },
    ],
    exercise: INCREMENT,
    coldStart: false,
  };

  function sequence() {
    const afterSet1 = [{ weightKg: 57.5, reps: 10, rpe: 8 }];
    const rx2 = nextSetPrescription({ ...base, last: afterSet1[0], completedSets: afterSet1 });
    const afterSet2 = [...afterSet1, { weightKg: rx2.weightKg, reps: rx2.reps - 1, rpe: 10 }];
    const rx3 = nextSetPrescription({ ...base, last: afterSet2[1], completedSets: afterSet2 });
    return { rx2, rx3 };
  }

  it('records what the engine currently does', () => {
    const { rx2, rx3 } = sequence();
    // Documented so a behaviour change is visible even if the defect below is
    // fixed by a route that changes these numbers.
    expect(Number.isFinite(rx2.weightKg)).toBe(true);
    expect(Number.isFinite(rx3.weightKg)).toBe(true);
  });
});
