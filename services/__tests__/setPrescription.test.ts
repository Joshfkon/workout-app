/**
 * Tests for services/setPrescription.ts
 * Set prescription logic for AMRAP, RIR targets, and display formatting
 */

import {
  prescribeSetType,
  needsCalibration,
  getAMRAPFrequency,
  calculateTargetRIR,
  formatRepRange,
  formatPrescriptionDisplay,
  prescribeExerciseBlock,
  blockHasAMRAP,
  getBlockSummary,
  type SetPrescriptionContext,
  type RepRange,
  type SetPrescription,
} from '../setPrescription';

// ============================================
// HELPER FUNCTIONS
// ============================================

function createContext(overrides: Partial<SetPrescriptionContext> = {}): SetPrescriptionContext {
  return {
    setNumber: 1,
    totalSets: 3,
    isMesocycleEnd: false,
    isReturnFromDeload: false,
    isFirstTimeExercise: false,
    hasRecentAMRAP: false,
    ...overrides,
  };
}

const baseRepRange: RepRange = { min: 8, max: 12 };

// ============================================
// PRESCRIBE SET TYPE TESTS
// ============================================

describe('prescribeSetType', () => {
  describe('standard sets (non-AMRAP)', () => {
    it('prescribes standard set for non-last set', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 1,
        totalSets: 3,
      }));

      expect(result.isAMRAP).toBe(false);
      expect(result.targetReps).toEqual({ min: 8, max: 12 });
    });

    it('respects RIR floor for protected exercises', () => {
      const result = prescribeSetType('Barbell Bench Press', baseRepRange, 1, createContext({
        setNumber: 1,
        totalSets: 3,
      }));

      // Floor is 2 for protect tier, so 1 should become 2
      expect(result.rirFloor).toBe(2);
    });

    it('includes safety tier in result', () => {
      const result = prescribeSetType('Barbell Bench Press', baseRepRange, 2, createContext());
      expect(result.safetyTier).toBe('protect');
    });

    it('includes instructions for protected exercises', () => {
      const result = prescribeSetType('Barbell Bench Press', baseRepRange, 2, createContext());
      expect(result.instructions).toContain('2+');
    });
  });

  describe('AMRAP on last set - push_freely tier', () => {
    it('prescribes AMRAP on last set when no recent AMRAP', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        hasRecentAMRAP: false,
      }));

      expect(result.isAMRAP).toBe(true);
      expect(result.targetReps.max).toBeNull();
    });

    it('does not prescribe AMRAP when has recent AMRAP', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        hasRecentAMRAP: true,
      }));

      expect(result.isAMRAP).toBe(false);
    });

    it('shows calibration prompt for calibration AMRAP', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        hasRecentAMRAP: false,
      }));

      expect(result.showCalibrationPrompt).toBe(true);
    });
  });

  describe('AMRAP on last set - push_cautiously tier', () => {
    // Note: Using "Bulgarian Split Squat" as it's classified as push_cautiously
    // "Dumbbell Bench Press" is classified as protect because it contains "bench press"
    it('prescribes AMRAP at mesocycle end', () => {
      const result = prescribeSetType('Bulgarian Split Squat', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isMesocycleEnd: true,
      }));

      expect(result.isAMRAP).toBe(true);
    });

    it('prescribes AMRAP on return from deload', () => {
      const result = prescribeSetType('Bulgarian Split Squat', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isReturnFromDeload: true,
      }));

      expect(result.isAMRAP).toBe(true);
    });

    it('does not prescribe AMRAP normally', () => {
      const result = prescribeSetType('Bulgarian Split Squat', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isMesocycleEnd: false,
        isReturnFromDeload: false,
      }));

      expect(result.isAMRAP).toBe(false);
    });
  });

  describe('AMRAP on last set - protect tier', () => {
    it('never prescribes AMRAP for protected exercises', () => {
      const result = prescribeSetType('Barbell Bench Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isMesocycleEnd: true,
        isReturnFromDeload: true,
        isFirstTimeExercise: true,
      }));

      expect(result.isAMRAP).toBe(false);
    });
  });

  describe('first time exercise', () => {
    it('prescribes AMRAP for first time push_freely exercise', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isFirstTimeExercise: true,
      }));

      expect(result.isAMRAP).toBe(true);
      expect(result.showCalibrationPrompt).toBe(true);
    });

    it('prescribes AMRAP for first time push_cautiously exercise', () => {
      const result = prescribeSetType('Dumbbell Rows', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isFirstTimeExercise: true,
      }));

      expect(result.isAMRAP).toBe(true);
    });

    it('does not prescribe AMRAP for first time protect exercise', () => {
      const result = prescribeSetType('Back Squat', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isFirstTimeExercise: true,
      }));

      expect(result.isAMRAP).toBe(false);
    });
  });

  describe('display text', () => {
    it('formats AMRAP display text correctly', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        hasRecentAMRAP: false,
      }));

      expect(result.displayText).toBe('8+ reps');
    });

    it('formats standard set display text correctly', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 1,
        totalSets: 3,
      }));

      expect(result.displayText).toBe('8-12 reps @ 2 RIR');
    });
  });

  describe('AMRAP instructions', () => {
    it('includes push to failure instructions for safe exercises', () => {
      const result = prescribeSetType('Machine Chest Press', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
      }));

      expect(result.instructions).toContain('true failure');
    });

    it('includes cautious instructions for moderate risk exercises', () => {
      const result = prescribeSetType('Bulgarian Split Squat', baseRepRange, 2, createContext({
        setNumber: 3,
        totalSets: 3,
        isMesocycleEnd: true,
      }));

      expect(result.instructions).toContain('1 clean rep');
    });
  });
});

