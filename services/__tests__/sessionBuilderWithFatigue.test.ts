/**
 * Tests for Session Builder with Fatigue Integration
 */
import {
  buildDetailedSessionWithFatigue,
  buildDUPSession,
  generateFullMesocycleWithFatigue,
  formatSessionForDisplay,
  formatMesocycleForDisplay,
} from '../sessionBuilderWithFatigue';
import { WeeklyFatigueTracker, createFatigueBudget } from '../fatigueBudgetEngine';
import type {
  ExtendedUserProfile,
  RecoveryFactors,
  Rating,
  Goal,
  Experience,
  MuscleGroup,
  Equipment,
  SessionTemplate,
  FatigueBudgetConfig,
  WeeklyProgression,
  PeriodizationModel,
  DUPDayType,
} from '@/types/schema';

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
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
    injuryHistory: [],
    ...overrides,
  };
}

// Default volume per muscle for testing
function createVolumePerMuscle(): Record<MuscleGroup, { sets: number; frequency: number }> {
  return {
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
}

// Default weekly progression for testing
function createWeeklyProgression(): WeeklyProgression {
  return {
    week: 1,
    intensityModifier: 0.9,
    volumeModifier: 1.0,
    rpeTarget: { min: 7, max: 8 },
    focus: 'Hypertrophy focus week',
  };
}

describe('sessionBuilderWithFatigue', () => {
  describe('buildDetailedSessionWithFatigue', () => {
    const profile = createProfile();
    const volumePerMuscle = createVolumePerMuscle();
    const fatigueBudgetConfig = createFatigueBudget(profile);
    const weeklyProgression = createWeeklyProgression();

    it('builds a session with exercises', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Upper A',
        focus: 'Horizontal emphasis',
        targetMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      expect(session.day).toBe('Upper A');
      expect(session.focus).toBe('Horizontal emphasis');
      expect(session.exercises.length).toBeGreaterThan(0);
      expect(session.totalSets).toBeGreaterThan(0);
    });

    it('includes warmup instructions', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Lower A',
        focus: 'Quad emphasis',
        targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      expect(session.warmup).toBeDefined();
      expect(session.warmup.length).toBeGreaterThan(0);
    });

    it('includes fatigue summary', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Push',
        focus: 'Chest, shoulders, triceps',
        targetMuscles: ['chest', 'shoulders', 'triceps'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      expect(session.fatigueSummary).toBeDefined();
      expect(session.fatigueSummary.systemicFatigueGenerated).toBeDefined();
      expect(session.fatigueSummary.systemicCapacityUsed).toBeDefined();
      expect(session.fatigueSummary.averageSFR).toBeDefined();
    });

    it('exercises have rep ranges and rest periods', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Pull',
        focus: 'Back, biceps',
        targetMuscles: ['back', 'biceps'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      session.exercises.forEach((ex) => {
        expect(ex.reps).toBeDefined();
        expect(ex.reps.min).toBeGreaterThan(0);
        expect(ex.reps.max).toBeGreaterThan(0);
        expect(ex.restSeconds).toBeGreaterThan(0);
        expect(ex.sets).toBeGreaterThan(0);
      });
    });

    it('exercises include fatigue profile', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Legs',
        focus: 'Quads and glutes',
        targetMuscles: ['quads', 'glutes', 'hamstrings'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      session.exercises.forEach((ex) => {
        expect(ex.fatigueProfile).toBeDefined();
        expect(ex.fatigueProfile.systemicCost).toBeDefined();
        expect(ex.fatigueProfile.sfr).toBeDefined();
        expect(ex.fatigueProfile.efficiency).toBeDefined();
      });
    });

    it('respects session time limit', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Full Body',
        focus: 'All muscles',
        targetMuscles: ['chest', 'back', 'shoulders', 'quads', 'hamstrings'],
      };

      const shortSession = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression,
        false,
        [],
        30 // 30 minute session
      );

      // Should have fewer exercises than a 60-minute session
      expect(shortSession.exercises.length).toBeLessThanOrEqual(6);
    });

    it('uses quick workout mode for short sessions', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Quick Push',
        focus: 'Chest and triceps',
        targetMuscles: ['chest', 'triceps'],
      };

      const quickSession = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression,
        true // quick workout mode
      );

      expect(quickSession.exercises.length).toBeGreaterThan(0);
    });

    it('handles different periodization models', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Upper',
        focus: 'Upper body',
        targetMuscles: ['chest', 'back', 'shoulders'],
      };

      const models: PeriodizationModel[] = ['linear', 'daily_undulating', 'weekly_undulating', 'block'];

      models.forEach((model) => {
        const session = buildDetailedSessionWithFatigue(
          template,
          volumePerMuscle,
          profile,
          fatigueBudgetConfig,
          new WeeklyFatigueTracker(profile),
          0,
          1,
          6,
          model,
          weeklyProgression
        );

        expect(session.exercises.length).toBeGreaterThan(0);
      });
    });
  });

  describe('buildDUPSession', () => {
    const profile = createProfile();
    const volumePerMuscle = createVolumePerMuscle();
    const fatigueBudgetConfig = createFatigueBudget(profile);

    it('builds a hypertrophy DUP session', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Upper A',
        focus: 'Upper body',
        targetMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
      };

      const session = buildDUPSession(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        'hypertrophy',
        1,
        6
      );

      expect(session.day).toBe('Upper A');
      expect(session.focus).toContain('HYPERTROPHY');
      expect(session.exercises.length).toBeGreaterThan(0);
    });

    it('builds a strength DUP session', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Lower A',
        focus: 'Lower body',
        targetMuscles: ['quads', 'hamstrings', 'glutes'],
      };

      const session = buildDUPSession(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        'strength',
        1,
        6
      );

      expect(session.focus).toContain('STRENGTH');
      expect(session.exercises.length).toBeGreaterThan(0);
    });

    it('builds a power DUP session', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Push',
        focus: 'Push movements',
        targetMuscles: ['chest', 'shoulders', 'triceps'],
      };

      const session = buildDUPSession(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        'power',
        1,
        6
      );

      expect(session.focus).toContain('POWER');
      expect(session.exercises.length).toBeGreaterThan(0);
    });

    it('includes fatigue summary', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Pull',
        focus: 'Pull movements',
        targetMuscles: ['back', 'biceps'],
      };

      const session = buildDUPSession(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        'hypertrophy',
        1,
        6
      );

      expect(session.fatigueSummary).toBeDefined();
      expect(session.fatigueSummary.averageSFR).toBeDefined();
    });

    it('has different volume for different DUP types', () => {
      const template: SessionTemplate = {
        day: 'Upper',
        focus: 'Upper body',
        targetMuscles: ['chest', 'back', 'shoulders'],
      };

      const hypertrophySession = buildDUPSession(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        new WeeklyFatigueTracker(profile),
        0,
        'hypertrophy',
        1,
        6
      );

      const powerSession = buildDUPSession(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        new WeeklyFatigueTracker(profile),
        0,
        'power',
        1,
        6
      );

      // Hypertrophy should have higher volume than power
      expect(hypertrophySession.totalSets).toBeGreaterThanOrEqual(powerSession.totalSets);
    });
  });

  describe('generateFullMesocycleWithFatigue', () => {
    const profile = createProfile();

    it('generates a complete mesocycle', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);

      expect(program.split).toBeDefined();
      expect(program.schedule).toBeDefined();
      expect(program.periodization).toBeDefined();
      expect(program.sessions.length).toBeGreaterThan(0);
    });

    it('includes mesocycle weeks with detailed sessions', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);

      expect(program.mesocycleWeeks).toBeDefined();
      expect(program.mesocycleWeeks.length).toBeGreaterThan(0);

      program.mesocycleWeeks.forEach((week) => {
        expect(week.weekNumber).toBeGreaterThan(0);
        expect(week.sessions.length).toBeGreaterThan(0);
      });
    });

    it('includes fatigue budget', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);

      expect(program.fatigueBudget).toBeDefined();
      expect(program.fatigueBudget?.systemicLimit).toBeGreaterThan(0);
    });

    it('includes recovery profile', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);

      expect(program.recoveryProfile).toBeDefined();
      expect(program.recoveryProfile.volumeMultiplier).toBeGreaterThan(0);
    });

    it('includes program notes', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);

      expect(program.programNotes).toBeDefined();
      expect(program.programNotes.length).toBeGreaterThan(0);
    });

    it('handles quick workout mode for short sessions', () => {
      const program = generateFullMesocycleWithFatigue(3, profile, 20);

      expect(program.programNotes.some((n) => n.includes('Quick Workout'))).toBe(true);
    });

    it('handles time-efficient mode for medium sessions', () => {
      const program = generateFullMesocycleWithFatigue(3, profile, 40);

      expect(program.programNotes.some((n) => n.includes('Time-Efficient') || n.includes('Volume reduced'))).toBe(true);
    });

    it('notes lagging areas when provided', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60, ['Arms']);

      expect(program.programNotes.some((n) => n.includes('Arms'))).toBe(true);
    });

    it('generates correct number of sessions per week', () => {
      const program4Days = generateFullMesocycleWithFatigue(4, profile, 60);
      expect(program4Days.schedule.length).toBe(4);

      const program3Days = generateFullMesocycleWithFatigue(3, profile, 60);
      expect(program3Days.schedule.length).toBe(3);
    });

    it('last week is a deload week', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);

      const lastWeek = program.mesocycleWeeks[program.mesocycleWeeks.length - 1];
      expect(lastWeek.isDeload).toBe(true);
    });

    it('handles different experience levels', () => {
      const noviceProfile = createProfile({ experience: 'novice' });
      const advancedProfile = createProfile({ experience: 'advanced' });

      const noviceProgram = generateFullMesocycleWithFatigue(3, noviceProfile, 60);
      const advancedProgram = generateFullMesocycleWithFatigue(3, advancedProfile, 60);

      // Both should generate valid programs
      expect(noviceProgram.sessions.length).toBeGreaterThan(0);
      expect(advancedProgram.sessions.length).toBeGreaterThan(0);
    });

    it('handles different goals', () => {
      const bulkProfile = createProfile({ goal: 'bulk' });
      const cutProfile = createProfile({ goal: 'cut' });

      const bulkProgram = generateFullMesocycleWithFatigue(4, bulkProfile, 60);
      const cutProgram = generateFullMesocycleWithFatigue(4, cutProfile, 60);

      // Both should generate valid programs
      expect(bulkProgram.sessions.length).toBeGreaterThan(0);
      expect(cutProgram.sessions.length).toBeGreaterThan(0);
    });

    it('filters unavailable equipment', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60, undefined, ['machine-123']);

      // Should still generate a valid program
      expect(program.sessions.length).toBeGreaterThan(0);
    });
  });

  describe('formatSessionForDisplay', () => {
    const profile = createProfile();
    const volumePerMuscle = createVolumePerMuscle();
    const fatigueBudgetConfig = createFatigueBudget(profile);
    const weeklyProgression = createWeeklyProgression();

    it('formats a session as a string', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Upper A',
        focus: 'Upper body',
        targetMuscles: ['chest', 'back', 'shoulders'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      const output = formatSessionForDisplay(session);

      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    });

    it('includes session day and focus', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Push Day',
        focus: 'Chest emphasis',
        targetMuscles: ['chest', 'shoulders', 'triceps'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      const output = formatSessionForDisplay(session);

      expect(output).toContain('Push Day');
      expect(output).toContain('Chest emphasis');
    });

    it('includes warmup section', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Lower',
        focus: 'Legs',
        targetMuscles: ['quads', 'hamstrings'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      const output = formatSessionForDisplay(session);

      expect(output).toContain('WARMUP');
    });

    it('includes exercises section', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Pull',
        focus: 'Back',
        targetMuscles: ['back', 'biceps'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      const output = formatSessionForDisplay(session);

      expect(output).toContain('EXERCISES');
      expect(output).toContain('sets');
      expect(output).toContain('reps');
    });

    it('includes fatigue information', () => {
      const weeklyTracker = new WeeklyFatigueTracker(profile);
      const template: SessionTemplate = {
        day: 'Full Body',
        focus: 'All muscles',
        targetMuscles: ['chest', 'back', 'quads'],
      };

      const session = buildDetailedSessionWithFatigue(
        template,
        volumePerMuscle,
        profile,
        fatigueBudgetConfig,
        weeklyTracker,
        0,
        1,
        6,
        'linear',
        weeklyProgression
      );

      const output = formatSessionForDisplay(session);

      expect(output).toContain('Fatigue');
      expect(output).toContain('SFR');
    });
  });

  describe('formatMesocycleForDisplay', () => {
    const profile = createProfile();

    it('formats a mesocycle as a string', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    });

    it('includes mesocycle overview', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('MESOCYCLE OVERVIEW');
      expect(output).toContain('Split');
      expect(output).toContain('Schedule');
    });

    it('includes recovery profile section', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('RECOVERY PROFILE');
      expect(output).toContain('Volume modifier');
    });

    it('includes fatigue budget section', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('FATIGUE BUDGET');
      expect(output).toContain('Systemic limit');
    });

    it('includes weekly volume targets', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('WEEKLY VOLUME TARGETS');
      expect(output).toContain('sets/week');
    });

    it('includes week-by-week breakdown', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('WEEK-BY-WEEK BREAKDOWN');
      expect(output).toContain('WEEK 1');
    });

    it('includes deload week marker', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('DELOAD');
    });

    it('includes warnings section when present', () => {
      // Create conditions that might generate warnings
      const stressedProfile = createProfile({
        stressLevel: 5 as Rating,
        sleepQuality: 1 as Rating,
      });
      const program = generateFullMesocycleWithFatigue(4, stressedProfile, 60);

      if (program.warnings.length > 0) {
        const output = formatMesocycleForDisplay(program);
        expect(output).toContain('WARNINGS');
      }
    });

    it('includes notes section', () => {
      const program = generateFullMesocycleWithFatigue(4, profile, 60);
      const output = formatMesocycleForDisplay(program);

      expect(output).toContain('NOTES');
    });
  });
});
