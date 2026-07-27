/**
 * Tests for services/plateauDetector.ts
 * E1RM calculation, trend analysis, plateau detection
 */

import {
  calculateE1RM,
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

describe('calculateE1RM (canonical estimator)', () => {
  it('returns weight for 1 rep at RPE 10', () => {
    expect(calculateE1RM(100, 1, 10)).toBe(100);
  });

  it('returns 0 for 0 reps or 0 weight', () => {
    expect(calculateE1RM(0, 10, 10)).toBe(0);
    expect(calculateE1RM(100, 0, 10)).toBe(0);
  });

  it('calculates E1RM using the canonical (Brzycki) formula', () => {
    // 100kg x 10 reps @ RPE 10: 100 * 36/(37-10) = 133.33
    expect(calculateE1RM(100, 10, 10)).toBeCloseTo(133.3, 0);
  });

  it('adjusts for RPE (reps in reserve)', () => {
    // 100kg x 8 reps @ RPE 8 = 2 RIR = effective 10 reps -> 133.33
    expect(calculateE1RM(100, 8, 8)).toBeCloseTo(133.3, 0);
  });

  it('handles low rep sets', () => {
    // 100kg x 3 reps @ RPE 10: 100 * 36/34 = 105.9
    const result = calculateE1RM(100, 3, 10);
    expect(result).toBeGreaterThan(105);
    expect(result).toBeLessThan(115);
  });

  it('returns 0 (no estimate) beyond 15 effective reps — never extrapolates', () => {
    // A 20-rep set is endurance work; it carries no e1RM claim, and the
    // snapshot builders skip it rather than trending a fabricated number.
    expect(calculateE1RM(50, 20, 10)).toBe(0);
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

  it('does not produce NaN when all data points share the same date (zero denominator)', () => {
    const snapshots: ExercisePerformanceSnapshot[] = [
      createSnapshot('2024-01-01', 100),
      createSnapshot('2024-01-01', 105),
      createSnapshot('2024-01-01', 110),
      createSnapshot('2024-01-01', 115),
    ];

    const result = analyzeExerciseTrend(snapshots);
    expect(Number.isNaN(result.weeklyChange)).toBe(false);
    expect(result.weeklyChange).toBe(0);
  });

  it('does not divide by zero when the baseline E1RM is zero', () => {
    const snapshots: ExercisePerformanceSnapshot[] = [
      createSnapshot('2024-01-01', 0),
      createSnapshot('2024-01-08', 0),
      createSnapshot('2024-01-15', 0),
      createSnapshot('2024-01-22', 0),
    ];

    const result = analyzeExerciseTrend(snapshots);
    expect(Number.isNaN(result.weeklyChange)).toBe(false);
    // An all-zero e1RM series is corrupt DATA, not a training outcome: the
    // robust trend hard-rejects every point and no verdict fires — a
    // "plateau" measured against zeros would be as fictional as the zeros.
    expect(result.isPlateaued).toBe(false);
    expect(result.confidence).toBe('insufficient');
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

  it('ignores peaks older than the analysis window', () => {
    // Year-old sessions at a heavier bodyweight set a peak the user may
    // never touch again — they must not count against recent progress.
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2023-01-01', 140), // old peak, out of window
        createSnapshot('2023-01-08', 138),
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 105),
        createSnapshot('2024-01-15', 110),
        createSnapshot('2024-01-22', 115),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
    expect(result.peakE1RM).toBe(115); // peak within the window, not 140
    expect(result.weeksSinceProgress).toBe(0);
  });

  it('measures a real plateau only against the recent window', () => {
    // Stagnant recent training is still flagged, but weeksSinceProgress is
    // measured within the window, not from a year-old peak.
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2023-01-01', 140), // old peak, out of window
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 100),
        createSnapshot('2024-01-15', 100),
        createSnapshot('2024-01-22', 100),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(true);
    expect(result.peakE1RM).toBe(100);
    expect(result.weeksSinceProgress).toBe(3); // not ~52
  });

  it('does not flag an exercise that has not been trained recently', () => {
    // Flat history that ended long before the reference date: the user
    // stopped doing the exercise, so there is nothing to alert on.
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 100),
        createSnapshot('2024-01-15', 100),
        createSnapshot('2024-01-22', 100),
      ],
      referenceDate: '2025-01-22', // a year later
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
    expect(result.suggestions).toHaveLength(0);
  });

  it('still flags recently-trained exercises when a referenceDate is given', () => {
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 100),
        createSnapshot('2024-01-15', 100),
        createSnapshot('2024-01-22', 100),
      ],
      referenceDate: '2024-01-25', // a few days after the last session
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(true);
  });

  it('suppresses the alert when the regression trend is rising, even below a recent peak', () => {
    // Overall slope ≈ +1.6%/wk. The last four sessions' endpoints dip below
    // the peak (112 -> 110, under the bulk +2% endpoint threshold) and the
    // peak is exactly 3 weeks old — both legacy triggers fire. The fitted
    // trend must win: a rising lift cannot be plateaued.
    const input: DetectPlateauInput = {
      exerciseId: 'arnold-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 104),
        createSnapshot('2024-01-15', 112), // peak
        createSnapshot('2024-01-22', 108),
        createSnapshot('2024-01-29', 109),
        createSnapshot('2024-02-05', 110),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
  });

  it('never fires with fewer than 3 weeks since the peak, regardless of peak delta', () => {
    // 3x/wk training: the endpoint check sees 4 flat sessions spanning ~1.3
    // weeks and would have flagged this, but the peak is only ~1 week old.
    const input: DetectPlateauInput = {
      exerciseId: 'arnold-press',
      snapshots: [
        createSnapshot('2024-01-01', 102),
        createSnapshot('2024-01-04', 101),
        createSnapshot('2024-01-08', 102.5), // peak, ~1 week before the last session
        createSnapshot('2024-01-11', 101.5),
        createSnapshot('2024-01-13', 101),
        createSnapshot('2024-01-15', 101.5),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
    expect(result.weeksSinceProgress).toBeLessThan(3);
  });

  it('requires enough sessions inside the window, not just overall', () => {
    // Two year-old sessions + two recent ones: four snapshots total, but
    // only two are recent — not enough signal to call a plateau.
    const input: DetectPlateauInput = {
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2023-01-01', 120),
        createSnapshot('2023-01-08', 120),
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 100),
      ],
    };

    const result = detectPlateau(input);

    expect(result.isPlateaued).toBe(false);
  });
});