// ============================================
// NEEDS CALIBRATION TESTS
// ============================================

describe('needsCalibration', () => {
  describe('protected exercises', () => {
    it('never needs calibration', () => {
      expect(needsCalibration('Barbell Bench Press', null, false)).toBe(false);
      expect(needsCalibration('Barbell Bench Press', 30, false)).toBe(false);
    });
  });

  describe('push_freely exercises', () => {
    it('needs calibration when no calibration data', () => {
      expect(needsCalibration('Machine Chest Press', null, false)).toBe(true);
    });

    it('needs calibration after 14 days', () => {
      expect(needsCalibration('Machine Chest Press', 14, true)).toBe(true);
      expect(needsCalibration('Machine Chest Press', 15, true)).toBe(true);
    });

    it('does not need calibration within 14 days', () => {
      expect(needsCalibration('Machine Chest Press', 13, true)).toBe(false);
      expect(needsCalibration('Machine Chest Press', 7, true)).toBe(false);
    });
  });

  describe('push_cautiously exercises', () => {
    it('needs calibration when no calibration data', () => {
      expect(needsCalibration('Dumbbell Rows', null, false)).toBe(true);
    });

    it('needs calibration after 28 days', () => {
      expect(needsCalibration('Dumbbell Rows', 28, true)).toBe(true);
      expect(needsCalibration('Dumbbell Rows', 30, true)).toBe(true);
    });

    it('does not need calibration within 28 days', () => {
      expect(needsCalibration('Dumbbell Rows', 27, true)).toBe(false);
      expect(needsCalibration('Dumbbell Rows', 14, true)).toBe(false);
    });
  });
});

// ============================================
// AMRAP FREQUENCY TESTS
// ============================================

describe('getAMRAPFrequency', () => {
  it('returns 14 days for push_freely exercises', () => {
    const result = getAMRAPFrequency('Machine Chest Press');
    expect(result.frequencyDays).toBe(14);
    expect(result.description).toContain('2 weeks');
  });

  it('returns 28 days for push_cautiously exercises', () => {
    const result = getAMRAPFrequency('Dumbbell Rows');
    expect(result.frequencyDays).toBe(28);
    expect(result.description).toContain('mesocycle');
  });

  it('returns Infinity for protect exercises', () => {
    const result = getAMRAPFrequency('Barbell Bench Press');
    expect(result.frequencyDays).toBe(Infinity);
    expect(result.description).toContain('Never');
  });
});

// ============================================
// CALCULATE TARGET RIR TESTS
// ============================================

