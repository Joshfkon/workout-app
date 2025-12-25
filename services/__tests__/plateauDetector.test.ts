/**
 * Tests for services/plateauDetector.ts
 * E1RM calculation, trend analysis, plateau detection
 */

import {
  calculateE1RM,
  calculateE1RMBrzycki,
  analyzeExerciseTrend,
  detectPlateau,
  generatePlateauSuggestions,
  createPlateauAlert,
  analyzeAllExercises,
  getPlateauedExercises,
  calculateProgressScore,
  type DetectPlateauInput,
} from '../plateauDetector';

import type { ExercisePerformanceSnapshot, ExerciseTrend } from '@/types/schema';

// ============================================
// E1RM CALCULATION TESTS
// ============================================

describe('calculateE1RM (Epley formula)', () => {
  it('returns weight for 1 rep at RPE 10', () => {
    expect(calculateE1RM(100, 1, 10)).toBe(100);
  });

  it('returns 0 for 0 reps or 0 weight', () => {
    expect(calculateE1RM(0, 10, 10)).toBe(0);
    expect(calculateE1RM(100, 0, 10)).toBe(0);
  });

  it('calculates E1RM correctly with Epley formula', () => {
    // weight * (1 + reps/30)
    // 100 * (1 + 10/30) = 100 * 1.333 = 133.33
    expect(calculateE1RM(100, 10, 10)).toBeCloseTo(133.33, 1);
  });

  it('adjusts for RPE (reps in reserve)', () => {
    // 100kg x 8 reps @ RPE 8 = 2 RIR = effective 10 reps
    // 100 * (1 + 10/30) = 133.33
    expect(calculateE1RM(100, 8, 8)).toBeCloseTo(133.33, 1);
  });

  it('handles low rep sets', () => {
    // 100kg x 3 reps @ RPE 10
    // 100 * (1 + 3/30) = 100 * 1.1 = 110
    expect(calculateE1RM(100, 3, 10)).toBeCloseTo(110, 1);
  });

  it('handles high rep sets', () => {
    // 50kg x 20 reps @ RPE 10
    // 50 * (1 + 20/30) = 50 * 1.667 = 83.33
    expect(calculateE1RM(50, 20, 10)).toBeCloseTo(83.33, 1);
  });
});

describe('calculateE1RMBrzycki', () => {
  it('returns weight for 1 rep at RPE 10', () => {
    expect(calculateE1RMBrzycki(100, 1, 10)).toBe(100);
  });

  it('returns 0 for 0 reps or 0 weight', () => {
    expect(calculateE1RMBrzycki(0, 10, 10)).toBe(0);
    expect(calculateE1RMBrzycki(100, 0, 10)).toBe(0);
  });

  it('calculates E1RM using Brzycki formula for low reps', () => {
    // weight / (1.0278 - 0.0278 * reps)
    // For 5 reps: 100 / (1.0278 - 0.0278*5) = 100 / 0.8888 ≈ 112.5
    const result = calculateE1RMBrzycki(100, 5, 10);
    expect(result).toBeGreaterThan(110);
    expect(result).toBeLessThan(120);
  });

  it('falls back to Epley for high rep sets (>10)', () => {
    const brzycki = calculateE1RMBrzycki(50, 15, 10);
    const epley = calculateE1RM(50, 15, 10);
    expect(brzycki).toBeCloseTo(epley, 0);
  });
});

// ============================================
// TREND ANALYSIS TESTS
// ============================================

