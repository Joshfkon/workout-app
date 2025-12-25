/**
 * Tests for services/bodyCompEngine.ts
 * FFMI calculations, body composition analysis, coaching recommendations
 */

import {
  calculateFFMI,
  getNaturalFFMILimit,
  getFFMILabel,
  analyzeBodyCompTrend,
  generateCoachingRecommendations,
  calculateBodyCompTargets,
  calculateLeanMass,
  calculateFatMass,
  formatFFMI,
  getFFMIColor,
  getTrendIndicator,
} from '../bodyCompEngine';

import type { DexaScan, FFMIClassification, Experience, Goal } from '@/types/schema';

// ============================================
// TEST FIXTURES
// ============================================

const createMockDexaScan = (overrides: Partial<DexaScan> = {}): DexaScan => ({
  id: 'scan-1',
  userId: 'user-1',
  scanDate: '2024-01-15',
  bodyFatPercent: 15,
  leanMassKg: 70,
  fatMassKg: 12.35,
  totalWeightKg: 82.35,
  ...overrides,
});

// ============================================
// FFMI CALCULATION TESTS
// ============================================

describe('calculateFFMI', () => {
  it('calculates FFMI correctly', () => {
    // FFMI = lean mass (kg) / height (m)²
    // 70kg / (1.80m)² = 70 / 3.24 = 21.6
    const result = calculateFFMI(70, 180);

    expect(result.ffmi).toBeCloseTo(21.6, 1);
  });

  it('calculates normalized FFMI', () => {
    // Normalized FFMI = FFMI + 6.1 × (1.8 - height in m)
    // For 180cm: normalizedFfmi = ffmi + 6.1 * (1.8 - 1.8) = ffmi
    const result = calculateFFMI(70, 180);

    expect(result.normalizedFfmi).toBeCloseTo(21.6, 1);
  });

  it('adjusts normalized FFMI for shorter heights', () => {
    // For 170cm: normalizedFfmi = ffmi + 6.1 * (1.8 - 1.7) = ffmi + 0.61
    const result = calculateFFMI(65, 170);
    const baseFFMI = 65 / (1.7 * 1.7);

    expect(result.normalizedFfmi).toBeGreaterThan(result.ffmi);
    expect(result.normalizedFfmi).toBeCloseTo(baseFFMI + 0.61, 1);
  });

  it('adjusts normalized FFMI for taller heights', () => {
    // For 190cm: normalizedFfmi = ffmi + 6.1 * (1.8 - 1.9) = ffmi - 0.61
    const result = calculateFFMI(75, 190);

    expect(result.normalizedFfmi).toBeLessThan(result.ffmi);
  });

  it('classifies FFMI correctly', () => {
    const belowAvg = calculateFFMI(55, 180);
    expect(belowAvg.classification).toBe('below_average');

    const average = calculateFFMI(60, 180);
    expect(average.classification).toBe('average');

    const aboveAvg = calculateFFMI(68, 180);
    expect(aboveAvg.classification).toBe('above_average');

    const excellent = calculateFFMI(73, 180);
    expect(excellent.classification).toBe('excellent');

    const superior = calculateFFMI(78, 180);
    expect(superior.classification).toBe('superior');

    const suspicious = calculateFFMI(85, 180);
    expect(suspicious.classification).toBe('suspicious');
  });

  it('calculates percent of natural limit', () => {
    // FFMI of 20, limit of 25 = 80%
    const result = calculateFFMI(65, 180); // ~20 FFMI

    expect(result.percentOfLimit).toBeGreaterThan(70);
    expect(result.percentOfLimit).toBeLessThanOrEqual(100);
  });

  it('caps percent at 100', () => {
    const result = calculateFFMI(90, 180); // Very high FFMI

    expect(result.percentOfLimit).toBe(100);
  });

  it('sets natural limit to 25', () => {
    const result = calculateFFMI(70, 180);

    expect(result.naturalLimit).toBe(25);
  });
});

// ============================================
// NATURAL FFMI LIMIT TESTS
// ============================================

