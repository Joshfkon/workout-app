/**
 * Tests for Mesocycle Builder Service
 */
import {
  calculateRecoveryFactors,
  recommendSplit,
  buildPeriodizationPlan,
} from '../mesocycleBuilder';
import type { ExtendedUserProfile, RecoveryFactors, Rating, Goal, Experience } from '@/types/schema';

// Helper to create a profile with defaults
function createProfile(overrides: Partial<ExtendedUserProfile> = {}): ExtendedUserProfile {
  return {
    goal: 'bulk',
    experience: 'intermediate',
    heightCm: 175,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: 2,
    daysAvailable: 4,
    sessionMinutes: 60,
    equipment: [],
    injuries: [],
    weakPoints: [],
    ...overrides,
  };
}

describe('mesocycleBuilder', () => {
  describe('calculateRecoveryFactors', () => {
    it('returns neutral multipliers for average profile', () => {
      const profile = createProfile({
        age: 30,
        sleepQuality: 3 as Rating,
        stressLevel: 3 as Rating,
        trainingAge: 2,
      });

      const factors = calculateRecoveryFactors(profile);

      expect(factors.volumeMultiplier).toBeCloseTo(1.0, 1);
      expect(factors.frequencyMultiplier).toBeCloseTo(1.0, 1);
      expect(factors.deloadFrequencyWeeks).toBe(5);
      expect(factors.warnings).toHaveLength(0);
    });

    describe('age adjustments', () => {
      it('increases capacity for young lifters (< 25)', () => {
        const profile = createProfile({ age: 22 });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeGreaterThan(1.0);
        expect(factors.frequencyMultiplier).toBeGreaterThan(1.0);
        expect(factors.deloadFrequencyWeeks).toBe(6);
      });

      it('slightly reduces capacity for 35-45 age range', () => {
        const profile = createProfile({ age: 40 });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeLessThan(1.0);
        expect(factors.deloadFrequencyWeeks).toBe(5);
      });

      it('significantly reduces capacity for 45-55 age range', () => {
        const profile = createProfile({ age: 50 });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeLessThan(0.9);
        expect(factors.frequencyMultiplier).toBeLessThan(1.0);
        expect(factors.deloadFrequencyWeeks).toBe(4);
        expect(factors.warnings.length).toBeGreaterThan(0);
      });

      it('maximally reduces capacity for 55+ age', () => {
        const profile = createProfile({ age: 60 });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeLessThan(0.8);
        expect(factors.frequencyMultiplier).toBeLessThan(0.95);
        expect(factors.deloadFrequencyWeeks).toBe(3);
        expect(factors.warnings.some(w => w.includes('recovery'))).toBe(true);
      });
    });

    describe('sleep quality adjustments', () => {
      it('reduces capacity for poor sleep (1-2)', () => {
        const profile = createProfile({ sleepQuality: 1 as Rating });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeLessThan(0.8);
        expect(factors.warnings.some(w => w.includes('Sleep'))).toBe(true);
      });

      it('increases capacity for excellent sleep (5)', () => {
        const profile = createProfile({ sleepQuality: 5 as Rating });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeGreaterThan(1.0);
      });
    });

    describe('stress level adjustments', () => {
      it('increases capacity for low stress (1)', () => {
        const profile = createProfile({ stressLevel: 1 as Rating });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeGreaterThan(1.0);
      });

      it('reduces capacity for high stress (4-5)', () => {
        const profile = createProfile({ stressLevel: 5 as Rating });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeLessThan(0.8);
        expect(factors.warnings.some(w => w.includes('stress'))).toBe(true);
      });
    });

    describe('training age adjustments', () => {
      it('reduces volume for new lifters (< 1 year)', () => {
        const profile = createProfile({ trainingAge: 0.5 });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.volumeMultiplier).toBeLessThan(1.0);
        expect(factors.deloadFrequencyWeeks).toBe(8); // Longer between deloads
      });

      it('shortens deload frequency for experienced lifters (5+ years)', () => {
        const profile = createProfile({ trainingAge: 7 });
        const factors = calculateRecoveryFactors(profile);

        expect(factors.deloadFrequencyWeeks).toBeLessThanOrEqual(4);
      });
    });

    describe('multiplier bounds', () => {
      it('caps volume multiplier between 0.5 and 1.3', () => {
        // Very unfavorable conditions
        const lowProfile = createProfile({
          age: 65,
          sleepQuality: 1 as Rating,
          stressLevel: 5 as Rating,
        });
        const lowFactors = calculateRecoveryFactors(lowProfile);
        expect(lowFactors.volumeMultiplier).toBeGreaterThanOrEqual(0.5);

        // Very favorable conditions
        const highProfile = createProfile({
          age: 22,
          sleepQuality: 5 as Rating,
          stressLevel: 1 as Rating,
        });
        const highFactors = calculateRecoveryFactors(highProfile);
        expect(highFactors.volumeMultiplier).toBeLessThanOrEqual(1.3);
      });

      it('caps frequency multiplier between 0.7 and 1.2', () => {
        const lowProfile = createProfile({ age: 65 });
        const lowFactors = calculateRecoveryFactors(lowProfile);
        expect(lowFactors.frequencyMultiplier).toBeGreaterThanOrEqual(0.7);

        const highProfile = createProfile({ age: 22 });
        const highFactors = calculateRecoveryFactors(highProfile);
        expect(highFactors.frequencyMultiplier).toBeLessThanOrEqual(1.2);
      });
    });
  });

  describe('recommendSplit', () => {
    describe('novice recommendations', () => {
      it('recommends Full Body for novices training 2-3 days', () => {
        const result2 = recommendSplit(2, 'bulk', 'novice');
        expect(result2.split).toBe('Full Body');

        const result3 = recommendSplit(3, 'bulk', 'novice');
        expect(result3.split).toBe('Full Body');
      });

      it('recommends Upper/Lower for novices training 4 days', () => {
        const result = recommendSplit(4, 'bulk', 'novice');
        expect(result.split).toBe('Upper/Lower');
        expect(result.alternatives.some(a => a.split === 'Full Body')).toBe(true);
      });

      it('still recommends Upper/Lower for novices at 5-6 days', () => {
        const result5 = recommendSplit(5, 'bulk', 'novice');
        expect(result5.split).toBe('Upper/Lower');

        const result6 = recommendSplit(6, 'bulk', 'novice');
        expect(result6.split).toBe('Upper/Lower');
      });
    });

    describe('intermediate/advanced recommendations', () => {
      it('recommends Full Body for 2 days', () => {
        const result = recommendSplit(2, 'bulk', 'intermediate');
        expect(result.split).toBe('Full Body');
        expect(result.alternatives).toHaveLength(0);
      });

      it('recommends Full Body for 3 days', () => {
        const result = recommendSplit(3, 'bulk', 'intermediate');
        expect(result.split).toBe('Full Body');
        expect(result.alternatives.length).toBeGreaterThan(0);
      });

      it('recommends Upper/Lower for 4 days', () => {
        const result = recommendSplit(4, 'bulk', 'intermediate');
        expect(result.split).toBe('Upper/Lower');
      });

      it('recommends Arnold for 5 days bulking', () => {
        const result = recommendSplit(5, 'bulk', 'intermediate');
        expect(result.split).toBe('Arnold');
      });

      it('recommends Upper/Lower for 5 days cutting/maintenance', () => {
        const result = recommendSplit(5, 'cut', 'intermediate');
        expect(result.split).toBe('Upper/Lower');
      });

      it('recommends PPL for 6 days', () => {
        const result = recommendSplit(6, 'bulk', 'intermediate');
        expect(result.split).toBe('PPL');
      });
    });

    describe('goal-specific adjustments', () => {
      it('recommends Full Body for cutting at 3 days', () => {
        const result = recommendSplit(3, 'cut', 'intermediate');
        expect(result.split).toBe('Full Body');
        expect(result.reason).toContain('deficit');
      });
    });

    describe('session time adjustments', () => {
      it('suggests Full Body alternative for short sessions at 4 days', () => {
        const result = recommendSplit(4, 'bulk', 'intermediate', 30);
        expect(result.alternatives.some(a => a.split === 'Full Body')).toBe(true);
      });
    });
  });

  describe('buildPeriodizationPlan', () => {
    it('uses linear periodization for novices', () => {
      const profile = createProfile({ experience: 'novice', trainingAge: 0.5 });
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 0.8,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 8,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);

      expect(plan.model).toBe('linear');
      expect(plan.deloadStrategy).toBe('reactive');
    });

    it('uses daily undulating for intermediate bulking', () => {
      const profile = createProfile({
        experience: 'intermediate',
        trainingAge: 2,
        goal: 'bulk',
      });
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 5,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);

      expect(plan.model).toBe('daily_undulating');
      expect(plan.deloadStrategy).toBe('proactive');
    });

    it('uses weekly undulating for intermediate cutting', () => {
      const profile = createProfile({
        experience: 'intermediate',
        trainingAge: 2,
        goal: 'cut',
      });
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 5,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);

      expect(plan.model).toBe('weekly_undulating');
    });

    it('uses block periodization for advanced lifters', () => {
      const profile = createProfile({
        experience: 'advanced',
        trainingAge: 5,
      });
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 4,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);

      expect(plan.model).toBe('block');
    });

    it('sets mesocycle weeks to deload frequency + 1', () => {
      const profile = createProfile();
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 4,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);

      expect(plan.mesocycleWeeks).toBe(5); // 4 training + 1 deload
      expect(plan.deloadFrequency).toBe(4);
    });

    it('includes weekly progression data', () => {
      const profile = createProfile();
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 4,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);

      expect(plan.weeklyProgression).toBeDefined();
      expect(Array.isArray(plan.weeklyProgression)).toBe(true);
      expect(plan.weeklyProgression.length).toBeGreaterThan(0);
    });
  });
});
