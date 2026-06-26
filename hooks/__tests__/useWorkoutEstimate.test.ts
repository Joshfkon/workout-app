import { renderHook } from '@testing-library/react';
import { useWorkoutEstimate, estimateWorkoutTime } from '../useWorkoutEstimate';
import type { ExerciseBlock } from '@/types/schema';

// Create minimal mock exercise blocks for testing
function createMockBlock(targetSets: number, targetRestSeconds?: number): ExerciseBlock {
  return {
    id: `block-${Math.random()}`,
    sessionId: 'session-1',
    exerciseId: 'ex-1',
    order: 1,
    targetSets,
    targetRepRange: [8, 12] as [number, number],
    targetRir: 2,
    targetWeightKg: 50,
    targetRestSeconds,
  } as unknown as ExerciseBlock;
}

describe('useWorkoutEstimate', () => {
  describe('with empty blocks', () => {
    it('returns zero estimates', () => {
      const { result } = renderHook(() =>
        useWorkoutEstimate({
          exerciseBlocks: [],
          completedSets: 0,
        })
      );

      expect(result.current.totalMinutes).toBe(0);
      expect(result.current.remainingMinutes).toBe(0);
      expect(result.current.totalSets).toBe(0);
      expect(result.current.formattedTotal).toBe('');
      expect(result.current.formattedRemaining).toBe('');
    });
  });

  describe('with exercise blocks', () => {
    it('calculates total time correctly', () => {
      // 2 exercises, 3 sets each, 120 seconds rest
      // Total sets: 6
      // Rest time: 120 * 2 (rest after sets 1,2) * 2 exercises = 480 seconds
      // Set execution: 6 * 45 = 270 seconds
      // Warmup buffer: 600 seconds
      // Total: 480 + 270 + 600 = 1350 seconds = ~23 minutes
      const blocks = [
        createMockBlock(3, 120),
        createMockBlock(3, 120),
      ];

      const { result } = renderHook(() =>
        useWorkoutEstimate({
          exerciseBlocks: blocks,
          completedSets: 0,
        })
      );

      expect(result.current.totalSets).toBe(6);
      expect(result.current.totalMinutes).toBe(23); // (480 + 270 + 600) / 60 rounded
      expect(result.current.formattedTotal).toBe('~23 min');
    });

    it('uses default rest time when block has no targetRestSeconds', () => {
      // 1 exercise, 4 sets, default rest (180 seconds)
      // Rest time: 180 * 3 = 540 seconds
      // Set execution: 4 * 45 = 180 seconds
      // Warmup buffer: 600 seconds
      // Total: 540 + 180 + 600 = 1320 seconds = 22 minutes
      const blocks = [createMockBlock(4, undefined)];

      const { result } = renderHook(() =>
        useWorkoutEstimate({
          exerciseBlocks: blocks,
          completedSets: 0,
          defaultRestSeconds: 180,
        })
      );

      expect(result.current.totalMinutes).toBe(22);
    });

    it('calculates remaining time based on completed sets', () => {
      const blocks = [
        createMockBlock(3, 120),
        createMockBlock(3, 120),
      ];

      // Complete 3 of 6 sets (50%)
      const { result } = renderHook(() =>
        useWorkoutEstimate({
          exerciseBlocks: blocks,
          completedSets: 3,
        })
      );

      expect(result.current.completedSets).toBe(3);
      expect(result.current.totalSets).toBe(6);
      // Remaining should be roughly half of (rest + execution), excluding warmup
      // (480 + 270) * 0.5 = 375 seconds = ~6 minutes
      expect(result.current.remainingMinutes).toBe(6);
      expect(result.current.formattedRemaining).toBe('~6 min left');
    });

    it('shows "Complete!" when all sets are done', () => {
      const blocks = [createMockBlock(3, 120)];

      const { result } = renderHook(() =>
        useWorkoutEstimate({
          exerciseBlocks: blocks,
          completedSets: 3,
        })
      );

      expect(result.current.remainingMinutes).toBe(0);
      expect(result.current.formattedRemaining).toBe('Complete!');
    });
  });
});

describe('estimateWorkoutTime', () => {
  it('calculates total workout time', () => {
    const blocks = [
      createMockBlock(4, 90), // 3 rest periods * 90s = 270s + 4 * 45s = 180s
      createMockBlock(3, 90), // 2 rest periods * 90s = 180s + 3 * 45s = 135s
    ];

    // Total: 270 + 180 + 180 + 135 + 600 (warmup) = 1365 seconds = 23 minutes
    const result = estimateWorkoutTime(blocks, 180);
    expect(result).toBe(23);
  });

  it('returns 10 minutes for zero sets (warmup only)', () => {
    const result = estimateWorkoutTime([], 180);
    expect(result).toBe(10); // Just warmup buffer
  });
});