describe('detectPlateau goal awareness', () => {
  const flatSnapshots = [
    createSnapshot('2024-01-01', 100),
    createSnapshot('2024-01-08', 100),
    createSnapshot('2024-01-15', 100),
    createSnapshot('2024-01-22', 100),
  ];

  it('does not flag flat strength as a plateau on a cut', () => {
    // Holding E1RM in a deficit is success, not stagnation.
    const result = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: flatSnapshots,
      goal: 'cut',
    });

    expect(result.isPlateaued).toBe(false);
  });

  it('tolerates a small strength dip on a cut', () => {
    const result = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 100),
        createSnapshot('2024-01-15', 99),
        createSnapshot('2024-01-22', 98), // -2%, within cut tolerance
      ],
      goal: 'cut',
    });

    expect(result.isPlateaued).toBe(false);
  });

  it('flags a real strength decline on a cut, with deficit-aware advice', () => {
    const result = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 98),
        createSnapshot('2024-01-15', 97),
        createSnapshot('2024-01-22', 96), // -4%, beyond cut tolerance
      ],
      goal: 'cut',
    });

    expect(result.isPlateaued).toBe(true);
    expect(result.suggestions[0].toLowerCase()).toContain('deficit');
  });

  it('does not flag flat strength at maintenance (both spellings)', () => {
    for (const goal of ['maintenance', 'maintain'] as const) {
      const result = detectPlateau({
        exerciseId: 'bench-press',
        snapshots: flatSnapshots,
        goal,
      });
      expect(result.isPlateaued).toBe(false);
    }
  });

  it('gives recomp extra time before calling a plateau', () => {
    // 4 flat weeks: plateau on a bulk, still within tolerance on recomp.
    const bulk = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: flatSnapshots,
      goal: 'bulk',
    });
    const recomp = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: flatSnapshots,
      goal: 'recomp',
    });

    expect(bulk.isPlateaued).toBe(true);
    expect(recomp.isPlateaued).toBe(false);
  });

  it('still flags a long stall on recomp', () => {
    // Six weeks without a new peak exceeds even the recomp allowance.
    const result = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: [
        createSnapshot('2024-01-01', 100),
        createSnapshot('2024-01-08', 100),
        createSnapshot('2024-01-15', 100),
        createSnapshot('2024-01-22', 100),
        createSnapshot('2024-01-29', 100),
        createSnapshot('2024-02-05', 100),
        createSnapshot('2024-02-12', 100),
      ],
      goal: 'recomp',
    });

    expect(result.isPlateaued).toBe(true);
  });

  it('treats an omitted goal like the original bulk-style behavior', () => {
    const withDefault = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: flatSnapshots,
    });
    const withBulk = detectPlateau({
      exerciseId: 'bench-press',
      snapshots: flatSnapshots,
      goal: 'bulk',
    });

    expect(withDefault.isPlateaued).toBe(true);
    expect(withBulk.isPlateaued).toBe(true);
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
      isCalibrating: false,
      calibrationReason: null,
      weeksSinceProgress: 0,
      lastProgressDate: null,
      currentE1RM: 100,
      recentPeakE1RM: 100,
      segmentBestE1RM: 100,
      peakE1RM: 100,
      discontinuityDate: null,
      suggestions: [],
    };

    const alert = createPlateauAlert('user-1', 'bench-press', result);
    expect(alert).toBeNull();
  });

  it('creates alert when plateaued', () => {
    const result = {
      isPlateaued: true,
      isCalibrating: false,
      calibrationReason: null,
      weeksSinceProgress: 4,
      lastProgressDate: '2024-01-01',
      currentE1RM: 100,
      recentPeakE1RM: 105,
      segmentBestE1RM: 105,
      peakE1RM: 105,
      discontinuityDate: null,
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

// ============================================
// TREND-ROBUSTNESS VERIFICATION FIXTURES
// (real Progress-tab repro cases — see the trend-robustness task)
// ============================================

describe('Cable Fly repro — equipment discontinuity + zero', () => {
  /**
   * Jun 29 was logged on a different machine (57.5); Jul 4's corrupt zero
   * never reaches snapshots (builders skip inestimable sessions); current
   * sessions are on the correct machine at the 40–42.5 level.
   */
  const cableFly = [
    createSnapshot('2026-06-29', 57.5),
    createSnapshot('2026-07-14', 40),
    createSnapshot('2026-07-21', 40),
    createSnapshot('2026-07-27', 42.5),
  ];

  it('anchors the trend to the post-shift segment: mildly positive, not −24.9%/wk', () => {
    const trend = analyzeExerciseTrend(cableFly);
    expect(trend.discontinuityDate).toBe('2026-07-14');
    const pctPerWeek = (trend.weeklyChange / 42.5) * 100;
    expect(pctPerWeek).toBeGreaterThan(1);
    expect(pctPerWeek).toBeLessThan(6);
  });

  it('does not fire a plateau while the segment is rebuilding, and reports segment vocabulary', () => {
    const result = detectPlateau({
      exerciseId: 'cable-fly',
      snapshots: cableFly,
      referenceDate: '2026-07-27',
    });
    // 42.5 is the segment best; 57.5 belongs to the pre-shift segment and
    // must not be the peak that "No progress in 4 weeks" is measured from.
    expect(result.isPlateaued).toBe(false);
    expect(result.segmentBestE1RM).toBe(42.5);
    expect(result.discontinuityDate).toBe('2026-07-14');
    // No self-contradiction: recent peak equals current → no "0.0 from peak".
    expect(result.recentPeakE1RM).toBeLessThanOrEqual(42.5);
  });

  it('suppresses all verdicts (isCalibrating) with fewer than 3 post-shift sessions', () => {
    const rebuilding = [
      createSnapshot('2026-06-22', 56),
      createSnapshot('2026-06-29', 57.5),
      createSnapshot('2026-07-14', 40),
      createSnapshot('2026-07-21', 40),
    ];
    const result = detectPlateau({
      exerciseId: 'cable-fly',
      snapshots: rebuilding,
      referenceDate: '2026-07-21',
    });
    expect(result.isCalibrating).toBe(true);
    expect(result.calibrationReason).toBe('equipment_change');
    expect(result.isPlateaued).toBe(false);
  });

  it('honors a user-marked equipment change even below the heuristic threshold', () => {
    const subtle = [
      createSnapshot('2026-06-22', 50),
      createSnapshot('2026-06-29', 50.5),
      createSnapshot('2026-07-14', 44), // −13%: below the 25% heuristic
      createSnapshot('2026-07-21', 44.5),
      createSnapshot('2026-07-27', 45),
    ];
    const trend = analyzeExerciseTrend(subtle, undefined, {
      knownDiscontinuities: ['2026-07-14'],
    });
    expect(trend.discontinuityDate).toBe('2026-07-14');
    expect(trend.pointsUsed).toBe(3);
    expect(trend.weeklyChange).toBeGreaterThan(0);
  });

  it('RPE-aware progress: same load/reps at lower RPE is a higher e1RM (set-level progress counts)', () => {
    // Same 30 kg × 8, but 1.5 RPE cheaper — the RPE-blind comparison the old
    // detector ran would call these identical; the canonical estimator reads
    // the extra reps in reserve as a higher capacity.
    expect(calculateE1RM(30, 8, 7.5)).toBeGreaterThan(calculateE1RM(30, 8, 9));
    // At/beyond the effective-rep cap the estimate saturates (a floor, not an
    // extrapolation) — it must never DECREASE from a cheaper set.
    expect(calculateE1RM(30, 12, 7.5)).toBeGreaterThanOrEqual(calculateE1RM(30, 11, 9));
  });
});

function createSnapshot(date: string, e1rm: number): ExercisePerformanceSnapshot {
  return {
    id: `snapshot-${date}`,
    userId: 'user-1',
    exerciseId: 'test-exercise',
    sessionDate: date,
    estimatedE1RM: e1rm,
    topSetWeightKg: e1rm * 0.75,
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
    id: `snapshot-${date}`,
    userId: 'user-1',
    exerciseId: 'test-exercise',
    sessionDate: date,
    estimatedE1RM: e1rm,
    topSetWeightKg: e1rm * 0.75,
    topSetReps: reps,
    topSetRpe: rpe,
    totalWorkingSets: sets,
  };
}