describe('getNaturalFFMILimit', () => {
  it('returns higher limit for novices', () => {
    expect(getNaturalFFMILimit('novice')).toBe(22);
  });

  it('returns moderate limit for intermediate', () => {
    expect(getNaturalFFMILimit('intermediate')).toBe(24);
  });

  it('returns full limit for advanced', () => {
    expect(getNaturalFFMILimit('advanced')).toBe(25);
  });
});

// ============================================
// FFMI LABEL TESTS
// ============================================

describe('getFFMILabel', () => {
  it('returns correct labels', () => {
    expect(getFFMILabel('below_average')).toBe('Below Average');
    expect(getFFMILabel('average')).toBe('Average');
    expect(getFFMILabel('above_average')).toBe('Above Average');
    expect(getFFMILabel('excellent')).toBe('Excellent');
    expect(getFFMILabel('superior')).toBe('Superior');
    expect(getFFMILabel('suspicious')).toBe('Elite (Near Genetic Limit)');
  });
});

// ============================================
// BODY COMP TREND ANALYSIS TESTS
// ============================================

describe('analyzeBodyCompTrend', () => {
  it('returns null with less than 2 scans', () => {
    expect(analyzeBodyCompTrend([], 180)).toBeNull();
    expect(analyzeBodyCompTrend([createMockDexaScan()], 180)).toBeNull();
  });

  it('returns null for scans too close together', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-01-15' }),
      createMockDexaScan({ scanDate: '2024-01-18' }),
    ];

    expect(analyzeBodyCompTrend(scans, 180)).toBeNull();
  });

  it('calculates lean mass change rate', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-01-01', leanMassKg: 70 }),
      createMockDexaScan({ scanDate: '2024-02-01', leanMassKg: 71 }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result).not.toBeNull();
    expect(result!.leanMassChangeRate).toBeCloseTo(1, 1); // ~1kg/month
  });

  it('calculates fat mass change rate', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-01-01', fatMassKg: 15 }),
      createMockDexaScan({ scanDate: '2024-02-01', fatMassKg: 13 }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.fatMassChangeRate).toBeCloseTo(-2, 1); // -2kg/month
  });

  it('identifies gaining_muscle trend', () => {
    const scans = [
      createMockDexaScan({
        scanDate: '2024-01-01',
        leanMassKg: 70,
        fatMassKg: 12,
        bodyFatPercent: 14.6,
      }),
      createMockDexaScan({
        scanDate: '2024-02-01',
        leanMassKg: 71,
        fatMassKg: 13,
        bodyFatPercent: 15.5,
      }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.trend).toBe('gaining_muscle');
  });

  it('identifies losing_fat trend', () => {
    const scans = [
      createMockDexaScan({
        scanDate: '2024-01-01',
        leanMassKg: 70,
        fatMassKg: 15,
      }),
      createMockDexaScan({
        scanDate: '2024-02-01',
        leanMassKg: 70,
        fatMassKg: 12,
      }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.trend).toBe('losing_fat');
  });

  it('identifies losing_muscle trend', () => {
    const scans = [
      createMockDexaScan({
        scanDate: '2024-01-01',
        leanMassKg: 72,
        fatMassKg: 12,
      }),
      createMockDexaScan({
        scanDate: '2024-02-01',
        leanMassKg: 70,
        fatMassKg: 12,
      }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.trend).toBe('losing_muscle');
  });

  it('identifies recomping trend', () => {
    const scans = [
      createMockDexaScan({
        scanDate: '2024-01-01',
        leanMassKg: 69,
        fatMassKg: 15,
      }),
      createMockDexaScan({
        scanDate: '2024-02-01',
        leanMassKg: 71,
        fatMassKg: 13,
      }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.trend).toBe('recomping');
  });

  it('identifies stable trend', () => {
    const scans = [
      createMockDexaScan({
        scanDate: '2024-01-01',
        leanMassKg: 70,
        fatMassKg: 12,
      }),
      createMockDexaScan({
        scanDate: '2024-02-01',
        leanMassKg: 70.05,
        fatMassKg: 12.05,
      }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.trend).toBe('stable');
  });

  it('sorts scans by date', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-02-01', leanMassKg: 71 }),
      createMockDexaScan({ scanDate: '2024-01-01', leanMassKg: 70 }),
    ];

    const result = analyzeBodyCompTrend(scans, 180);

    expect(result!.leanMassChangeRate).toBeGreaterThan(0); // Should show gain
  });
});

// ============================================
// COACHING RECOMMENDATIONS TESTS
// ============================================

describe('generateCoachingRecommendations', () => {
  it('suggests getting started with no scans', () => {
    const recommendations = generateCoachingRecommendations([], 180, 'bulk', 'intermediate');

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].type).toBe('info');
    expect(recommendations[0].title).toBe('Get Started');
  });

  it('warns about high body fat during bulk', () => {
    const scans = [
      createMockDexaScan({ bodyFatPercent: 22, leanMassKg: 70 }),
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'bulk', 'intermediate');

    expect(recommendations.some((r) => r.title.includes('Mini-Cut'))).toBe(true);
  });

  it('warns about muscle loss risk at low body fat during cut', () => {
    const scans = [
      createMockDexaScan({ bodyFatPercent: 8, leanMassKg: 75 }),
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'cut', 'intermediate');

    expect(recommendations.some((r) => r.title.includes('Muscle Loss'))).toBe(true);
  });

  it('celebrates near genetic potential', () => {
    const scans = [
      createMockDexaScan({ leanMassKg: 78, bodyFatPercent: 12 }), // High FFMI
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'bulk', 'intermediate');

    expect(recommendations.some((r) => r.title.includes('Genetic Potential'))).toBe(true);
  });

  it('warns about fast fat gain during bulk', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-01-01', leanMassKg: 70, fatMassKg: 12 }),
      createMockDexaScan({ scanDate: '2024-02-01', leanMassKg: 70.5, fatMassKg: 14 }),
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'bulk', 'intermediate');

    expect(recommendations.some((r) => r.title.includes('Fat Gain Too Fast'))).toBe(true);
  });

  it('warns about muscle loss during cut', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-01-01', leanMassKg: 72, fatMassKg: 15 }),
      createMockDexaScan({ scanDate: '2024-02-01', leanMassKg: 70, fatMassKg: 13 }),
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'cut', 'intermediate');

    expect(recommendations.some((r) => r.title.includes('Muscle Loss Detected'))).toBe(true);
  });

  it('celebrates successful recomp', () => {
    const scans = [
      createMockDexaScan({ scanDate: '2024-01-01', leanMassKg: 69, fatMassKg: 15 }),
      createMockDexaScan({ scanDate: '2024-02-01', leanMassKg: 71, fatMassKg: 13 }),
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'maintenance', 'intermediate');

    expect(recommendations.some((r) => r.type === 'achievement' && r.title.includes('Recomp'))).toBe(true);
  });

  it('sorts recommendations by priority', () => {
    const scans = [
      createMockDexaScan({ bodyFatPercent: 22, leanMassKg: 70 }),
    ];

    const recommendations = generateCoachingRecommendations(scans, 180, 'bulk', 'intermediate');

    // Higher priority items should come first
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i - 1].priority).toBeGreaterThanOrEqual(recommendations[i].priority);
    }
  });
});