describe('analyzeExerciseTrend', () => {
  it('returns empty trend for no data', () => {
    const result = analyzeExerciseTrend([]);

    expect(result.dataPoints).toHaveLength(0);
    expect(result.weeklyChange).toBe(0);
    expect(result.isPlateaued).toBe(false);
  });

  it('calculates positive weekly change for improving performance', () => {
    const snapshots: ExercisePerformanceSnapshot[] = [
      createSnapshot('2024-01-01', 100),
      createSnapshot('2024-01-08', 105),
      createSnapshot('2024-01-15', 110),
      createSnapshot('2024-01-22', 115),
    ];

    const result = analyzeExerciseTrend(snapshots);

    expect(result.weeklyChange).toBeGreaterThan(0);
    expect(result.isPlateaued).toBe(false);
  });

  it('detects plateau when E1RM stagnates', () => {
    const snapshots: ExercisePerformanceSnapshot[] = [
      createSnapshot('2024-01-01', 100),
      createSnapshot('2024-01-08', 100.5),
      createSnapshot('2024-01-15', 100),
      createSnapshot('2024-01-22', 101),
    ];

    const result = analyzeExerciseTrend(snapshots);

    expect(result.isPlateaued).toBe(true);
  });

  it('sorts data points by date', () => {
    const snapshots: ExercisePerformanceSnapshot[] = [
      createSnapshot('2024-01-15', 110),
      createSnapshot('2024-01-01', 100),
      createSnapshot('2024-01-08', 105),
    ];

    const result = analyzeExerciseTrend(snapshots);

    expect(result.dataPoints[0].e1rm).toBe(100);
    expect(result.dataPoints[2].e1rm).toBe(110);
  });

  it('returns exerciseId from first snapshot', () => {
    const snapshots: ExercisePerformanceSnapshot[] = [
      { ...createSnapshot('2024-01-01', 100), exerciseId: 'bench-press' },
    ];

    const result = analyzeExerciseTrend(snapshots);
    expect(result.exerciseId).toBe('bench-press');
  });
});

// ============================================
// PLATEAU DETECTION TESTS
// ============================================

describe('detectPlateau', () => {
  it('returns not plateaued with insufficient data', () => {
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [createSnapshot('2024-01-01', 100)],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
    expect(result.weeksSinceProgress).toBe(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('detects plateau when no progress for 3+ weeks', () => {
    // Peak is at the start, followed by stagnation
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 105), // Peak
        createSnapshot('2024-01-08', 100),
        createSnapshot('2024-01-15', 99),
        createSnapshot('2024-01-22', 100),
        createSnapshot('2024-01-29', 100),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(true);
    expect(result.weeksSinceProgress).toBeGreaterThanOrEqual(3);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('returns correct peak E1RM', () => {
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 110),
        createSnapshot('2024-01-15', 105),
        createSnapshot('2024-01-22', 108),
      ],
    };

    const result = detectPlateau(input);

    expect(result.peakE1RM).toBe(110);
    expect(result.currentE1RM).toBe(108);
  });

  it('calculates weeks since progress correctly', () => {
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 110), // Peak
        createSnapshot('2024-01-08', 105),
        createSnapshot('2024-01-15', 106),
        createSnapshot('2024-01-22', 105),
      ],
    };

    const result = detectPlateau(input);

    expect(result.weeksSinceProgress).toBe(3);
    expect(result.lastProgressDate).toBe('2024-01-01');
  });

  it('does not flag as plateau when progressing', () => {
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 105),
        createSnapshot('2024-01-15', 110),
        createSnapshot('2024-01-22', 115),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
    expect(result.weeksSinceProgress).toBe(0);
  });
});

// ============================================
// PLATEAU SUGGESTIONS TESTS
// ============================================

