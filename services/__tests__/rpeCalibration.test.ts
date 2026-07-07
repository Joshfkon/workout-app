/**
 * Tests for services/rpeCalibration.ts
 * RPE calibration engine for tracking user's perception accuracy
 */

import {
  RPECalibrationEngine,
  getBiasLevel,
  getBiasColor,
  getCalibrationVerdict,
  computeFatigueAdjustedPrediction,
  repsInTankToRIR,
  formatBias,
  createCalibrationSetLog,
  CURRENT_CALIBRATION_METHOD,
  type CalibrationSetLog,
  type CalibrationResult,
} from '../rpeCalibration';
import { ENHANCED_RECOVERY_MULTIPLIER } from '../shared/fatigueConstants';

// ============================================
// HELPER FUNCTIONS
// ============================================

function createMockSetLog(overrides: Partial<CalibrationSetLog> = {}): CalibrationSetLog {
  return {
    exerciseId: 'ex-1',
    exerciseName: 'Bench Press',
    weight: 100,
    prescribedReps: { min: 8, max: 12 },
    actualReps: 10,
    reportedRIR: 2,
    wasAMRAP: false,
    timestamp: new Date(),
    ...overrides,
  };
}

function createMockCalibrationResult(overrides: Partial<CalibrationResult> = {}): CalibrationResult {
  return {
    exerciseName: 'Bench Press',
    predictedMaxReps: 12,
    actualMaxReps: 12,
    bias: 0,
    biasInterpretation: 'Excellent calibration - your RIR estimates are accurate',
    confidenceLevel: 'medium',
    lastCalibrated: new Date(),
    dataPoints: 3,
    method: CURRENT_CALIBRATION_METHOD,
    ...overrides,
  };
}

/**
 * Build a same-session sequence: `priorSets` working sets followed by an
 * AMRAP, spaced `gapSeconds` apart (rest + set time), all at `weight`.
 */
function buildSameSessionScenario(
  priorSets: Array<{ reps: number; rir: number }>,
  amrap: { reps: number; rir?: number },
  opts: { weight?: number; gapSeconds?: number; exerciseName?: string } = {}
): { logs: CalibrationSetLog[]; amrapLog: CalibrationSetLog } {
  const { weight = 85, gapSeconds = 210, exerciseName = 'Machine Chest Press' } = opts;
  const start = new Date('2026-07-01T10:00:00Z').getTime();
  const logs = priorSets.map((s, i) =>
    createMockSetLog({
      exerciseName,
      weight,
      actualReps: s.reps,
      reportedRIR: s.rir,
      wasAMRAP: false,
      timestamp: new Date(start + i * gapSeconds * 1000),
    })
  );
  const amrapLog = createMockSetLog({
    exerciseName,
    weight,
    actualReps: amrap.reps,
    reportedRIR: amrap.rir ?? 0,
    wasAMRAP: true,
    timestamp: new Date(start + priorSets.length * gapSeconds * 1000),
  });
  return { logs, amrapLog };
}

// ============================================
// RPE CALIBRATION ENGINE TESTS
// ============================================

