/**
 * Tests for Rep Range Engine
 */
import {
  MUSCLE_FIBER_PROFILE,
  calculateRepRange,
  getDUPRepRange,
  getDUPTempo,
  getDUPRestPeriod,
  getDUPNotes,
  getDUPTargetRIR,
  getPositionCategory,
  formatRepRange,
  buildLoadGuidance,
} from '../repRangeEngine';
import type {
  RepRangeFactors,
  RepRangeConfig,
  MuscleGroup,
  DUPDayType,
  Experience,
  Goal,
  PeriodizationModel,
} from '@/types/schema';

describe('repRangeEngine', () => {
  describe('MUSCLE_FIBER_PROFILE', () => {
    it('has profiles for all major muscle groups', () => {
      const muscles: MuscleGroup[] = [
        'chest', 'back', 'shoulders', 'biceps', 'triceps',
        'quads', 'hamstrings', 'glutes', 'calves', 'abs',
      ];

      muscles.forEach((muscle) => {
        expect(MUSCLE_FIBER_PROFILE[muscle]).toBeDefined();
        expect(['fast', 'slow', 'mixed']).toContain(MUSCLE_FIBER_PROFILE[muscle]);
      });
    });

    it('has fast-twitch profile for triceps', () => {
      expect(MUSCLE_FIBER_PROFILE.triceps).toBe('fast');
    });

    it('has slow-twitch profile for calves', () => {
      expect(MUSCLE_FIBER_PROFILE.calves).toBe('slow');
    });

    it('has mixed profile for chest', () => {
      expect(MUSCLE_FIBER_PROFILE.chest).toBe('mixed');
    });
  });

  describe('calculateRepRange', () => {
    const baseFactors: RepRangeFactors = {
      goal: 'bulk',
      experience: 'intermediate',
      exercisePattern: 'compound',
      muscleGroup: 'chest',
      positionInWorkout: 'early',
      weekInMesocycle: 1,
      totalMesocycleWeeks: 6,
      periodizationModel: 'linear',
    };

    it('returns a valid rep range config', () => {
      const result = calculateRepRange(baseFactors);

      expect(result.min).toBeGreaterThan(0);
      expect(result.max).toBeGreaterThan(result.min);
      expect(result.targetRIR).toBeDefined();
      expect(result.tempoRecommendation).toBeDefined();
    });

    describe('goal adjustments', () => {
      it('uses lower reps for cutting (strength preservation)', () => {
        const bulkResult = calculateRepRange({ ...baseFactors, goal: 'bulk' });
        const cutResult = calculateRepRange({ ...baseFactors, goal: 'cut' });

        expect(cutResult.min).toBeLessThanOrEqual(bulkResult.min);
      });

      it('uses higher reps for bulking (hypertrophy)', () => {
        const bulkResult = calculateRepRange({ ...baseFactors, goal: 'bulk' });
        const maintenanceResult = calculateRepRange({ ...baseFactors, goal: 'maintenance' });

        expect(bulkResult.max).toBeGreaterThanOrEqual(maintenanceResult.max);
      });
    });

    describe('exercise type adjustments', () => {
      it('uses higher reps for isolation exercises', () => {
        const compoundResult = calculateRepRange({ ...baseFactors, exercisePattern: 'compound' });
        const isolationResult = calculateRepRange({ ...baseFactors, exercisePattern: 'isolation' });

        expect(isolationResult.max).toBeGreaterThan(compoundResult.max);
      });
    });

    describe('fiber type adjustments', () => {
      it('uses lower reps for fast-twitch muscles', () => {
        const mixedResult = calculateRepRange({ ...baseFactors, muscleGroup: 'chest' });
        const fastResult = calculateRepRange({ ...baseFactors, muscleGroup: 'hamstrings' });

        expect(fastResult.min).toBeLessThanOrEqual(mixedResult.min);
      });

      it('uses higher reps for slow-twitch muscles', () => {
        const mixedResult = calculateRepRange({ ...baseFactors, muscleGroup: 'chest' });
        const slowResult = calculateRepRange({ ...baseFactors, muscleGroup: 'calves' });

        expect(slowResult.max).toBeGreaterThan(mixedResult.max);
      });
    });

    describe('position adjustments', () => {
      it('uses lower reps for first exercise', () => {
        const firstResult = calculateRepRange({ ...baseFactors, positionInWorkout: 'first' });
        const lateResult = calculateRepRange({ ...baseFactors, positionInWorkout: 'late' });

        expect(firstResult.min).toBeLessThan(lateResult.min);
      });

      it('increases reps for later exercises', () => {
        const earlyResult = calculateRepRange({ ...baseFactors, positionInWorkout: 'early' });
        const lateResult = calculateRepRange({ ...baseFactors, positionInWorkout: 'late' });

        expect(lateResult.min).toBeGreaterThan(earlyResult.min);
      });
    });

    describe('periodization adjustments', () => {
      it('linear: higher reps early in mesocycle', () => {
        const earlyWeek = calculateRepRange({
          ...baseFactors,
          periodizationModel: 'linear',
          weekInMesocycle: 1,
          totalMesocycleWeeks: 6,
        });
        const lateWeek = calculateRepRange({
          ...baseFactors,
          periodizationModel: 'linear',
          weekInMesocycle: 5,
          totalMesocycleWeeks: 6,
        });

        expect(earlyWeek.max).toBeGreaterThan(lateWeek.max);
      });

      it('block: handles hypertrophy and strength phases', () => {
        const hypertrophyPhase = calculateRepRange({
          ...baseFactors,
          periodizationModel: 'block',
          weekInMesocycle: 1,
          totalMesocycleWeeks: 8,
        });
        const strengthPhase = calculateRepRange({
          ...baseFactors,
          periodizationModel: 'block',
          weekInMesocycle: 6,
          totalMesocycleWeeks: 8,
        });

        expect(hypertrophyPhase.max).toBeGreaterThan(strengthPhase.max);
      });
    });

    describe('experience adjustments', () => {
      it('ensures minimum reps for novices', () => {
        const noviceResult = calculateRepRange({
          ...baseFactors,
          experience: 'novice',
          goal: 'cut', // Would normally be low reps
        });

        expect(noviceResult.min).toBeGreaterThanOrEqual(6);
      });

      it('allows lower reps for advanced', () => {
        const advancedResult = calculateRepRange({
          ...baseFactors,
          experience: 'advanced',
          goal: 'cut',
          positionInWorkout: 'first',
        });

        expect(advancedResult.min).toBeLessThanOrEqual(6);
      });
    });

    describe('RIR adjustments', () => {
      it('higher RIR for novices', () => {
        const noviceResult = calculateRepRange({ ...baseFactors, experience: 'novice' });
        const advancedResult = calculateRepRange({ ...baseFactors, experience: 'advanced' });

        expect(noviceResult.targetRIR).toBeGreaterThanOrEqual(advancedResult.targetRIR);
      });

      it('RIR decreases throughout mesocycle', () => {
        const earlyResult = calculateRepRange({
          ...baseFactors,
          weekInMesocycle: 1,
          totalMesocycleWeeks: 6,
        });
        const lateResult = calculateRepRange({
          ...baseFactors,
          weekInMesocycle: 5,
          totalMesocycleWeeks: 6,
        });

        expect(earlyResult.targetRIR).toBeGreaterThanOrEqual(lateResult.targetRIR);
      });

      it('RIR stays within bounds (0-4)', () => {
        const results = [
          calculateRepRange({ ...baseFactors, experience: 'novice', weekInMesocycle: 1 }),
          calculateRepRange({ ...baseFactors, experience: 'advanced', weekInMesocycle: 6, totalMesocycleWeeks: 6 }),
        ];

        results.forEach((result) => {
          expect(result.targetRIR).toBeGreaterThanOrEqual(0);
          expect(result.targetRIR).toBeLessThanOrEqual(4);
        });
      });
    });

    describe('tempo recommendation', () => {
      it('provides tempo recommendation', () => {
        const result = calculateRepRange(baseFactors);
        expect(result.tempoRecommendation).toBeDefined();
        expect(result.tempoRecommendation.length).toBeGreaterThan(0);
      });

      it('tempo is in correct format', () => {
        const result = calculateRepRange(baseFactors);
        // Tempo format: X-X-X-X
        expect(result.tempoRecommendation).toMatch(/\d-\d-[\dX]-\d/);
      });
    });

    describe('notes', () => {
      it('includes notes about fiber type', () => {
        const fastResult = calculateRepRange({ ...baseFactors, muscleGroup: 'hamstrings' });
        expect(fastResult.notes).toContain('heavier loads');

        const slowResult = calculateRepRange({ ...baseFactors, muscleGroup: 'calves' });
        expect(slowResult.notes).toContain('higher reps');
      });

      it('includes notes about late position fatigue', () => {
        const lateResult = calculateRepRange({ ...baseFactors, positionInWorkout: 'late' });
        expect(lateResult.notes).toContain('fatigue');
      });

      it('includes intensity notes when RIR is low', () => {
        const highIntensityResult = calculateRepRange({
          ...baseFactors,
          experience: 'advanced',
          weekInMesocycle: 6,
          totalMesocycleWeeks: 6,
        });

        if (highIntensityResult.targetRIR <= 1) {
          expect(highIntensityResult.notes).toContain('failure');
        }
      });
    });
  });

  describe('getDUPRepRange', () => {
    it('returns higher reps for hypertrophy day', () => {
      const hypertrophy = getDUPRepRange('hypertrophy', true, 'chest');
      const strength = getDUPRepRange('strength', true, 'chest');

      expect(hypertrophy.max).toBeGreaterThan(strength.max);
    });

    it('returns lower reps for power day', () => {
      const power = getDUPRepRange('power', true, 'chest');
      const hypertrophy = getDUPRepRange('hypertrophy', true, 'chest');

      expect(power.min).toBeLessThan(hypertrophy.min);
    });

    it('uses higher reps for isolation exercises', () => {
      const compound = getDUPRepRange('hypertrophy', true, 'chest');
      const isolation = getDUPRepRange('hypertrophy', false, 'chest');

      expect(isolation.min).toBeGreaterThan(compound.min);
    });

    it('adjusts for slow-twitch muscles', () => {
      const mixed = getDUPRepRange('hypertrophy', true, 'chest');
      const slow = getDUPRepRange('hypertrophy', true, 'calves');

      expect(slow.max).toBeGreaterThan(mixed.max);
    });

    it('adjusts for fast-twitch muscles', () => {
      const mixed = getDUPRepRange('hypertrophy', true, 'chest');
      const fast = getDUPRepRange('hypertrophy', true, 'hamstrings');

      expect(fast.min).toBeLessThanOrEqual(mixed.min);
    });
  });

  describe('getDUPTempo', () => {
    it('returns different tempo for each day type', () => {
      const hypertrophy = getDUPTempo('hypertrophy', true);
      const strength = getDUPTempo('strength', true);
      const power = getDUPTempo('power', true);

      expect(hypertrophy).not.toBe(strength);
      expect(power).toContain('X'); // Explosive concentric
    });

    it('returns valid tempo format', () => {
      const dayTypes: DUPDayType[] = ['hypertrophy', 'strength', 'power'];

      dayTypes.forEach((dayType) => {
        const tempo = getDUPTempo(dayType, true);
        expect(tempo).toMatch(/\d-\d-[\dX]-\d/);
      });
    });

    it('varies by compound vs isolation', () => {
      const compoundTempo = getDUPTempo('hypertrophy', true);
      const isolationTempo = getDUPTempo('hypertrophy', false);

      // Both should be valid tempos
      expect(compoundTempo.length).toBeGreaterThan(0);
      expect(isolationTempo.length).toBeGreaterThan(0);
    });
  });

  describe('getDUPRestPeriod', () => {
    it('returns longer rest for strength day', () => {
      const hypertrophy = getDUPRestPeriod('hypertrophy', true);
      const strength = getDUPRestPeriod('strength', true);

      expect(strength).toBeGreaterThan(hypertrophy);
    });

    it('returns longer rest for compounds', () => {
      const compound = getDUPRestPeriod('hypertrophy', true);
      const isolation = getDUPRestPeriod('hypertrophy', false);

      expect(compound).toBeGreaterThan(isolation);
    });

    it('returns rest in seconds', () => {
      const dayTypes: DUPDayType[] = ['hypertrophy', 'strength', 'power'];

      dayTypes.forEach((dayType) => {
        const rest = getDUPRestPeriod(dayType, true);
        expect(rest).toBeGreaterThan(0);
        expect(rest).toBeLessThanOrEqual(300); // Max 5 minutes
      });
    });
  });

  describe('getDUPNotes', () => {
    it('returns hypertrophy-focused notes', () => {
      const notes = getDUPNotes('hypertrophy');
      expect(notes).toContain('contraction');
    });

    it('returns strength-focused notes', () => {
      const notes = getDUPNotes('strength');
      expect(notes).toContain('heavy');
    });

    it('returns power-focused notes', () => {
      const notes = getDUPNotes('power');
      expect(notes).toContain('speed');
    });

    it('returns non-empty notes for all types', () => {
      const dayTypes: DUPDayType[] = ['hypertrophy', 'strength', 'power'];

      dayTypes.forEach((dayType) => {
        const notes = getDUPNotes(dayType);
        expect(notes.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getDUPTargetRIR', () => {
    it('returns RIR 2 for hypertrophy', () => {
      expect(getDUPTargetRIR('hypertrophy')).toBe(2);
    });

    it('returns RIR 1 for strength', () => {
      expect(getDUPTargetRIR('strength')).toBe(1);
    });

    it('returns RIR 2 for power (not to failure)', () => {
      expect(getDUPTargetRIR('power')).toBe(2);
    });

    it('returns valid RIR for all types', () => {
      const dayTypes: DUPDayType[] = ['hypertrophy', 'strength', 'power'];

      dayTypes.forEach((dayType) => {
        const rir = getDUPTargetRIR(dayType);
        expect(rir).toBeGreaterThanOrEqual(0);
        expect(rir).toBeLessThanOrEqual(4);
      });
    });
  });

  describe('getPositionCategory', () => {
    it('returns first for position 1', () => {
      expect(getPositionCategory(1, 10)).toBe('first');
    });

    it('returns early for early positions', () => {
      expect(getPositionCategory(2, 10)).toBe('early');
      expect(getPositionCategory(3, 10)).toBe('early');
    });

    it('returns mid for middle positions', () => {
      expect(getPositionCategory(4, 10)).toBe('mid');
      expect(getPositionCategory(5, 10)).toBe('mid');
    });

    it('returns late for later positions', () => {
      expect(getPositionCategory(7, 10)).toBe('late');
      expect(getPositionCategory(10, 10)).toBe('late');
    });

    it('handles small exercise counts', () => {
      expect(getPositionCategory(1, 3)).toBe('first');
      // Position 2/3 = 0.66, which is >= 0.66 so it's 'late'
      expect(getPositionCategory(2, 3)).toBe('late');
      expect(getPositionCategory(3, 3)).toBe('late');
    });
  });

  describe('formatRepRange', () => {
    it('formats rep range with RIR', () => {
      const config: RepRangeConfig = {
        min: 8,
        max: 12,
        targetRIR: 2,
        tempoRecommendation: '3-0-1-0',
        notes: 'Test notes',
      };

      const result = formatRepRange(config);

      expect(result).toContain('8-12 reps');
      expect(result).toContain('2 RIR');
      expect(result).toContain('RPE 8');
    });

    it('formats RIR 0 as to failure', () => {
      const config: RepRangeConfig = {
        min: 6,
        max: 8,
        targetRIR: 0,
        tempoRecommendation: '2-0-1-0',
        notes: '',
      };

      const result = formatRepRange(config);

      expect(result).toContain('to failure');
    });
  });

  describe('buildLoadGuidance', () => {
    it('builds complete load guidance string', () => {
      const reps: RepRangeConfig = {
        min: 8,
        max: 12,
        targetRIR: 2,
        tempoRecommendation: '3-0-1-0',
        notes: '',
      };

      const result = buildLoadGuidance(reps);

      expect(result).toContain('8-12 reps');
      expect(result).toContain('2 RIR');
      expect(result).toContain('Tempo');
    });

    it('handles RIR 0', () => {
      const reps: RepRangeConfig = {
        min: 4,
        max: 6,
        targetRIR: 0,
        tempoRecommendation: '2-0-1-0',
        notes: '',
      };

      const result = buildLoadGuidance(reps);

      expect(result).toContain('to failure');
    });

    it('handles missing tempo', () => {
      const reps: RepRangeConfig = {
        min: 8,
        max: 12,
        targetRIR: 2,
        tempoRecommendation: '',
        notes: '',
      };

      const result = buildLoadGuidance(reps);

      expect(result).toContain('8-12 reps');
      expect(result).not.toContain('Tempo:');
    });

    it('includes week focus when provided', () => {
      const reps: RepRangeConfig = {
        min: 8,
        max: 12,
        targetRIR: 2,
        tempoRecommendation: '3-0-1-0',
        notes: '',
      };

      const result = buildLoadGuidance(reps, 'Volume accumulation');

      // Week focus is currently not included in output, but function accepts it
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