describe('generatePlateauSuggestions', () => {
  it('returns empty array for no snapshots', () => {
    const trend: ExerciseTrend = {
      exerciseId: 'test',
      dataPoints: [],
      weeklyChange: 0,
      isPlateaued: true,
    };

    const suggestions = generatePlateauSuggestions([], trend);
    expect(suggestions).toHaveLength(0);
  });

  it('suggests lower reps when average reps > 10', () => {
    const snapshots = [
      createSnapshotWithDetails('2024-01-01', 100, 12, 7, 3),
      createSnapshotWithDetails('2024-01-08', 100, 13, 7, 3),
      createSnapshotWithDetails('2024-01-15', 100, 11, 8, 3),
      createSnapshotWithDetails('2024-01-22', 100, 12, 7, 3),
      createSnapshotWithDetails('2024-01-29', 100, 12, 7.5, 3),
      createSnapshotWithDetails('2024-02-05', 100, 11, 8, 3),
    ];

    const trend: ExerciseTrend = {
      exerciseId: 'test',
      dataPoints: [],
      weeklyChange: 0,
      isPlateaued: true,
    };

    const suggestions = generatePlateauSuggestions(snapshots, trend);

    expect(suggestions.some(s => s.toLowerCase().includes('lower rep'))).toBe(true);
  });

  it('suggests higher reps when average reps < 6', () => {
    const snapshots = [
      createSnapshotWithDetails('2024-01-01', 150, 4, 9, 3),
      createSnapshotWithDetails('2024-01-08', 150, 5, 9, 3),
      createSnapshotWithDetails('2024-01-15', 150, 4, 9.5, 3),
      createSnapshotWithDetails('2024-01-22', 150, 5, 9, 3),
      createSnapshotWithDetails('2024-01-29', 150, 4, 9, 3),
      createSnapshotWithDetails('2024-02-05', 150, 5, 9.5, 3),
    ];

    const trend: ExerciseTrend = {
      exerciseId: 'test',
      dataPoints: [],
      weeklyChange: 0,
      isPlateaued: true,
    };

    const suggestions = generatePlateauSuggestions(snapshots, trend);

    expect(suggestions.some(s => s.toLowerCase().includes('higher rep'))).toBe(true);
  });

  it('suggests more volume when sets are low', () => {
    const snapshots = [
      createSnapshotWithDetails('2024-01-01', 100, 8, 8, 2),
      createSnapshotWithDetails('2024-01-08', 100, 8, 8, 2),
      createSnapshotWithDetails('2024-01-15', 100, 8, 8, 2),
      createSnapshotWithDetails('2024-01-22', 100, 8, 8, 2),
      createSnapshotWithDetails('2024-01-29', 100, 8, 8, 2),
      createSnapshotWithDetails('2024-02-05', 100, 8, 8, 2),
    ];

    const trend: ExerciseTrend = {
      exerciseId: 'test',
      dataPoints: [],
      weeklyChange: 0,
      isPlateaued: true,
    };

    const suggestions = generatePlateauSuggestions(snapshots, trend);

    expect(suggestions.some(s => s.toLowerCase().includes('volume') || s.toLowerCase().includes('sets'))).toBe(true);
  });

  it('suggests pushing harder when RPE is low', () => {
    const snapshots = [
      createSnapshotWithDetails('2024-01-01', 100, 8, 6, 3),
      createSnapshotWithDetails('2024-01-08', 100, 8, 6.5, 3),
      createSnapshotWithDetails('2024-01-15', 100, 8, 6, 3),
      createSnapshotWithDetails('2024-01-22', 100, 8, 6, 3),
      createSnapshotWithDetails('2024-01-29', 100, 8, 6.5, 3),
      createSnapshotWithDetails('2024-02-05', 100, 8, 6, 3),
    ];

    const trend: ExerciseTrend = {
      exerciseId: 'test',
      dataPoints: [],
      weeklyChange: 0,
      isPlateaued: true,
    };

    const suggestions = generatePlateauSuggestions(snapshots, trend);

    expect(suggestions.some(s => s.toLowerCase().includes('push') || s.toLowerCase().includes('failure'))).toBe(true);
  });

  it('limits suggestions to 5', () => {
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      createSnapshotWithDetails(`2024-01-${String(i + 1).padStart(2, '0')}`, 100, 8, 8, 3)
    );

    const trend: ExerciseTrend = {
      exerciseId: 'test',
      dataPoints: [],
      weeklyChange: -0.5,
      isPlateaued: true,
    };

    const suggestions = generatePlateauSuggestions(snapshots, trend);

    expect(suggestions.length).toBeLessThanOrEqual(5);
  });
});

// ============================================
// PLATEAU ALERT TESTS
// ============================================

describe('createPlateauAlert', () => {
  it('returns null when not plateaued', () => {
    const result = {
      isPlateaued: false,
      weeksSinceProgress: 0,
      lastProgressDate: null,
      currentE1RM: 100,
      peakE1RM: 100,
      suggestions: [],
    };

    const alert = createPlateauAlert('user-1', 'bench-press', result);
    expect(alert).toBeNull();
  });

  it('creates alert when plateaued', () => {
    const result = {
      isPlateaued: true,
      weeksSinceProgress: 4,
      lastProgressDate: '2024-01-01',
      currentE1RM: 100,
      peakE1RM: 105,
      suggestions: ['Try lower reps', 'Add volume'],
    };

    const alert = createPlateauAlert('user-1', 'bench-press', result);

    expect(alert).not.toBeNull();
    expect(alert!.userId).toBe('user-1');
    expect(alert!.exerciseId).toBe('bench-press');
    expect(alert!.weeksSinceProgress).toBe(4);
    expect(alert!.suggestedActions).toEqual(['Try lower reps', 'Add volume']);
    expect(alert!.dismissed).toBe(false);
  });
});

