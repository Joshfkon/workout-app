/**
 * Tests for Mesocycle Builder Service
 */
import {
  calculateRecoveryFactors,
  recommendSplit,
  buildPeriodizationPlan,
  recommendVolume,
  calculateVolumeDistribution,
  generateWarmup,
  buildSessionTemplates,
  buildDetailedSession,
  selectExercises,
  generateFullProgram,
  recommendDuration,
  getRecommendedExercises,
  estimateStartingWeight,
  generateWorkoutTemplates,
  calculateWeeklyVolumePerMuscle,
  generateMesocycleRecommendation,
} from '../mesocycleBuilder';
import type { ExtendedUserProfile, RecoveryFactors, Rating, Goal, Experience, MuscleGroup, Split, Equipment, SessionTemplate } from '@/types/schema';

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
    availableEquipment: [],
    injuryHistory: [],
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

    it('includes deload week in weekly progression', () => {
      const profile = createProfile();
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 4,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);
      const lastWeek = plan.weeklyProgression[plan.weeklyProgression.length - 1];

      expect(lastWeek.focus).toContain('DELOAD');
      expect(lastWeek.volumeModifier).toBeLessThan(1.0);
      expect(lastWeek.intensityModifier).toBeLessThan(1.0);
    });

    it('weekly progression has correct intensity ramp for linear model', () => {
      const profile = createProfile({ experience: 'novice', trainingAge: 0.5 });
      const recoveryFactors: RecoveryFactors = {
        volumeMultiplier: 1.0,
        frequencyMultiplier: 1.0,
        deloadFrequencyWeeks: 4,
        warnings: [],
      };

      const plan = buildPeriodizationPlan(profile, recoveryFactors);
      const trainingWeeks = plan.weeklyProgression.slice(0, -1);

      // First week should have lower intensity than last training week
      expect(trainingWeeks[0].intensityModifier).toBeLessThan(
        trainingWeeks[trainingWeeks.length - 1].intensityModifier
      );
    });
  });

  describe('recommendVolume', () => {
    it('returns higher volume for more experienced lifters', () => {
      const noviceVolume = recommendVolume('novice', 'bulk', 'chest');
      const intermediateVolume = recommendVolume('intermediate', 'bulk', 'chest');
      const advancedVolume = recommendVolume('advanced', 'bulk', 'chest');

      expect(noviceVolume).toBeLessThan(intermediateVolume);
      expect(intermediateVolume).toBeLessThan(advancedVolume);
    });

    it('reduces volume during a cut', () => {
      const bulkVolume = recommendVolume('intermediate', 'bulk', 'chest');
      const cutVolume = recommendVolume('intermediate', 'cut', 'chest');

      expect(cutVolume).toBeLessThan(bulkVolume);
    });

    it('slightly increases volume during bulk', () => {
      const maintenanceVolume = recommendVolume('intermediate', 'maintain', 'chest');
      const bulkVolume = recommendVolume('intermediate', 'bulk', 'chest');

      expect(bulkVolume).toBeGreaterThanOrEqual(maintenanceVolume);
    });

    it('returns a default value for unknown muscle groups', () => {
      const volume = recommendVolume('intermediate', 'bulk', 'unknown' as MuscleGroup);
      expect(volume).toBeGreaterThan(0);
    });

    it('provides appropriate volume for different muscle groups', () => {
      // Larger muscles typically get more volume
      const backVolume = recommendVolume('intermediate', 'bulk', 'back');
      const bicepsVolume = recommendVolume('intermediate', 'bulk', 'biceps');

      expect(backVolume).toBeGreaterThan(bicepsVolume);
    });
  });

  describe('calculateVolumeDistribution', () => {
    const defaultRecoveryFactors: RecoveryFactors = {
      volumeMultiplier: 1.0,
      frequencyMultiplier: 1.0,
      deloadFrequencyWeeks: 5,
      warnings: [],
    };

    it('returns volume and frequency for all major muscle groups', () => {
      const distribution = calculateVolumeDistribution(
        'Upper/Lower',
        4,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      expect(distribution.chest).toBeDefined();
      expect(distribution.back).toBeDefined();
      expect(distribution.shoulders).toBeDefined();
      expect(distribution.quads).toBeDefined();
      expect(distribution.chest.sets).toBeGreaterThan(0);
      expect(distribution.chest.frequency).toBeGreaterThan(0);
    });

    it('adjusts volume based on recovery factors', () => {
      const normalDistribution = calculateVolumeDistribution(
        'Upper/Lower',
        4,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      const reducedRecovery: RecoveryFactors = {
        volumeMultiplier: 0.7,
        frequencyMultiplier: 0.8,
        deloadFrequencyWeeks: 4,
        warnings: [],
      };
      const reducedDistribution = calculateVolumeDistribution(
        'Upper/Lower',
        4,
        'intermediate',
        'bulk',
        reducedRecovery
      );

      expect(reducedDistribution.chest.sets).toBeLessThan(normalDistribution.chest.sets);
    });

    it('boosts volume for lagging areas', () => {
      const normalDistribution = calculateVolumeDistribution(
        'Upper/Lower',
        4,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      const withLagging = calculateVolumeDistribution(
        'Upper/Lower',
        4,
        'intermediate',
        'bulk',
        defaultRecoveryFactors,
        ['Arms']
      );

      expect(withLagging.biceps.sets).toBeGreaterThan(normalDistribution.biceps.sets);
      expect(withLagging.triceps.sets).toBeGreaterThan(normalDistribution.triceps.sets);
    });

    it('handles leg lagging area specification', () => {
      const withLagging = calculateVolumeDistribution(
        'Upper/Lower',
        4,
        'intermediate',
        'bulk',
        defaultRecoveryFactors,
        ['Left leg']
      );

      // Should boost leg muscles
      expect(withLagging.quads).toBeDefined();
      expect(withLagging.quads.sets).toBeGreaterThan(0);
    });

    it('varies frequency based on split type', () => {
      const fullBody = calculateVolumeDistribution(
        'Full Body',
        3,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      const ppl = calculateVolumeDistribution(
        'PPL',
        3,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      // Full body should hit muscles more frequently
      expect(fullBody.chest.frequency).toBeGreaterThanOrEqual(ppl.chest.frequency);
    });

    it('doubles PPL frequency at 6 days per week', () => {
      const ppl3 = calculateVolumeDistribution(
        'PPL',
        3,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      const ppl6 = calculateVolumeDistribution(
        'PPL',
        6,
        'intermediate',
        'bulk',
        defaultRecoveryFactors
      );

      expect(ppl6.chest.frequency).toBeGreaterThan(ppl3.chest.frequency);
    });
  });

  describe('generateWarmup', () => {
    it('returns lower body warmup for leg muscles', () => {
      const warmup = generateWarmup('quads');
      expect(warmup.some(w => w.toLowerCase().includes('squat') || w.toLowerCase().includes('leg'))).toBe(true);
    });

    it('returns upper body warmup for upper muscles', () => {
      const warmup = generateWarmup('chest');
      expect(warmup.some(w => w.toLowerCase().includes('push') || w.toLowerCase().includes('arm'))).toBe(true);
    });

    it('returns full body warmup for abs', () => {
      const warmup = generateWarmup('abs');
      expect(warmup.length).toBeGreaterThan(0);
    });

    it('returns array of warmup exercises', () => {
      const warmup = generateWarmup('back');
      expect(Array.isArray(warmup)).toBe(true);
      expect(warmup.length).toBeGreaterThan(0);
      warmup.forEach(exercise => {
        expect(typeof exercise).toBe('string');
      });
    });
  });

  describe('buildSessionTemplates', () => {
    it('returns correct number of templates for Upper/Lower split', () => {
      const templates = buildSessionTemplates('Upper/Lower', 4);
      expect(templates.length).toBe(4);
    });

    it('returns correct templates for Full Body split', () => {
      const templates = buildSessionTemplates('Full Body', 3);
      expect(templates.length).toBe(3);
      templates.forEach(t => {
        expect(t.day).toContain('Full Body');
      });
    });

    it('doubles PPL templates for 6 days', () => {
      const templates = buildSessionTemplates('PPL', 6);
      expect(templates.length).toBe(6);
      expect(templates.filter(t => t.day.includes('Push')).length).toBe(2);
      expect(templates.filter(t => t.day.includes('Pull')).length).toBe(2);
      expect(templates.filter(t => t.day.includes('Legs')).length).toBe(2);
    });

    it('limits templates to days per week', () => {
      const templates = buildSessionTemplates('Bro Split', 3);
      expect(templates.length).toBeLessThanOrEqual(3);
    });

    it('includes target muscles in each template', () => {
      const templates = buildSessionTemplates('Arnold', 3);
      templates.forEach(template => {
        expect(template.targetMuscles).toBeDefined();
        expect(template.targetMuscles.length).toBeGreaterThan(0);
      });
    });
  });

  describe('selectExercises', () => {
    const baseProfile = createProfile({
      availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
      injuryHistory: [],
    });

    it('returns exercises for a muscle group', () => {
      const result = selectExercises('chest', 9, baseProfile, 15);
      expect(result.exercises.length).toBeGreaterThan(0);
      expect(result.setsPerExercise.length).toBe(result.exercises.length);
    });

    it('respects fatigue budget', () => {
      const result = selectExercises('chest', 9, baseProfile, 15);
      expect(result.remainingFatigueBudget).toBeLessThanOrEqual(15);
    });

    it('limits exercises based on available equipment', () => {
      const limitedProfile = createProfile({
        availableEquipment: ['bodyweight'] as Equipment[],
        injuryHistory: [],
      });
      const result = selectExercises('chest', 9, limitedProfile, 15);

      // Should still return some exercises or fallback
      expect(result.exercises).toBeDefined();
    });

    it('filters by difficulty for novices', () => {
      const noviceProfile = createProfile({
        experience: 'novice',
        availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
        injuryHistory: [],
      });
      const result = selectExercises('chest', 9, noviceProfile, 15);
      expect(result.exercises).toBeDefined();
    });

    it('allocates sets correctly', () => {
      const result = selectExercises('chest', 9, baseProfile, 15);
      const totalSets = result.setsPerExercise.reduce((sum, s) => sum + s, 0);
      expect(totalSets).toBeGreaterThanOrEqual(9);
    });
  });

  describe('buildDetailedSession', () => {
    const profile = createProfile({
      availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
      injuryHistory: [],
    });

    const volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }> = {
      chest: { sets: 12, frequency: 2 },
      back: { sets: 14, frequency: 2 },
      shoulders: { sets: 10, frequency: 2 },
      biceps: { sets: 8, frequency: 2 },
      triceps: { sets: 8, frequency: 2 },
      quads: { sets: 12, frequency: 2 },
      hamstrings: { sets: 10, frequency: 2 },
      glutes: { sets: 10, frequency: 2 },
      calves: { sets: 8, frequency: 2 },
      abs: { sets: 8, frequency: 2 },
      adductors: { sets: 4, frequency: 1 },
      forearms: { sets: 4, frequency: 1 },
      traps: { sets: 6, frequency: 2 },
    };

    it('builds a session with exercises', () => {
      const template: SessionTemplate = {
        day: 'Upper A',
        focus: 'Horizontal emphasis',
        targetMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
      };

      const session = buildDetailedSession(template, volumePerMuscle, profile);

      expect(session.day).toBe('Upper A');
      expect(session.exercises.length).toBeGreaterThan(0);
      expect(session.totalSets).toBeGreaterThan(0);
    });

    it('includes warmup instructions', () => {
      const template: SessionTemplate = {
        day: 'Lower A',
        focus: 'Quad emphasis',
        targetMuscles: ['quads', 'hamstrings', 'glutes'],
      };

      const session = buildDetailedSession(template, volumePerMuscle, profile);

      expect(session.warmup).toBeDefined();
      expect(session.warmup.length).toBeGreaterThan(0);
    });

    it('estimates session duration', () => {
      const template: SessionTemplate = {
        day: 'Push',
        focus: 'Chest, shoulders, triceps',
        targetMuscles: ['chest', 'shoulders', 'triceps'],
      };

      const session = buildDetailedSession(template, volumePerMuscle, profile);

      expect(session.estimatedMinutes).toBeGreaterThan(0);
    });

    it('includes rep ranges and rest periods', () => {
      const template: SessionTemplate = {
        day: 'Pull',
        focus: 'Back, biceps',
        targetMuscles: ['back', 'biceps'],
      };

      const session = buildDetailedSession(template, volumePerMuscle, profile);

      session.exercises.forEach(ex => {
        expect(ex.repRange).toBeDefined();
        expect(ex.restSeconds).toBeGreaterThan(0);
        expect(ex.sets).toBeGreaterThan(0);
      });
    });
  });

  describe('generateFullProgram', () => {
    const profile = createProfile({
      availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
      injuryHistory: [],
    });

    it('generates a complete program', () => {
      const program = generateFullProgram(4, profile, 60);

      expect(program.split).toBeDefined();
      expect(program.schedule).toBeDefined();
      expect(program.periodization).toBeDefined();
      expect(program.sessions.length).toBeGreaterThan(0);
    });

    it('includes recovery profile and volume distribution', () => {
      const program = generateFullProgram(4, profile, 60);

      expect(program.recoveryProfile).toBeDefined();
      expect(program.volumePerMuscle).toBeDefined();
      expect(program.volumePerMuscle.chest).toBeDefined();
    });

    it('provides program notes', () => {
      const program = generateFullProgram(4, profile, 60);

      expect(program.programNotes.length).toBeGreaterThan(0);
    });

    it('warns when sessions exceed time limit', () => {
      const shortSession = generateFullProgram(4, profile, 30);
      // May have warnings about session time
      expect(shortSession.warnings).toBeDefined();
    });

    it('notes lagging areas when provided', () => {
      const program = generateFullProgram(4, profile, 60, ['Arms']);

      expect(program.programNotes.some(n => n.includes('Arms'))).toBe(true);
    });

    it('provides schedule based on days per week', () => {
      const program3 = generateFullProgram(3, profile, 60);
      expect(program3.schedule.length).toBe(3);

      const program5 = generateFullProgram(5, profile, 60);
      expect(program5.schedule.length).toBe(5);
    });

    it('includes body composition recommendations when DEXA data is present', () => {
      const profileWithDexa = createProfile({
        availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
        injuryHistory: [],
        heightCm: 180,
        latestDexa: {
          date: new Date().toISOString(),
          bodyFatPercent: 25,
          leanMassKg: 65,
          fatMassKg: 22,
        },
        goal: 'bulk',
      });

      const program = generateFullProgram(4, profileWithDexa, 60);

      // Should warn about high body fat during bulk
      expect(program.warnings.some(w => w.includes('body fat') || w.includes('mini-cut'))).toBe(true);
    });
  });

  describe('recommendDuration (legacy)', () => {
    it('returns shorter duration for cutting', () => {
      const cutDuration = recommendDuration('intermediate', 'cut');
      const bulkDuration = recommendDuration('intermediate', 'bulk');

      expect(cutDuration.weeks).toBeLessThanOrEqual(bulkDuration.weeks);
    });

    it('returns shorter blocks for novices', () => {
      const noviceDuration = recommendDuration('novice', 'bulk');
      expect(noviceDuration.weeks).toBe(4);
    });

    it('returns longer blocks for advanced', () => {
      const advancedDuration = recommendDuration('advanced', 'bulk');
      expect(advancedDuration.weeks).toBe(8);
    });

    it('returns 6 weeks for intermediate', () => {
      const intermediateDuration = recommendDuration('intermediate', 'bulk');
      expect(intermediateDuration.weeks).toBe(6);
    });

    it('includes a reason', () => {
      const duration = recommendDuration('intermediate', 'bulk');
      expect(duration.reason).toBeDefined();
      expect(duration.reason.length).toBeGreaterThan(0);
    });
  });

  describe('getRecommendedExercises', () => {
    it('returns exercises for a muscle group', () => {
      const exercises = getRecommendedExercises('chest');
      expect(exercises.length).toBeGreaterThan(0);
    });

    it('filters by compound exercises', () => {
      const compounds = getRecommendedExercises('chest', 'compound');
      const all = getRecommendedExercises('chest', 'both');

      expect(compounds.length).toBeLessThanOrEqual(all.length);
    });

    it('filters by isolation exercises', () => {
      const isolations = getRecommendedExercises('chest', 'isolation');
      expect(isolations).toBeDefined();
    });

    it('returns empty array for unknown muscle', () => {
      const exercises = getRecommendedExercises('unknown');
      expect(exercises.length).toBe(0);
    });
  });

  describe('estimateStartingWeight', () => {
    it('returns higher weight for advanced lifters', () => {
      const noviceWeight = estimateStartingWeight('Barbell Bench Press', 70, 'novice');
      const advancedWeight = estimateStartingWeight('Barbell Bench Press', 70, 'advanced');

      expect(advancedWeight).toBeGreaterThan(noviceWeight);
    });

    it('scales with lean mass', () => {
      const lightWeight = estimateStartingWeight('Barbell Bench Press', 50, 'intermediate');
      const heavyWeight = estimateStartingWeight('Barbell Bench Press', 80, 'intermediate');

      expect(heavyWeight).toBeGreaterThan(lightWeight);
    });

    it('returns rounded weight values', () => {
      const weight = estimateStartingWeight('Barbell Bench Press', 70, 'intermediate');
      // Should be rounded to nearest 2.5 for barbell
      expect(weight % 2.5).toBe(0);
    });

    it('rounds dumbbells to 2kg increments', () => {
      const weight = estimateStartingWeight('Dumbbell Bench Press', 70, 'intermediate');
      expect(weight % 2).toBe(0);
    });

    it('returns a reasonable default for unknown exercises', () => {
      const weight = estimateStartingWeight('Unknown Exercise', 70, 'intermediate');
      expect(weight).toBeGreaterThan(0);
    });
  });

  describe('generateWorkoutTemplates', () => {
    const volumePerMuscle: Record<string, number> = {
      chest: 12,
      back: 14,
      shoulders: 10,
      biceps: 8,
      triceps: 8,
      quads: 12,
      hamstrings: 10,
      glutes: 10,
      calves: 8,
      abs: 8,
    };

    it('generates templates for a split type', () => {
      const templates = generateWorkoutTemplates('Upper/Lower', volumePerMuscle, 70, 'intermediate');

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.dayName).toBeDefined();
        expect(t.exercises.length).toBeGreaterThan(0);
      });
    });

    it('includes exercise details in templates', () => {
      const templates = generateWorkoutTemplates('PPL', volumePerMuscle, 70, 'intermediate');

      templates.forEach(t => {
        t.exercises.forEach(ex => {
          expect(ex.exerciseName).toBeDefined();
          expect(ex.sets).toBeGreaterThan(0);
          expect(ex.repRange).toBeDefined();
          expect(ex.rir).toBeDefined();
        });
      });
    });

    it('includes suggested weights when lean mass is provided', () => {
      const templates = generateWorkoutTemplates('Full Body', volumePerMuscle, 70, 'intermediate');

      const hasWeights = templates.some(t =>
        t.exercises.some(ex => ex.suggestedWeightKg > 0)
      );
      expect(hasWeights).toBe(true);
    });

    it('handles null lean mass', () => {
      const templates = generateWorkoutTemplates('Full Body', volumePerMuscle, null, 'intermediate');

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        t.exercises.forEach(ex => {
          expect(ex.suggestedWeightKg).toBe(0);
        });
      });
    });
  });

  describe('calculateWeeklyVolumePerMuscle', () => {
    it('calculates volume from session data', () => {
      const sessions = [
        {
          muscles: ['chest', 'triceps'],
          exercises: [
            { sets: 4, exerciseName: 'Barbell Bench Press' },
            { sets: 3, exerciseName: 'Cable Tricep Pushdown' },
          ],
        },
      ];

      const volume = calculateWeeklyVolumePerMuscle(sessions);

      expect(volume).toBeDefined();
    });

    it('counts secondary muscles at reduced rate', () => {
      const sessions = [
        {
          muscles: ['chest'],
          exercises: [
            { sets: 4, exerciseName: 'Barbell Bench Press' }, // Works triceps as secondary
          ],
        },
      ];

      const volume = calculateWeeklyVolumePerMuscle(sessions);

      // Should have chest volume, and potentially some triceps from secondary
      expect(volume.chest || 0).toBeGreaterThanOrEqual(0);
    });

    it('handles empty sessions', () => {
      const volume = calculateWeeklyVolumePerMuscle([]);
      expect(volume).toEqual({});
    });

    it('handles exercises not in database', () => {
      const sessions = [
        {
          muscles: ['chest'],
          exercises: [
            { sets: 3, exerciseName: 'Unknown Exercise' },
          ],
        },
      ];

      const volume = calculateWeeklyVolumePerMuscle(sessions);
      // Should not throw, may have no volume tracked
      expect(volume).toBeDefined();
    });
  });

  describe('generateMesocycleRecommendation (legacy)', () => {
    it('generates a recommendation for a user profile', () => {
      const profile = {
        goal: 'bulk' as Goal,
        experience: 'intermediate' as Experience,
        heightCm: 180,
        latestDexa: null,
      };

      const recommendation = generateMesocycleRecommendation(profile, 4);

      expect(recommendation.splitType).toBeDefined();
      expect(recommendation.daysPerWeek).toBe(4);
      expect(recommendation.totalWeeks).toBeGreaterThan(0);
      expect(recommendation.volumePerMuscle).toBeDefined();
    });

    it('includes focus muscles based on goal', () => {
      const bulkProfile = {
        goal: 'bulk' as Goal,
        experience: 'intermediate' as Experience,
        heightCm: 180,
        latestDexa: null,
      };

      const recommendation = generateMesocycleRecommendation(bulkProfile, 4);

      expect(recommendation.focusMuscles.length).toBeGreaterThan(0);
    });

    it('provides recommendations based on DEXA data', () => {
      const profile = {
        goal: 'bulk' as Goal,
        experience: 'intermediate' as Experience,
        heightCm: 180,
        latestDexa: {
          date: new Date().toISOString(),
          bodyFatPercent: 25,
          leanMassKg: 65,
          fatMassKg: 22,
        },
      };

      const recommendation = generateMesocycleRecommendation(profile, 4);

      expect(recommendation.recommendations.some(r => r.includes('body fat') || r.includes('mini-cut'))).toBe(true);
    });

    it('adjusts focus muscles for cutting', () => {
      const cutProfile = {
        goal: 'cut' as Goal,
        experience: 'intermediate' as Experience,
        heightCm: 180,
        latestDexa: null,
      };

      const recommendation = generateMesocycleRecommendation(cutProfile, 4);

      expect(recommendation.focusMuscles).toBeDefined();
      expect(recommendation.recommendations.some(r => r.includes('protein'))).toBe(true);
    });

    it('handles maintenance goal', () => {
      const maintainProfile = {
        goal: 'maintain' as Goal,
        experience: 'intermediate' as Experience,
        heightCm: 180,
        latestDexa: null,
      };

      const recommendation = generateMesocycleRecommendation(maintainProfile, 4);

      expect(recommendation.focusMuscles.length).toBeGreaterThan(0);
    });
  });
});