// ============================================
// BODY COMP TARGETS TESTS
// ============================================

describe('calculateBodyCompTargets', () => {
  const baseScan = createMockDexaScan({
    bodyFatPercent: 15,
    leanMassKg: 70,
  });

  it('sets bulk targets correctly', () => {
    const targets = calculateBodyCompTargets(baseScan, 180, 'bulk', 'intermediate');

    expect(targets.direction).toBe('bulk');
    expect(targets.targetBodyFat).toBeGreaterThanOrEqual(15);
    expect(targets.targetBodyFat).toBeLessThanOrEqual(18);
    expect(targets.targetFfmi).toBeGreaterThan(21);
    expect(targets.calorieAdjustment).toBeGreaterThan(0);
  });

  it('sets cut targets correctly', () => {
    const targets = calculateBodyCompTargets(baseScan, 180, 'cut', 'intermediate');

    expect(targets.direction).toBe('cut');
    expect(targets.targetBodyFat).toBeLessThan(15);
    expect(targets.targetBodyFat).toBeGreaterThanOrEqual(10);
    expect(targets.calorieAdjustment).toBeLessThan(0);
  });

  it('sets maintenance targets correctly', () => {
    const targets = calculateBodyCompTargets(baseScan, 180, 'maintenance', 'intermediate');

    expect(targets.direction).toBe('maintain');
    expect(targets.targetBodyFat).toBe(15);
    expect(targets.calorieAdjustment).toBe(0);
    expect(targets.estimatedWeeks).toBe(0);
  });

  it('caps bulk body fat at 18%', () => {
    const highBfScan = createMockDexaScan({ bodyFatPercent: 17 });
    const targets = calculateBodyCompTargets(highBfScan, 180, 'bulk', 'intermediate');

    expect(targets.targetBodyFat).toBeLessThanOrEqual(18);
  });

  it('caps cut body fat at 10%', () => {
    const lowBfScan = createMockDexaScan({ bodyFatPercent: 12 });
    const targets = calculateBodyCompTargets(lowBfScan, 180, 'cut', 'intermediate');

    expect(targets.targetBodyFat).toBeGreaterThanOrEqual(10);
  });

  it('respects FFMI natural limit', () => {
    const highLeanScan = createMockDexaScan({ leanMassKg: 78 });
    const targets = calculateBodyCompTargets(highLeanScan, 180, 'bulk', 'intermediate');

    expect(targets.targetFfmi).toBeLessThanOrEqual(24); // Intermediate limit
  });

  it('estimates reasonable timelines', () => {
    const targets = calculateBodyCompTargets(baseScan, 180, 'cut', 'intermediate');

    expect(targets.estimatedWeeks).toBeGreaterThan(0);
  });
});

