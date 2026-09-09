import {
  detectBigDrop,
  detectRpeCeiling,
  detectCrushingIt,
  detectPainSignal,
  detectFormBreakdown,
  detectFatigueWarning,
  shouldShowWhisper,
  calculateExerciseProgress,
  type ExerciseContext,
} from '../inWorkoutSignals';
import type { SetLog } from '@/types/schema';

describe('inWorkoutSignals', () => {
  const mockSet = (overrides: Partial<SetLog> = {}): SetLog => {
    // Handle snake_case to camelCase sync for test convenience
    const weightKg = (overrides as any).weight_kg ?? overrides.weightKg ?? 100;
    const reps = (overrides as any).reps_completed ?? overrides.reps ?? 10;
    const isWarmup = (overrides as any).is_warmup ?? overrides.isWarmup ?? false;
    
    return {
      id: 'set-1',
      exerciseBlockId: 'block-1',
      workoutSessionId: 'session-1',
      setNumber: 1,
      weightKg,
      weight_kg: weightKg,
      reps,
      reps_completed: reps,
      rpe: 7,
      isWarmup,
      is_warmup: isWarmup,
      restSeconds: null,
      logged_at: new Date().toISOString(),
      loggedAt: new Date().toISOString(),
      setType: isWarmup ? 'warmup' : 'normal',
      parentSetId: null,
      feedback: overrides.feedback ?? { repsInTank: 3, formRating: 'clean' },
      amrapTarget: null,
      amrapRepsCompleted: null,
      quality: 'effective',
      qualityReason: null,
      note: '',
      ...overrides,
    };
  };

  describe('detectBigDrop', () => {
    it('detects significant weight drop (>10% and >5kg)', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [
          mockSet({ weight_kg: 90 }),
          mockSet({ weight_kg: 90 }),
        ],
        lastSessionSets: [
          mockSet({ weight_kg: 110 }),
          mockSet({ weight_kg: 110 }),
        ],
      };

      const signal = detectBigDrop(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('big_drop');
      expect(signal?.severity).toBe('warning');
      expect(signal?.message).toContain('20kg');
    });

    it('detects significant rep drop with similar weight', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [
          mockSet({ weight_kg: 100, reps_completed: 7 }),
          mockSet({ weight_kg: 100, reps_completed: 7 }),
        ],
        lastSessionSets: [
          mockSet({ weight_kg: 100, reps_completed: 10 }),
          mockSet({ weight_kg: 100, reps_completed: 10 }),
        ],
      };

      const signal = detectBigDrop(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('big_drop');
      expect(signal?.message).toContain('3 fewer reps');
    });

    it('returns null when no significant drop', () => {
      const context: ExerciseContext = {
        exerciseName: 'Deadlift',
        setsToday: [mockSet({ weight_kg: 100 })],
        lastSessionSets: [mockSet({ weight_kg: 102 })],
      };

      expect(detectBigDrop(context)).toBeNull();
    });

    it('returns null when no history available', () => {
      const context: ExerciseContext = {
        exerciseName: 'Row',
        setsToday: [mockSet()],
      };

      expect(detectBigDrop(context)).toBeNull();
    });
  });

  describe('detectRpeCeiling', () => {
    it('detects multiple consecutive sets at RPE 10', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [
          mockSet({ feedback: { repsInTank: 0, formRating: 'clean' } }), // RPE 10
          mockSet({ feedback: { repsInTank: 0, formRating: 'clean' } }), // RPE 10
          mockSet({ feedback: { repsInTank: 0, formRating: 'clean' } }), // RPE 10
        ],
      };

      const signal = detectRpeCeiling(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('rpe_ceiling');
      expect(signal?.severity).toBe('alert');
    });

    it('returns null when RPE varies', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [
          mockSet({ rir: 2 }), // RPE 8
          mockSet({ rir: 1 }), // RPE 9
          mockSet({ rir: 0 }), // RPE 10
        ],
      };

      expect(detectRpeCeiling(context)).toBeNull();
    });
  });

  describe('detectCrushingIt', () => {
    it('detects weight increase progression', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [
          mockSet({ weight_kg: 105, reps_completed: 10 }),
          mockSet({ weight_kg: 105, reps_completed: 10 }),
        ],
        lastSessionSets: [
          mockSet({ weight_kg: 100, reps_completed: 10 }),
          mockSet({ weight_kg: 100, reps_completed: 10 }),
        ],
      };

      const signal = detectCrushingIt(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('crushing_it');
      expect(signal?.severity).toBe('info');
      expect(signal?.message).toContain('5kg');
    });

    it('detects rep increase progression', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [
          mockSet({ weight_kg: 100, reps_completed: 13 }),
          mockSet({ weight_kg: 100, reps_completed: 13 }),
        ],
        lastSessionSets: [
          mockSet({ weight_kg: 100, reps_completed: 10 }),
          mockSet({ weight_kg: 100, reps_completed: 10 }),
        ],
      };

      const signal = detectCrushingIt(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('crushing_it');
      expect(signal?.message).toContain('3 more reps');
    });
  });

  describe('detectPainSignal', () => {
    it('detects significant joint pain', () => {
      const signal = detectPainSignal('Bench Press', {
        joint: 'shoulder',
        severity: 3,
      });

      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('pain_logged');
      expect(signal?.severity).toBe('alert');
      expect(signal?.message).toContain('significant');
      expect(signal?.message).toContain('shoulder');
    });

    it('detects mild joint pain', () => {
      const signal = detectPainSignal('Squat', {
        joint: 'knee',
        severity: 1,
      });

      expect(signal).not.toBeNull();
      expect(signal?.severity).toBe('warning');
    });

    it('returns null when no discomfort', () => {
      expect(detectPainSignal('Deadlift', null)).toBeNull();
    });
  });

  describe('detectFormBreakdown', () => {
    it('detects multiple sets with ugly form', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [
          mockSet({ form_rating: 'ugly' }),
          mockSet({ form_rating: 'ugly' }),
          mockSet({ form_rating: 'clean' }),
        ],
      };

      const signal = detectFormBreakdown(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('form_breakdown');
      expect(signal?.severity).toBe('warning');
    });

    it('returns null when form is good', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [
          mockSet({ form_rating: 'clean' }),
          mockSet({ form_rating: 'clean' }),
        ],
      };

      expect(detectFormBreakdown(context)).toBeNull();
    });
  });

  describe('detectFatigueWarning', () => {
    it('detects RPE climbing despite weight drop', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [
          mockSet({ weight_kg: 100, feedback: { repsInTank: 3, formRating: 'clean' } }), // RPE 7
          mockSet({ weight_kg: 95, feedback: { repsInTank: 1, formRating: 'clean' } }), // RPE 9
          mockSet({ weight_kg: 90, feedback: { repsInTank: 0, formRating: 'clean' } }), // RPE 10
        ],
      };

      const signal = detectFatigueWarning(context);
      expect(signal).not.toBeNull();
      expect(signal?.type).toBe('fatigue_warning');
      expect(signal?.severity).toBe('warning');
    });

    it('returns null when RPE is stable', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [
          mockSet({ feedback: { repsInTank: 2, formRating: 'clean' } }),
          mockSet({ feedback: { repsInTank: 2, formRating: 'clean' } }),
          mockSet({ feedback: { repsInTank: 2, formRating: 'clean' } }),
        ],
      };

      expect(detectFatigueWarning(context)).toBeNull();
    });
  });

  describe('shouldShowWhisper', () => {
    it('returns true when 2+ working sets completed', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [
          mockSet({ is_warmup: false }),
          mockSet({ is_warmup: false }),
        ],
      };

      expect(shouldShowWhisper(context)).toBe(true);
    });

    it('returns false when only warmup sets completed', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [
          mockSet({ isWarmup: true, setType: 'warmup' }),
          mockSet({ isWarmup: true, setType: 'warmup' }),
        ],
      };

      expect(shouldShowWhisper(context)).toBe(false);
    });

    it('returns false when < 2 working sets', () => {
      const context: ExerciseContext = {
        exerciseName: 'Deadlift',
        setsToday: [mockSet({ is_warmup: false })],
      };

      expect(shouldShowWhisper(context)).toBe(false);
    });
  });

  describe('calculateExerciseProgress', () => {
    it('detects weight progression trend', () => {
      const context: ExerciseContext = {
        exerciseName: 'Bench Press',
        setsToday: [mockSet({ weight_kg: 105 })],
        lastSessionSets: [mockSet({ weight_kg: 100 })],
      };

      const progress = calculateExerciseProgress(context);
      expect(progress).not.toBeNull();
      expect(progress?.trend).toBe('up');
      expect(progress?.delta).toBe('5.0kg');
    });

    it('detects rep progression trend', () => {
      const context: ExerciseContext = {
        exerciseName: 'Squat',
        setsToday: [mockSet({ weight_kg: 100, reps_completed: 12 })],
        lastSessionSets: [mockSet({ weight_kg: 100, reps_completed: 10 })],
      };

      const progress = calculateExerciseProgress(context);
      expect(progress).not.toBeNull();
      expect(progress?.trend).toBe('up');
      expect(progress?.delta).toBe('2 reps');
    });

    it('returns flat when minimal change', () => {
      const context: ExerciseContext = {
        exerciseName: 'Deadlift',
        setsToday: [mockSet({ weight_kg: 100, reps_completed: 10 })],
        lastSessionSets: [mockSet({ weight_kg: 100, reps_completed: 10 })],
      };

      const progress = calculateExerciseProgress(context);
      expect(progress).not.toBeNull();
      expect(progress?.trend).toBe('flat');
    });

    it('returns null when no history', () => {
      const context: ExerciseContext = {
        exerciseName: 'Row',
        setsToday: [mockSet()],
      };

      expect(calculateExerciseProgress(context)).toBeNull();
    });
  });
});