describe('RPECalibrationEngine', () => {
  describe('constructor', () => {
    it('initializes with empty history when no data provided', () => {
      const engine = new RPECalibrationEngine();
      const data = engine.exportData();
      expect(data.history).toHaveLength(0);
      expect(data.calibrations).toHaveLength(0);
    });

    it('initializes with provided history', () => {
      const initialHistory = [createMockSetLog(), createMockSetLog()];
      const engine = new RPECalibrationEngine(initialHistory);
      const data = engine.exportData();
      expect(data.history).toHaveLength(2);
    });

    it('initializes with provided calibrations', () => {
      const initialCalibrations = [createMockCalibrationResult()];
      const engine = new RPECalibrationEngine([], initialCalibrations);
      expect(engine.getCalibrationResult('Bench Press')).not.toBeNull();
    });

    it('limits history to maxHistorySize', () => {
      const largeHistory = Array.from({ length: 600 }, (_, i) =>
        createMockSetLog({ exerciseId: `ex-${i}` })
      );
      const engine = new RPECalibrationEngine(largeHistory);
      const data = engine.exportData();
      expect(data.history.length).toBeLessThanOrEqual(500);
    });
  });

  describe('addSetLog', () => {
    it('adds set to history', () => {
      const engine = new RPECalibrationEngine();
      engine.addSetLog(createMockSetLog());
      const data = engine.exportData();
      expect(data.history).toHaveLength(1);
    });

    it('returns null for non-AMRAP sets', () => {
      const engine = new RPECalibrationEngine();
      const result = engine.addSetLog(createMockSetLog({ wasAMRAP: false }));
      expect(result).toBeNull();
    });

    it('returns calibration result for AMRAP sets', () => {
      const engine = new RPECalibrationEngine();
      const result = engine.addSetLog(createMockSetLog({ wasAMRAP: true }));
      expect(result).not.toBeNull();
      expect(result?.exerciseName).toBe('Bench Press');
    });

    it('maintains bounded history size', () => {
      const engine = new RPECalibrationEngine();
      // Add more than max history size
      for (let i = 0; i < 550; i++) {
        engine.addSetLog(createMockSetLog({ exerciseId: `ex-${i}` }));
      }
      const data = engine.exportData();
      expect(data.history.length).toBeLessThanOrEqual(500);
    });
  });

  describe('processAMRAPCalibration', () => {
    it('creates calibration with no prior data', () => {
      const engine = new RPECalibrationEngine();
      const amrapSet = createMockSetLog({
        wasAMRAP: true,
        actualReps: 15,
      });
      const result = engine.addSetLog(amrapSet);

      expect(result).not.toBeNull();
      expect(result?.dataPoints).toBe(0);
      expect(result?.confidenceLevel).toBe('low');
      expect(result?.bias).toBe(0);
    });

    it('calculates bias from prior RIR reports', () => {
      const engine = new RPECalibrationEngine();
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Add prior sets: 10 reps @ RIR 2 implies max of 12
      engine.addSetLog(
        createMockSetLog({
          timestamp: oneWeekAgo,
          weight: 100,
          actualReps: 10,
          reportedRIR: 2,
          wasAMRAP: false,
        })
      );
      engine.addSetLog(
        createMockSetLog({
          timestamp: new Date(oneWeekAgo.getTime() + 1000),
          weight: 100,
          actualReps: 10,
          reportedRIR: 2,
          wasAMRAP: false,
        })
      );
      engine.addSetLog(
        createMockSetLog({
          timestamp: new Date(oneWeekAgo.getTime() + 2000),
          weight: 100,
          actualReps: 10,
          reportedRIR: 2,
          wasAMRAP: false,
        })
      );

      // AMRAP shows 15 reps (predicted was 12, so bias = +3)
      const result = engine.addSetLog(
        createMockSetLog({
          timestamp: now,
          weight: 100,
          actualReps: 15,
          reportedRIR: 0,
          wasAMRAP: true,
        })
      );

      expect(result).not.toBeNull();
      expect(result?.predictedMaxReps).toBe(12);
      expect(result?.actualMaxReps).toBe(15);
      expect(result?.bias).toBe(3);
      expect(result?.dataPoints).toBe(3);
    });

    it('ignores sets outside 4 week window', () => {
      const engine = new RPECalibrationEngine();
      const now = new Date();
      const fiveWeeksAgo = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

      // Add old set (should be ignored)
      engine.addSetLog(
        createMockSetLog({
          timestamp: fiveWeeksAgo,
          weight: 100,
          actualReps: 10,
          reportedRIR: 2,
          wasAMRAP: false,
        })
      );

      // AMRAP now
      const result = engine.addSetLog(
        createMockSetLog({
          timestamp: now,
          weight: 100,
          actualReps: 15,
          wasAMRAP: true,
        })
      );

      expect(result?.dataPoints).toBe(0);
    });

    it('ignores sets outside 10% weight variance', () => {
      const engine = new RPECalibrationEngine();
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Add set at very different weight
      engine.addSetLog(
        createMockSetLog({
          timestamp: oneWeekAgo,
          weight: 80, // 20% different from 100
          actualReps: 10,
          reportedRIR: 2,
          wasAMRAP: false,
        })
      );

      // AMRAP at 100
      const result = engine.addSetLog(
        createMockSetLog({
          timestamp: now,
          weight: 100,
          actualReps: 15,
          wasAMRAP: true,
        })
      );

      expect(result?.dataPoints).toBe(0);
    });

    it('calculates confidence level based on data points', () => {
      const engine = new RPECalibrationEngine();
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Add 6 prior sets for high confidence
      for (let i = 0; i < 6; i++) {
        engine.addSetLog(
          createMockSetLog({
            timestamp: new Date(oneWeekAgo.getTime() + i * 1000),
            weight: 100,
            actualReps: 10,
            reportedRIR: 2,
            wasAMRAP: false,
          })
        );
      }

      const result = engine.addSetLog(
        createMockSetLog({
          timestamp: now,
          weight: 100,
          actualReps: 12,
          wasAMRAP: true,
        })
      );

      expect(result?.confidenceLevel).toBe('high');
    });
  });

  describe('getCalibrationResult', () => {
    it('returns null for uncalibrated exercise', () => {
      const engine = new RPECalibrationEngine();
      expect(engine.getCalibrationResult('Unknown Exercise')).toBeNull();
    });

    it('returns calibration for calibrated exercise', () => {
      const engine = new RPECalibrationEngine([], [createMockCalibrationResult()]);
      const result = engine.getCalibrationResult('Bench Press');
      expect(result).not.toBeNull();
    });

    it('is case-insensitive', () => {
      const engine = new RPECalibrationEngine([], [createMockCalibrationResult()]);
      expect(engine.getCalibrationResult('BENCH PRESS')).not.toBeNull();
      expect(engine.getCalibrationResult('bench press')).not.toBeNull();
    });
  });

  describe('analyzeOverallBias', () => {
    it('returns needs more data when no calibrations', () => {
      const engine = new RPECalibrationEngine();
      const analysis = engine.analyzeOverallBias();

      expect(analysis.needsMoreData).toBe(true);
      expect(analysis.calibratedExercises).toBe(0);
      expect(analysis.overallBias).toBe(0);
    });

    it('calculates weighted average bias', () => {
      const calibrations: CalibrationResult[] = [
        createMockCalibrationResult({
          exerciseName: 'Bench Press',
          bias: 2,
          confidenceLevel: 'high', // weight 3
        }),
        createMockCalibrationResult({
          exerciseName: 'Squat',
          bias: -1,
          confidenceLevel: 'low', // weight 1
        }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const analysis = engine.analyzeOverallBias();

      // (2*3 + -1*1) / (3+1) = 5/4 = 1.25
      expect(analysis.overallBias).toBeCloseTo(1.3, 1);
    });

    it('detects sandbagging when bias >= 2', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: 3, confidenceLevel: 'high' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const analysis = engine.analyzeOverallBias();

      expect(analysis.sandbaggingDetected).toBe(true);
      expect(analysis.overreachingDetected).toBe(false);
    });

    it('detects overreaching when bias <= -2', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: -3, confidenceLevel: 'high' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const analysis = engine.analyzeOverallBias();

      expect(analysis.sandbaggingDetected).toBe(false);
      expect(analysis.overreachingDetected).toBe(true);
    });

    it('provides appropriate recommendations', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: 0, confidenceLevel: 'high' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const analysis = engine.analyzeOverallBias();

      expect(analysis.recommendation).toContain('calibration is solid');
    });
  });

  describe('getAdjustedRIR', () => {
    it('returns unadjusted RIR when no calibration exists', () => {
      const engine = new RPECalibrationEngine();
      const result = engine.getAdjustedRIR('Unknown Exercise', 2);

      expect(result.prescribedRIR).toBe(2);
      expect(result.internalTargetRIR).toBe(2);
      expect(result.hasAdjustment).toBe(false);
    });

    it('returns unadjusted RIR for low confidence calibration', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: 3, confidenceLevel: 'low' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const result = engine.getAdjustedRIR('Bench Press', 2);

      expect(result.hasAdjustment).toBe(false);
    });

    it('adjusts RIR down for sandbagging users', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: 2, confidenceLevel: 'high' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const result = engine.getAdjustedRIR('Bench Press', 3);

      // bias +2 means they stop 2 reps early
      // To get true RIR 3, tell them RIR 1
      expect(result.prescribedRIR).toBe(1);
      expect(result.internalTargetRIR).toBe(3);
      expect(result.hasAdjustment).toBe(true);
      expect(result.adjustmentReason).toContain('stop');
    });

    it('clamps prescribed RIR to minimum 0', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: 5, confidenceLevel: 'high' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const result = engine.getAdjustedRIR('Bench Press', 2);

      expect(result.prescribedRIR).toBe(0);
    });

    it('adjusts RIR up for overreaching users', () => {
      const calibrations = [
        createMockCalibrationResult({ bias: -2, confidenceLevel: 'medium' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      const result = engine.getAdjustedRIR('Bench Press', 1);

      // bias -2 means they push 2 reps closer than they think
      // To get true RIR 1, we need adjustment
      expect(result.hasAdjustment).toBe(true);
      expect(result.adjustmentReason).toContain('push');
    });
  });

  describe('needsCalibration', () => {
    it('returns true when no calibration exists', () => {
      const engine = new RPECalibrationEngine();
      expect(engine.needsCalibration('Bench Press')).toBe(true);
    });

    it('returns true for low confidence calibration', () => {
      const calibrations = [
        createMockCalibrationResult({ confidenceLevel: 'low' }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      expect(engine.needsCalibration('Bench Press')).toBe(true);
    });

    it('returns true when calibration is older than threshold', () => {
      const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      const calibrations = [
        createMockCalibrationResult({
          lastCalibrated: oldDate,
          confidenceLevel: 'high',
        }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      expect(engine.needsCalibration('Bench Press', 14)).toBe(true);
    });

    it('returns false for recent high confidence calibration', () => {
      const calibrations = [
        createMockCalibrationResult({
          lastCalibrated: new Date(),
          confidenceLevel: 'high',
        }),
      ];
      const engine = new RPECalibrationEngine([], calibrations);
      expect(engine.needsCalibration('Bench Press', 14)).toBe(false);
    });
  });

  describe('getCalibrationPriorities', () => {
    it('returns empty array when no exercises in history', () => {
      const engine = new RPECalibrationEngine();
      expect(engine.getCalibrationPriorities()).toHaveLength(0);
    });

    it('marks uncalibrated exercises as high priority', () => {
      const engine = new RPECalibrationEngine([
        createMockSetLog({ exerciseName: 'Squat' }),
      ]);
      const priorities = engine.getCalibrationPriorities();

      expect(priorities[0].priority).toBe('high');
      expect(priorities[0].reason).toContain('Never calibrated');
    });

    it('marks low confidence as high priority', () => {
      const engine = new RPECalibrationEngine(
        [createMockSetLog({ exerciseName: 'Bench Press' })],
        [createMockCalibrationResult({ confidenceLevel: 'low' })]
      );
      const priorities = engine.getCalibrationPriorities();

      expect(priorities[0].priority).toBe('high');
      expect(priorities[0].reason).toContain('Low confidence');
    });

    it('marks old calibrations as medium priority', () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const engine = new RPECalibrationEngine(
        [createMockSetLog({ exerciseName: 'Bench Press' })],
        [
          createMockCalibrationResult({
            lastCalibrated: oldDate,
            confidenceLevel: 'high',
          }),
        ]
      );
      const priorities = engine.getCalibrationPriorities();

      expect(priorities[0].priority).toBe('medium');
      expect(priorities[0].reason).toContain('days ago');
    });

    it('marks recent calibrations as low priority', () => {
      const engine = new RPECalibrationEngine(
        [createMockSetLog({ exerciseName: 'Bench Press' })],
        [
          createMockCalibrationResult({
            lastCalibrated: new Date(),
            confidenceLevel: 'high',
          }),
        ]
      );
      const priorities = engine.getCalibrationPriorities();

      expect(priorities[0].priority).toBe('low');
      expect(priorities[0].reason).toContain('Recently calibrated');
    });

    it('sorts by priority (high first)', () => {
      const engine = new RPECalibrationEngine(
        [
          createMockSetLog({ exerciseName: 'Bench Press' }),
          createMockSetLog({ exerciseName: 'Squat' }),
        ],
        [
          createMockCalibrationResult({
            exerciseName: 'Bench Press',
            lastCalibrated: new Date(),
            confidenceLevel: 'high',
          }),
        ]
      );
      const priorities = engine.getCalibrationPriorities();

      // Squat is uncalibrated (high), Bench is calibrated (low)
      expect(priorities[0].exerciseName).toBe('Squat');
      expect(priorities[0].priority).toBe('high');
      expect(priorities[1].exerciseName).toBe('Bench Press');
      expect(priorities[1].priority).toBe('low');
    });
  });

  describe('exportData', () => {
    it('exports history and calibrations', () => {
      const history = [createMockSetLog()];
      const calibrations = [createMockCalibrationResult()];
      const engine = new RPECalibrationEngine(history, calibrations);

      const data = engine.exportData();
      expect(data.history).toHaveLength(1);
      expect(data.calibrations).toHaveLength(1);
    });
  });
});

// ============================================
// FATIGUE-ADJUSTED CALIBRATION TESTS
// ============================================

describe('fatigue-adjusted AMRAP calibration', () => {
  it('does not flag normal intra-session rep decay as overestimation (9/8/8 -> AMRAP 6)', () => {
    // Real-world false-positive case: 85 x 9 @ 1 RIR, x 8 @ 2, x 8 @ 1, then
    // AMRAP x 6 @ 0, ~3 min rest. The naive method predicted ~9.7 and read
    // bias -3+; fatigue-adjusted bias must land within honest noise.
    const { logs, amrapLog } = buildSameSessionScenario(
      [
        { reps: 9, rir: 1 },
        { reps: 8, rir: 2 },
        { reps: 8, rir: 1 },
      ],
      { reps: 6 }
    );

    const engine = new RPECalibrationEngine();
    logs.forEach(l => engine.addSetLog(l));
    const result = engine.addSetLog(amrapLog)!;

    expect(result.bias).toBeGreaterThanOrEqual(-1);
    expect(result.bias).toBeLessThanOrEqual(1);

    // Both predictions stored: raw stays naive, display value is adjusted
    expect(result.method).toBe(CURRENT_CALIBRATION_METHOD);
    expect(result.rawPredictedMaxReps).toBeCloseTo(9.7, 1);
    expect(result.predictedMaxReps).toBeLessThan(result.rawPredictedMaxReps!);
    expect(result.actualMaxReps - result.predictedMaxReps).toBeCloseTo(result.bias, 1);

    // No "Pushing Too Hard" verdict in any surface
    const verdict = getCalibrationVerdict(result);
    expect(verdict.level).toBe('accurate');
    expect(verdict.badgeLabel).toBe('Well Calibrated');
    expect(getBiasLevel(result.bias)).toBe('accurate');
  });

  it('still flags a true overestimator at high confidence', () => {
    // 6 fresh comparison sets (10 @ 3 RIR -> implied 13) from a prior
    // session; AMRAP performed fresh lands at 10 -> adjusted bias -3.
    const engine = new RPECalibrationEngine();
    const weekAgo = new Date('2026-07-01T10:00:00Z');
    for (let i = 0; i < 6; i++) {
      engine.addSetLog(
        createMockSetLog({
          weight: 100,
          actualReps: 10,
          reportedRIR: 3,
          wasAMRAP: false,
          timestamp: new Date(weekAgo.getTime() + i * 210 * 1000),
        })
      );
    }
    const result = engine.addSetLog(
      createMockSetLog({
        weight: 100,
        actualReps: 10,
        reportedRIR: 0,
        wasAMRAP: true,
        timestamp: new Date(weekAgo.getTime() + 7 * 24 * 60 * 60 * 1000),
      })
    )!;

    expect(result.confidenceLevel).toBe('high');
    expect(result.bias).toBeLessThanOrEqual(-2);

    const verdict = getCalibrationVerdict(result);
    expect(verdict.level).toBe('overreaching');
    expect(verdict.severity).toBe('strong');
    expect(verdict.badgeLabel).toBe('Pushing Too Hard');
    expect(verdict.color).toBe('red');
    expect(verdict.message).toContain('closer to failure');
    expect(engine.analyzeOverallBias().overreachingDetected).toBe(true);
  });

  it('flags an overestimator tentatively when the AMRAP lands >= 2 below the fatigue-adjusted expectation same-session', () => {
    // 3 sets of 10 @ 3 RIR (implied 13) then AMRAP 6: even after decay the
    // adjusted expectation is ~9.1, so the miss is real (bias ~ -3.1).
    const { logs, amrapLog } = buildSameSessionScenario(
      [
        { reps: 10, rir: 3 },
        { reps: 10, rir: 3 },
        { reps: 10, rir: 3 },
      ],
      { reps: 6 }
    );
    const engine = new RPECalibrationEngine();
    logs.forEach(l => engine.addSetLog(l));
    const result = engine.addSetLog(amrapLog)!;

    expect(result.bias).toBeLessThanOrEqual(-2);
    const verdict = getCalibrationVerdict(result);
    expect(verdict.level).toBe('overreaching');
    // Only 3 data points -> tentative, not the red strong verdict
    expect(verdict.severity).toBe('tentative');
    expect(verdict.color).toBe('yellow');
    expect(verdict.message).toContain('Early pattern');
  });

  it('still fires the sandbagging path when the AMRAP beats the fatigue-adjusted expectation by 3+', () => {
    // 3 sets of 10 @ 1 RIR (implied 11), AMRAP 12: adjusted expectation
    // ~7.7 -> bias ~ +4.3.
    const { logs, amrapLog } = buildSameSessionScenario(
      [
        { reps: 10, rir: 1 },
        { reps: 10, rir: 1 },
        { reps: 10, rir: 1 },
      ],
      { reps: 12 }
    );
    const engine = new RPECalibrationEngine();
    logs.forEach(l => engine.addSetLog(l));
    const result = engine.addSetLog(amrapLog)!;

    expect(result.bias).toBeGreaterThanOrEqual(3);
    expect(getBiasLevel(result.bias)).toBe('sandbagging');
    expect(engine.analyzeOverallBias().sandbaggingDetected).toBe(true);
  });

  it('accounts for at least one set of decay beyond the prediction source set (off-by-one)', () => {
    // Single prior set immediately before the AMRAP: its RIR report embeds
    // fatigue up TO that set, not the cost of performing it — the adjusted
    // prediction must sit below the naive one.
    const { logs, amrapLog } = buildSameSessionScenario(
      [{ reps: 8, rir: 1 }],
      { reps: 8 }
    );
    const engine = new RPECalibrationEngine();
    logs.forEach(l => engine.addSetLog(l));
    const result = engine.addSetLog(amrapLog)!;

    expect(result.rawPredictedMaxReps).toBeCloseTo(9, 1);
    expect(result.predictedMaxReps).toBeLessThanOrEqual(8);
  });

  it('applies no decay when the AMRAP is as fresh as its comparison sets', () => {
    // Cross-session comparison sets early in their own session vs an AMRAP
    // performed as the first set of its session: nothing to decay.
    const engine = new RPECalibrationEngine();
    const weekAgo = new Date('2026-07-01T10:00:00Z');
    engine.addSetLog(
      createMockSetLog({
        weight: 100,
        actualReps: 10,
        reportedRIR: 2,
        wasAMRAP: false,
        timestamp: weekAgo,
      })
    );
    const result = engine.addSetLog(
      createMockSetLog({
        weight: 100,
        actualReps: 12,
        reportedRIR: 0,
        wasAMRAP: true,
        timestamp: new Date(weekAgo.getTime() + 7 * 24 * 60 * 60 * 1000),
      })
    )!;

    expect(result.predictedMaxReps).toBe(12);
    expect(result.rawPredictedMaxReps).toBe(12);
    expect(result.bias).toBe(0);
  });

  it('uses enhanced-mode recovery constants for the adjusted expectation', () => {
    const scenario = () =>
      buildSameSessionScenario(
        [
          { reps: 9, rir: 1 },
          { reps: 8, rir: 2 },
          { reps: 8, rir: 1 },
        ],
        { reps: 6 }
      );

    const run = (enhancedAthleteMode: boolean) => {
      const { logs, amrapLog } = scenario();
      const engine = new RPECalibrationEngine([], [], { enhancedAthleteMode });
      logs.forEach(l => engine.addSetLog(l));
      return engine.addSetLog(amrapLog)!;
    };

    const natural = run(false);
    const enhanced = run(true);

    // Enhanced athletes recover faster between sets -> less expected decay
    // -> higher adjusted expectation -> slightly more negative bias here.
    expect(enhanced.predictedMaxReps).toBeGreaterThan(natural.predictedMaxReps);
    expect(enhanced.bias).toBeLessThan(natural.bias);
    // Raw (naive) prediction is mode-independent
    expect(enhanced.rawPredictedMaxReps).toBe(natural.rawPredictedMaxReps);

    // The prediction core reads the same shared constant as sandbagging
    // detection: per-step decay scales by exactly 1/ENHANCED_RECOVERY_MULTIPLIER.
    const { logs, amrapLog } = scenario();
    const naturalPred = computeFatigueAdjustedPrediction(amrapLog, logs, logs, false);
    const enhancedPred = computeFatigueAdjustedPrediction(amrapLog, logs, logs, true);
    const naturalDecay = naturalPred.rawPredictedMaxReps - naturalPred.fatigueAdjustedMaxReps;
    const enhancedDecay = enhancedPred.rawPredictedMaxReps - enhancedPred.fatigueAdjustedMaxReps;
    expect(enhancedDecay).toBeCloseTo(naturalDecay / ENHANCED_RECOVERY_MULTIPLIER, 5);
  });
});

// ============================================
// CALIBRATION RECORD VERSIONING TESTS
// ============================================

describe('calibration record versioning', () => {
  it('excludes legacy naive-method records from the rolling bias average', () => {
    const engine = new RPECalibrationEngine([], [
      // Legacy record (no method field): naive bias polluted by fatigue
      createMockCalibrationResult({
        exerciseName: 'Squat',
        bias: -3,
        confidenceLevel: 'high',
        method: undefined,
      }),
      // Current-method record
      createMockCalibrationResult({
        exerciseName: 'Bench Press',
        bias: 0,
        confidenceLevel: 'high',
      }),
    ]);

    const analysis = engine.analyzeOverallBias();
    expect(analysis.overallBias).toBe(0);
    expect(analysis.overreachingDetected).toBe(false);
    expect(analysis.calibratedExercises).toBe(1);
  });

  it('reports needsMoreData when only legacy records exist', () => {
    const engine = new RPECalibrationEngine([], [
      createMockCalibrationResult({ bias: -3, confidenceLevel: 'high', method: undefined }),
    ]);

    const analysis = engine.analyzeOverallBias();
    expect(analysis.needsMoreData).toBe(true);
    expect(analysis.overallBias).toBe(0);
    expect(analysis.recommendation).toContain('older method');
  });

  it('does not adjust RIR prescriptions from legacy-method records', () => {
    const engine = new RPECalibrationEngine([], [
      createMockCalibrationResult({ bias: 3, confidenceLevel: 'high', method: undefined }),
    ]);
    expect(engine.getAdjustedRIR('Bench Press', 2).hasAdjustment).toBe(false);
  });

  it('stamps new calibrations with the current method', () => {
    const engine = new RPECalibrationEngine();
    const result = engine.addSetLog(createMockSetLog({ wasAMRAP: true }))!;
    expect(result.method).toBe(CURRENT_CALIBRATION_METHOD);
  });
});

// ============================================
// CONFIDENCE-GATED VERDICT TESTS
// ============================================

describe('getCalibrationVerdict', () => {
  it('renders a neutral "Calibrating" verdict at low confidence, even for a large bias', () => {
    const verdict = getCalibrationVerdict({ bias: -3, confidenceLevel: 'low', dataPoints: 2 });
    expect(verdict.level).toBe('calibrating');
    expect(verdict.severity).toBe('neutral');
    expect(verdict.badgeLabel).toBe('Calibrating…');
    expect(verdict.badgeVariant).toBe('default');
    expect(verdict.color).toBe('gray');
    expect(verdict.message).toContain('need 1 more AMRAP set');
    expect(verdict.message).not.toContain('closer to failure');
  });

  it('renders identical bias as neutral at 2 points but strong at 7 points', () => {
    const low = getCalibrationVerdict({ bias: -3, confidenceLevel: 'low', dataPoints: 2 });
    const high = getCalibrationVerdict({ bias: -3, confidenceLevel: 'high', dataPoints: 7 });

    expect(low.severity).toBe('neutral');
    expect(low.color).toBe('gray');
    expect(high.severity).toBe('strong');
    expect(high.color).toBe('red');
    expect(high.badgeLabel).toBe('Pushing Too Hard');
  });

  it('hedges at medium confidence', () => {
    const verdict = getCalibrationVerdict({ bias: 2, confidenceLevel: 'medium', dataPoints: 4 });
    expect(verdict.severity).toBe('tentative');
    expect(verdict.badgeLabel).toBe('Possibly Sandbagging');
    expect(verdict.message).toContain('Early pattern');
  });

  it('treats adjusted bias within +/-1 rep as well calibrated', () => {
    for (const bias of [1, -1, 0.9, -0.9, 0]) {
      const verdict = getCalibrationVerdict({ bias, confidenceLevel: 'high', dataPoints: 6 });
      expect(verdict.level).toBe('accurate');
      expect(verdict.badgeLabel).toBe('Well Calibrated');
      expect(verdict.color).toBe('green');
    }
  });

  it('reserves "closer to failure" language for high confidence with bias <= -2', () => {
    const mildHigh = getCalibrationVerdict({ bias: -1.7, confidenceLevel: 'high', dataPoints: 6 });
    expect(mildHigh.message).not.toContain('closer to failure');

    const severeMedium = getCalibrationVerdict({ bias: -3, confidenceLevel: 'medium', dataPoints: 4 });
    expect(severeMedium.message).not.toContain('closer to failure');

    const severeHigh = getCalibrationVerdict({ bias: -2, confidenceLevel: 'high', dataPoints: 6 });
    expect(severeHigh.message).toContain('closer to failure');
  });

  it('raises the sandbagging threshold in enhanced athlete mode', () => {
    const natural = getCalibrationVerdict({ bias: 1.6, confidenceLevel: 'high', dataPoints: 6 });
    const enhanced = getCalibrationVerdict({ bias: 1.6, confidenceLevel: 'high', dataPoints: 6 }, true);
    expect(natural.level).toBe('sandbagging');
    expect(enhanced.level).toBe('accurate');
  });

  it('does not adjust RIR when bias sits inside the well-calibrated dead zone', () => {
    const engine = new RPECalibrationEngine([], [
      createMockCalibrationResult({ bias: 1, confidenceLevel: 'high' }),
    ]);
    expect(engine.getAdjustedRIR('Bench Press', 2).hasAdjustment).toBe(false);
  });
});

// ============================================
// HELPER FUNCTION TESTS
// ============================================

describe('getBiasLevel', () => {
  it('returns sandbagging for bias >= 1.5', () => {
    expect(getBiasLevel(1.5)).toBe('sandbagging');
    expect(getBiasLevel(3)).toBe('sandbagging');
  });

  it('returns overreaching for bias <= -1.5', () => {
    expect(getBiasLevel(-1.5)).toBe('overreaching');
    expect(getBiasLevel(-3)).toBe('overreaching');
  });

  it('returns accurate for bias between -1.5 and 1.5', () => {
    expect(getBiasLevel(0)).toBe('accurate');
    expect(getBiasLevel(1)).toBe('accurate');
    expect(getBiasLevel(-1)).toBe('accurate');
  });
});

describe('getBiasColor', () => {
  it('returns green for accurate', () => {
    expect(getBiasColor(0)).toBe('green');
  });

  it('returns yellow for sandbagging', () => {
    expect(getBiasColor(2)).toBe('yellow');
  });

  it('returns red for overreaching', () => {
    expect(getBiasColor(-2)).toBe('red');
  });
});

describe('repsInTankToRIR', () => {
  it('converts RepsInTank enum values correctly', () => {
    expect(repsInTankToRIR(4)).toBe(4);
    expect(repsInTankToRIR(3)).toBe(3);
    expect(repsInTankToRIR(2)).toBe(2);
    expect(repsInTankToRIR(1)).toBe(1);
    expect(repsInTankToRIR(0)).toBe(0);
  });
});

describe('formatBias', () => {
  it('formats positive bias with plus sign', () => {
    expect(formatBias(2.5)).toBe('+2.5 reps');
  });

  it('formats negative bias with minus sign', () => {
    expect(formatBias(-1.5)).toBe('-1.5 reps');
  });

  it('formats zero as positive', () => {
    expect(formatBias(0)).toBe('+0.0 reps');
  });
});

describe('createCalibrationSetLog', () => {
  it('creates a valid calibration set log', () => {
    const log = createCalibrationSetLog(
      'ex-123',
      'Bench Press',
      100,
      10,
      2,
      false,
      8,
      12,
      180
    );

    expect(log.exerciseId).toBe('ex-123');
    expect(log.exerciseName).toBe('Bench Press');
    expect(log.weight).toBe(100);
    expect(log.actualReps).toBe(10);
    expect(log.reportedRIR).toBe(2);
    expect(log.wasAMRAP).toBe(false);
    expect(log.prescribedReps).toEqual({ min: 8, max: 12 });
    expect(log.restTimeSeconds).toBe(180);
    expect(log.timestamp).toBeInstanceOf(Date);
  });

  it('handles null max reps', () => {
    const log = createCalibrationSetLog(
      'ex-123',
      'Bench Press',
      100,
      15,
      0,
      true,
      8,
      null
    );

    expect(log.prescribedReps).toEqual({ min: 8, max: null });
    expect(log.wasAMRAP).toBe(true);
  });

  it('handles optional rest time', () => {
    const log = createCalibrationSetLog(
      'ex-123',
      'Bench Press',
      100,
      10,
      2,
      false,
      8,
      12
    );

    expect(log.restTimeSeconds).toBeUndefined();
  });
});