// ============================================
// UTILITY FUNCTION TESTS
// ============================================

describe('calculateLeanMass', () => {
  it('calculates lean mass from weight and body fat', () => {
    // 80kg at 20% body fat = 64kg lean mass
    expect(calculateLeanMass(80, 20)).toBe(64);

    // 100kg at 15% body fat = 85kg lean mass
    expect(calculateLeanMass(100, 15)).toBe(85);
  });

  it('handles 0% body fat', () => {
    expect(calculateLeanMass(80, 0)).toBe(80);
  });
});

describe('calculateFatMass', () => {
  it('calculates fat mass from weight and body fat', () => {
    // 80kg at 20% body fat = 16kg fat mass
    expect(calculateFatMass(80, 20)).toBe(16);

    // 100kg at 15% body fat = 15kg fat mass
    expect(calculateFatMass(100, 15)).toBe(15);
  });

  it('handles 0% body fat', () => {
    expect(calculateFatMass(80, 0)).toBe(0);
  });
});

describe('formatFFMI', () => {
  it('formats to one decimal place', () => {
    expect(formatFFMI(21.567)).toBe('21.6');
    expect(formatFFMI(22)).toBe('22.0');
    expect(formatFFMI(23.123)).toBe('23.1');
  });
});

describe('getFFMIColor', () => {
  it('returns appropriate color classes', () => {
    expect(getFFMIColor('below_average')).toContain('surface');
    expect(getFFMIColor('average')).toContain('primary');
    expect(getFFMIColor('above_average')).toContain('primary');
    expect(getFFMIColor('excellent')).toContain('success');
    expect(getFFMIColor('superior')).toContain('accent');
    expect(getFFMIColor('suspicious')).toContain('warning');
  });
});

describe('getTrendIndicator', () => {
  it('returns up arrow for positive rate', () => {
    const result = getTrendIndicator(0.5);
    expect(result.icon).toBe('↑');
    expect(result.color).toContain('success');
  });

  it('returns down arrow for negative rate', () => {
    const result = getTrendIndicator(-0.5);
    expect(result.icon).toBe('↓');
    expect(result.color).toContain('danger');
  });

  it('returns right arrow for stable rate', () => {
    const result = getTrendIndicator(0.05);
    expect(result.icon).toBe('→');
    expect(result.color).toContain('surface');
  });
});