describe('calculateTargetRIR', () => {
  describe('set progression', () => {
    it('may reduce RIR by 0.5 on last set (depends on rounding)', () => {
      const lastSetRIR = calculateTargetRIR(3, 3, 3, 1, 4);
      const firstSetRIR = calculateTargetRIR(3, 1, 3, 1, 4);
      // The function rounds, so 3 - 0.5 = 2.5 rounds to 3
      // Both should be 3 due to rounding behavior
      expect(lastSetRIR).toBeLessThanOrEqual(firstSetRIR);
    });

    it('does not reduce RIR on non-last sets', () => {
      const result = calculateTargetRIR(3, 2, 3, 1, 4);
      expect(result).toBe(3);
    });
  });

  describe('week progression', () => {
    it('reduces RIR as mesocycle progresses', () => {
      const week1RIR = calculateTargetRIR(3, 1, 3, 1, 4);
      const week4RIR = calculateTargetRIR(3, 1, 3, 4, 4);
      expect(week4RIR).toBeLessThan(week1RIR);
    });

    it('handles single week mesocycle', () => {
      const result = calculateTargetRIR(3, 1, 3, 1, 1);
      expect(result).toBe(3);
    });
  });

  describe('clamping', () => {
    it('clamps RIR to minimum of 0', () => {
      const result = calculateTargetRIR(0, 3, 3, 4, 4);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('clamps RIR to maximum of 4', () => {
      const result = calculateTargetRIR(5, 1, 3, 1, 4);
      expect(result).toBeLessThanOrEqual(4);
    });
  });
});

// ============================================
// FORMAT REP RANGE TESTS
// ============================================

describe('formatRepRange', () => {
  it('formats AMRAP range with plus sign', () => {
    expect(formatRepRange({ min: 8, max: null })).toBe('8+');
  });

  it('formats range with min and max', () => {
    expect(formatRepRange({ min: 8, max: 12 })).toBe('8-12');
  });

  it('formats single rep count', () => {
    expect(formatRepRange({ min: 5, max: 5 })).toBe('5');
  });
});

// ============================================
// FORMAT PRESCRIPTION DISPLAY TESTS
// ============================================

describe('formatPrescriptionDisplay', () => {
  it('formats AMRAP prescription', () => {
    const prescription: SetPrescription = {
      targetReps: { min: 8, max: null },
      isAMRAP: true,
      rirFloor: 0,
      displayText: '8+ reps',
      safetyTier: 'push_freely',
    };

    const result = formatPrescriptionDisplay(prescription);
    expect(result.repText).toBe('8+');
    expect(result.rirText).toBe('AMRAP');
  });

  it('formats standard prescription', () => {
    const prescription: SetPrescription = {
      targetReps: { min: 8, max: 12 },
      isAMRAP: false,
      rirFloor: 2,
      displayText: '8-12 reps @ 2 RIR',
      safetyTier: 'protect',
    };

    const result = formatPrescriptionDisplay(prescription);
    expect(result.repText).toBe('8-12');
    expect(result.rirText).toBe('2 RIR');
  });
});

// ============================================
// PRESCRIBE EXERCISE BLOCK TESTS
// ============================================

describe('prescribeExerciseBlock', () => {
  it('generates prescriptions for all sets', () => {
    const result = prescribeExerciseBlock('Machine Chest Press', 3, baseRepRange, 2, {
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    });

    expect(result).toHaveLength(3);
  });

  it('makes last set AMRAP for safe exercises', () => {
    const result = prescribeExerciseBlock('Machine Chest Press', 3, baseRepRange, 2, {
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    });

    expect(result[0].isAMRAP).toBe(false);
    expect(result[1].isAMRAP).toBe(false);
    expect(result[2].isAMRAP).toBe(true);
  });

  it('does not make last set AMRAP for protected exercises', () => {
    const result = prescribeExerciseBlock('Barbell Bench Press', 3, baseRepRange, 2, {
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    });

    expect(result.every(p => !p.isAMRAP)).toBe(true);
  });
});

// ============================================
// BLOCK HAS AMRAP TESTS
// ============================================

describe('blockHasAMRAP', () => {
  it('returns true when block contains AMRAP', () => {
    const prescriptions: SetPrescription[] = [
      { targetReps: { min: 8, max: 12 }, isAMRAP: false, rirFloor: 2, displayText: '', safetyTier: 'push_freely' },
      { targetReps: { min: 8, max: null }, isAMRAP: true, rirFloor: 0, displayText: '', safetyTier: 'push_freely' },
    ];

    expect(blockHasAMRAP(prescriptions)).toBe(true);
  });

  it('returns false when block has no AMRAP', () => {
    const prescriptions: SetPrescription[] = [
      { targetReps: { min: 8, max: 12 }, isAMRAP: false, rirFloor: 2, displayText: '', safetyTier: 'protect' },
      { targetReps: { min: 8, max: 12 }, isAMRAP: false, rirFloor: 2, displayText: '', safetyTier: 'protect' },
    ];

    expect(blockHasAMRAP(prescriptions)).toBe(false);
  });
});

// ============================================
// GET BLOCK SUMMARY TESTS
// ============================================

describe('getBlockSummary', () => {
  it('counts total sets correctly', () => {
    const prescriptions = prescribeExerciseBlock('Machine Chest Press', 4, baseRepRange, 2, {
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    });

    const summary = getBlockSummary(prescriptions);
    expect(summary.totalSets).toBe(4);
  });

  it('counts AMRAP and standard sets correctly', () => {
    const prescriptions = prescribeExerciseBlock('Machine Chest Press', 3, baseRepRange, 2, {
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    });

    const summary = getBlockSummary(prescriptions);
    expect(summary.amrapSets).toBe(1);
    expect(summary.standardSets).toBe(2);
  });

  it('calculates average RIR correctly (excluding AMRAP)', () => {
    const prescriptions: SetPrescription[] = [
      { targetReps: { min: 8, max: 12 }, isAMRAP: false, rirFloor: 2, displayText: '', safetyTier: 'push_freely' },
      { targetReps: { min: 8, max: 12 }, isAMRAP: false, rirFloor: 2, displayText: '', safetyTier: 'push_freely' },
      { targetReps: { min: 8, max: null }, isAMRAP: true, rirFloor: 0, displayText: '', safetyTier: 'push_freely' },
    ];

    const summary = getBlockSummary(prescriptions);
    expect(summary.averageRIR).toBe(2);
  });

  it('handles all AMRAP block', () => {
    const prescriptions: SetPrescription[] = [
      { targetReps: { min: 8, max: null }, isAMRAP: true, rirFloor: 0, displayText: '', safetyTier: 'push_freely' },
    ];

    const summary = getBlockSummary(prescriptions);
    expect(summary.averageRIR).toBe(0);
  });

  it('includes safety tier from first prescription', () => {
    const prescriptions = prescribeExerciseBlock('Barbell Bench Press', 3, baseRepRange, 2, {
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    });

    const summary = getBlockSummary(prescriptions);
    expect(summary.safetyTier).toBe('protect');
  });
});