// ============================================
// BATCH ANALYSIS TESTS
// ============================================

describe('analyzeAllExercises', () => {
  it('analyzes multiple exercises', () => {
    const exerciseSnapshots = new Map<string, ExercisePerformanceSnapshot[]>();

    exerciseSnapshots.set('bench-press', [
      createSnapshot('2024-01-01', 100),
      createSnapshot('2024-01-08', 100),
      createSnapshot('2024-01-15', 100),
      createSnapshot('2024-01-22', 100),
    ]);

    exerciseSnapshots.set('squat', [
      createSnapshot('2024-01-01', 140),
      createSnapshot('2024-01-08', 145),
      createSnapshot('2024-01-15', 150),
      createSnapshot('2024-01-22', 155),
    ]);

    const results = analyzeAllExercises(exerciseSnapshots);

    expect(results.size).toBe(2);
    expect(results.get('bench-press')!.isPlateaued).toBe(true);
    expect(results.get('squat')!.isPlateaued).toBe(false);
  });
});

describe('getPlateauedExercises', () => {
  it('returns only plateaued exercises sorted by severity', () => {
    const results = new Map();

    results.set('bench-press', {
      isPlateaued: true,
      weeksSinceProgress: 3,
      suggestions: [],
    });

    results.set('squat', {
      isPlateaued: false,
      weeksSinceProgress: 0,
      suggestions: [],
    });

    results.set('deadlift', {
      isPlateaued: true,
      weeksSinceProgress: 5,
      suggestions: [],
    });

    const plateaued = getPlateauedExercises(results);

    expect(plateaued).toHaveLength(2);
    expect(plateaued[0].exerciseId).toBe('deadlift'); // Worse plateau first
    expect(plateaued[1].exerciseId).toBe('bench-press');
  });

  it('returns empty array when no plateaus', () => {
    const results = new Map();
    results.set('squat', { isPlateaued: false, weeksSinceProgress: 0, suggestions: [] });

    expect(getPlateauedExercises(results)).toHaveLength(0);
  });
});

describe('calculateProgressScore', () => {
  it('returns 100 for empty results', () => {
    const results = new Map();
    expect(calculateProgressScore(results)).toBe(100);
  });

  it('returns 100 for all progressing exercises', () => {
    const results = new Map();
    results.set('bench', { isPlateaued: false, weeksSinceProgress: 0, suggestions: [] });
    results.set('squat', { isPlateaued: false, weeksSinceProgress: 0, suggestions: [] });

    expect(calculateProgressScore(results)).toBe(100);
  });

  it('reduces score for plateaued exercises', () => {
    const results = new Map();
    results.set('bench', { isPlateaued: true, weeksSinceProgress: 2, suggestions: [] });
    results.set('squat', { isPlateaued: false, weeksSinceProgress: 0, suggestions: [] });

    const score = calculateProgressScore(results);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(50);
  });

  it('penalizes more for longer plateaus', () => {
    const shortPlateau = new Map();
    shortPlateau.set('bench', { isPlateaued: true, weeksSinceProgress: 2, suggestions: [] });

    const longPlateau = new Map();
    longPlateau.set('bench', { isPlateaued: true, weeksSinceProgress: 6, suggestions: [] });

    expect(calculateProgressScore(shortPlateau)).toBeGreaterThan(calculateProgressScore(longPlateau));
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function createSnapshot(date: string, e1rm: number): ExercisePerformanceSnapshot {
  return {
    exerciseId: 'test-exercise',
    sessionDate: date,
    estimatedE1RM: e1rm,
    topSetWeight: e1rm * 0.75,
    topSetReps: 8,
    topSetRpe: 8,
    totalWorkingSets: 3,
  };
}

function createSnapshotWithDetails(
  date: string,
  e1rm: number,
  reps: number,
  rpe: number,
  sets: number
): ExercisePerformanceSnapshot {
  return {
    exerciseId: 'test-exercise',
    sessionDate: date,
    estimatedE1RM: e1rm,
    topSetWeight: e1rm * 0.75,
    topSetReps: reps,
    topSetRpe: rpe,
    totalWorkingSets: sets,
  };
}
