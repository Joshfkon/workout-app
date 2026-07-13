import {
  recommendWeeklySetAdjustment,
  applySetAdjustment,
  computePerformanceTrend,
  type WeeklySetAdjustmentInput,
  type MuscleWeekFeedback,
} from '../weeklyProgressionEngine';
import type { VolumeLandmarks } from '@/types/schema';

const LANDMARKS: VolumeLandmarks = { mev: 6, mav: 10, mrv: 16 };

function makeInput(overrides: Partial<WeeklySetAdjustmentInput> = {}): WeeklySetAdjustmentInput {
  return {
    muscle: 'chest_upper',
    currentWeeklySets: 8,
    landmarks: LANDMARKS,
    feedback: [feedback()],
    performanceTrend: 'flat',
    weekInMeso: 2,
    isDeloadWeek: false,
    ...overrides,
  };
}

function feedback(overrides: Partial<MuscleWeekFeedback> = {}): MuscleWeekFeedback {
  return { sorenessBefore: 1, pump: 2, workload: 1, ...overrides };
}

describe('recommendWeeklySetAdjustment', () => {
  it('holds on deload weeks regardless of feedback', () => {
    const result = recommendWeeklySetAdjustment(
      makeInput({ isDeloadWeek: true, feedback: [feedback({ sorenessBefore: 0, workload: 0 })] })
    );
    expect(result.action).toBe('hold');
    expect(result.delta).toBe(0);
  });

  it('holds when no feedback was logged (never guesses upward)', () => {
    const result = recommendWeeklySetAdjustment(
      makeInput({ feedback: [{ sorenessBefore: null, pump: null, workload: null }] })
    );
    expect(result.action).toBe('hold');
    expect(result.reason).toMatch(/no recovery feedback/i);
  });

  it('holds with an empty feedback array', () => {
    const result = recommendWeeklySetAdjustment(makeInput({ feedback: [] }));
    expect(result.action).toBe('hold');
  });

  describe('remove signals', () => {
    it('removes a set when still sore at the next session (soreness 3)', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ feedback: [feedback({ sorenessBefore: 3 })] })
      );
      expect(result).toMatchObject({ action: 'remove', delta: -1 });
      expect(result.reason).toMatch(/still sore/i);
    });

    it('removes a set when workload felt like too much (workload 3)', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ feedback: [feedback({ workload: 3 })] })
      );
      expect(result).toMatchObject({ action: 'remove', delta: -1 });
    });

    it('removes a set on declining performance even with good recovery', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({
          performanceTrend: 'declining',
          feedback: [feedback({ sorenessBefore: 0, workload: 0 })],
        })
      );
      expect(result).toMatchObject({ action: 'remove', delta: -1 });
      expect(result.reason).toMatch(/declining/i);
    });

    it('uses worst-case aggregation: one bad session outweighs good ones', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({
          feedback: [feedback({ sorenessBefore: 0 }), feedback({ sorenessBefore: 3 })],
        })
      );
      expect(result.action).toBe('remove');
    });

    it('holds at the MEV floor instead of removing below it', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ currentWeeklySets: 6, feedback: [feedback({ sorenessBefore: 3 })] })
      );
      expect(result).toMatchObject({ action: 'hold', delta: 0 });
      expect(result.reason).toMatch(/minimum effective volume/i);
    });
  });

  describe('hold signals', () => {
    it('holds when soreness resolved just in time (soreness 2)', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ feedback: [feedback({ sorenessBefore: 2 })] })
      );
      expect(result).toMatchObject({ action: 'hold', delta: 0 });
    });

    it('holds when workload felt hard (workload 2)', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ feedback: [feedback({ workload: 2 })] })
      );
      expect(result).toMatchObject({ action: 'hold', delta: 0 });
    });
  });

  describe('add path', () => {
    it('adds a set when recovered and handling the workload', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ feedback: [feedback({ sorenessBefore: 1, workload: 1 })] })
      );
      expect(result).toMatchObject({ action: 'add', delta: 1 });
    });

    it('adds below MEV with a build-up reason', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({ currentWeeklySets: 4, feedback: [feedback({ sorenessBefore: 0, workload: 0 })] })
      );
      expect(result.action).toBe('add');
      expect(result.reason).toMatch(/below minimum effective volume/i);
    });

    it('never adds past MRV', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({
          currentWeeklySets: 16,
          feedback: [feedback({ sorenessBefore: 0, workload: 0, pump: 3 })],
        })
      );
      expect(result).toMatchObject({ action: 'hold', delta: 0 });
      expect(result.reason).toMatch(/maximum recoverable volume/i);
    });

    it('requires a good pump to add above MAV', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({
          currentWeeklySets: 11,
          feedback: [feedback({ sorenessBefore: 0, workload: 0, pump: 1 })],
        })
      );
      expect(result).toMatchObject({ action: 'hold', delta: 0 });
    });

    it('adds above MAV when the pump is there', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({
          currentWeeklySets: 11,
          feedback: [feedback({ sorenessBefore: 0, workload: 0, pump: 3 })],
        })
      );
      expect(result).toMatchObject({ action: 'add', delta: 1 });
    });

    it('holds above MAV when pump was never rated', () => {
      const result = recommendWeeklySetAdjustment(
        makeInput({
          currentWeeklySets: 11,
          feedback: [feedback({ sorenessBefore: 0, workload: 0, pump: null })],
        })
      );
      expect(result.action).toBe('hold');
    });
  });
});

describe('applySetAdjustment', () => {
  it('applies a positive delta', () => {
    expect(applySetAdjustment(8, { action: 'add', delta: 1, reason: '' }, LANDMARKS)).toBe(9);
  });

  it('applies a negative delta', () => {
    expect(applySetAdjustment(8, { action: 'remove', delta: -1, reason: '' }, LANDMARKS)).toBe(7);
  });

  it('clamps to MRV', () => {
    expect(applySetAdjustment(16, { action: 'add', delta: 1, reason: '' }, LANDMARKS)).toBe(16);
  });

  it('does not remove below MEV', () => {
    expect(applySetAdjustment(6, { action: 'remove', delta: -1, reason: '' }, LANDMARKS)).toBe(6);
  });

  it('does not force sets up to MEV when already below it', () => {
    expect(applySetAdjustment(4, { action: 'hold', delta: 0, reason: '' }, LANDMARKS)).toBe(4);
  });
});

describe('computePerformanceTrend', () => {
  it('reports improving when the best-set E1RM average rises more than 1%', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [102, 104],
        previousWeekBestSetE1rms: [100, 100],
      })
    ).toBe('improving');
  });

  it('reports declining when the average drops more than 1%', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [97, 98],
        previousWeekBestSetE1rms: [100, 100],
      })
    ).toBe('declining');
  });

  it('reports flat inside the ±1% dead zone', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [100.5],
        previousWeekBestSetE1rms: [100],
      })
    ).toBe('flat');
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [99.5],
        previousWeekBestSetE1rms: [100],
      })
    ).toBe('flat');
  });

  it('treats exactly ±1% as flat (strict thresholds)', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [101],
        previousWeekBestSetE1rms: [100],
      })
    ).toBe('flat');
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [99],
        previousWeekBestSetE1rms: [100],
      })
    ).toBe('flat');
  });

  it('returns flat when the current week has no data', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [],
        previousWeekBestSetE1rms: [100, 105],
      })
    ).toBe('flat');
  });

  it('returns flat when the previous week has no data (never infers from silence)', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [120, 125],
        previousWeekBestSetE1rms: [],
      })
    ).toBe('flat');
  });

  it('returns flat when both weeks are empty', () => {
    expect(
      computePerformanceTrend({ currentWeekBestSetE1rms: [], previousWeekBestSetE1rms: [] })
    ).toBe('flat');
  });

  it('ignores non-finite and non-positive entries', () => {
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [110, NaN, -5, 0],
        previousWeekBestSetE1rms: [100, Infinity],
      })
    ).toBe('improving');
    // Only garbage on one side → treated as missing data → flat
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [NaN, 0],
        previousWeekBestSetE1rms: [100],
      })
    ).toBe('flat');
  });

  it('averages across sessions rather than comparing single bests', () => {
    // Best single set improved (110 > 105) but the average fell: (110+90)/2 = 100 vs (105+103)/2 = 104
    expect(
      computePerformanceTrend({
        currentWeekBestSetE1rms: [110, 90],
        previousWeekBestSetE1rms: [105, 103],
      })
    ).toBe('declining');
  });
});

// ============================================
// PER-EXERCISE CHIP ROLLUP (existing update path)
// ============================================

import { rollUpExerciseFeedback } from '../weeklyProgressionEngine';

describe('rollUpExerciseFeedback', () => {
  it('aggregates per-exercise chips per muscle: pump best-case, workload worst-case', () => {
    const result = rollUpExerciseFeedback([
      { muscle: 'chest_upper', pump: 1, workload: 1 },
      { muscle: 'chest_upper', pump: 3, workload: 0 },
      { muscle: 'chest_upper', pump: 2, workload: 3 },
    ]);

    expect(result.chest_upper).toEqual({ pump: 3, workload: 3 });
  });

  it('skips fully-unrated exercises and preserves partial ratings', () => {
    const result = rollUpExerciseFeedback([
      { muscle: 'quads', pump: null, workload: null },
      { muscle: 'lats', pump: 2, workload: null },
    ]);

    expect(result.quads).toBeUndefined();
    expect(result.lats).toEqual({ pump: 2 });
  });

  it('produces entries the weekly engine ingests through its normal feedback input (call shape)', () => {
    const rolled = rollUpExerciseFeedback([
      { muscle: 'chest_upper', pump: 1, workload: 3 }, // "too much"
    ]);
    const entry = rolled.chest_upper!;

    // The rolled-up values feed session_muscle_feedback, which reaches the
    // engine as MuscleWeekFeedback rows — the SAME input path as the summary
    // chips. "Too much" workload must drive a remove, exactly as if it had
    // been answered on the finish screen.
    const adjustment = recommendWeeklySetAdjustment({
      muscle: 'chest_upper',
      currentWeeklySets: 12,
      landmarks: { mev: 8, mav: 14, mrv: 18 },
      feedback: [
        {
          sorenessBefore: null,
          pump: entry.pump ?? null,
          workload: entry.workload ?? null,
        },
      ],
      performanceTrend: 'flat',
      weekInMeso: 2,
      isDeloadWeek: false,
    });

    expect(adjustment.action).toBe('remove');
    expect(adjustment.delta).toBe(-1);
  });
});
