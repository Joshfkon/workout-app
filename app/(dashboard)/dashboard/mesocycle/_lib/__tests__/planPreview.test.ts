import {
  buildPlanPreview,
  currentPlanWeek,
  nextPlanSession,
  sessionSetCount,
  trainingDayLabels,
} from '../planPreview';
import type { FullProgramRecommendation } from '@/types/schema';

/** Minimal exercise entry in the fatigue (mesocycleWeeks) program format. */
function exercise(name: string, primaryMuscle: string, sets: number) {
  return {
    exercise: {
      id: `${name}-id`,
      name,
      primaryMuscle,
      secondaryMuscles: [],
    },
    sets,
    reps: { min: 8, max: 12, targetRIR: 2, tempoRecommendation: '2-0-1-0', notes: '' },
    restSeconds: 120,
    loadGuidance: 'Moderate',
    notes: '',
    fatigueProfile: {
      systemicCost: 1,
      localCost: {},
      sfr: 1,
      efficiency: 'high',
    },
  };
}

function session(day: string, focus: string, exercises: ReturnType<typeof exercise>[]) {
  return {
    day,
    focus,
    exercises,
    totalSets: exercises.reduce((n, e) => n + e.sets, 0),
    estimatedMinutes: 55,
    warmup: ['5 min bike'],
    fatigueSummary: {
      systemicFatigueGenerated: 0,
      systemicCapacityUsed: 0,
      averageSFR: 0,
      localFatigueByMuscle: {},
    },
  };
}

/** 3 weeks × 2 sessions, last week flagged as the deload. */
function makeProgram(): FullProgramRecommendation {
  const upper = () =>
    session('Upper', 'Accumulation', [
      exercise('Bench Press', 'chest', 4),
      exercise('Barbell Row', 'back', 3),
    ]);
  const lower = () =>
    session('Lower', 'Accumulation', [exercise('Squat', 'quads', 5)]);

  return {
    mesocycleWeeks: [
      {
        weekNumber: 1,
        focus: 'Accumulation',
        intensityModifier: 1.0,
        volumeModifier: 1.0,
        rpeTarget: { min: 7, max: 8 },
        sessions: [upper(), lower()],
        isDeload: false,
      },
      {
        weekNumber: 2,
        focus: 'Accumulation',
        intensityModifier: 1.05,
        volumeModifier: 1.1,
        rpeTarget: { min: 7, max: 9 },
        sessions: [upper(), lower()],
        isDeload: false,
      },
      {
        weekNumber: 3,
        focus: 'Deload',
        intensityModifier: 0.9,
        volumeModifier: 0.5,
        rpeTarget: { min: 5, max: 6 },
        sessions: [upper(), lower()],
        isDeload: true,
      },
    ],
  } as unknown as FullProgramRecommendation;
}

const baseInput = {
  programData: makeProgram(),
  totalWeeks: 3,
  daysPerWeek: 2,
  deloadWeek: 3,
  preferredWorkoutDays: null,
  completedSessions: 0,
};

describe('buildPlanPreview', () => {
  it('returns one entry per programmed week with its sessions', () => {
    const weeks = buildPlanPreview(baseInput);

    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3]);
    expect(weeks[0].sessions.map((s) => s.session.dayName)).toEqual(['Upper', 'Lower']);
    expect(weeks[0].totalSets).toBe(12); // (4 + 3) + 5
  });

  it('rolls weekly sets up per primary muscle, most-trained first', () => {
    const [week1] = buildPlanPreview(baseInput);

    expect(week1.setsByMuscle).toEqual([
      { muscle: 'quads', sets: 5 },
      { muscle: 'chest', sets: 4 },
      { muscle: 'back', sets: 3 },
    ]);
  });

  it('marks done / next / upcoming from the total completed-session count', () => {
    // 3 sessions done: week 1 complete, week 2 session 1 done, session 2 next.
    const weeks = buildPlanPreview({ ...baseInput, completedSessions: 3 });

    expect(weeks[0].status).toBe('done');
    expect(weeks[0].sessions.map((s) => s.status)).toEqual(['done', 'done']);
    expect(weeks[1].status).toBe('current');
    expect(weeks[1].sessions.map((s) => s.status)).toEqual(['done', 'next']);
    expect(weeks[2].status).toBe('upcoming');
    expect(weeks[2].sessions.every((s) => s.status === 'upcoming')).toBe(true);

    expect(nextPlanSession(weeks)?.key).toBe('w2-s1');
    expect(currentPlanWeek(weeks)?.weekNumber).toBe(2);
  });

  it('carries the deload flag and weekly modifiers', () => {
    const weeks = buildPlanPreview(baseInput);

    expect(weeks.map((w) => w.isDeload)).toEqual([false, false, true]);
    expect(weeks[1].volumeModifier).toBeCloseTo(1.1);
    expect(weeks[2].intensityModifier).toBeCloseTo(0.9);
  });

  it('labels sessions with the mesocycle training weekdays', () => {
    const weeks = buildPlanPreview({
      ...baseInput,
      daysPerWeek: 2,
      preferredWorkoutDays: ['Tuesday', 'Saturday'],
    });

    expect(weeks[0].sessions.map((s) => s.weekdayLabel)).toEqual(['Tue', 'Sat']);
  });

  it('applies the user exercise overrides so the preview matches what Start builds', () => {
    const weeks = buildPlanPreview({
      ...baseInput,
      exerciseOverrides: [
        {
          originalExerciseId: 'Bench Press-id',
          originalExerciseName: 'Bench Press',
          replacementExerciseId: 'db-press-id',
          replacementExerciseName: 'Dumbbell Press',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(weeks[0].sessions[0].session.exercises[0].exerciseName).toBe('Dumbbell Press');
  });

  it('repeats the last stored week when the block runs past program_data', () => {
    // Same behaviour as getSessionFromProgramData's capped week lookup, so the
    // preview cannot advertise weeks the start path would not serve.
    const weeks = buildPlanPreview({ ...baseInput, totalWeeks: 5 });

    expect(weeks).toHaveLength(5);
    expect(weeks[4].sessions.map((s) => s.session.dayName)).toEqual(['Upper', 'Lower']);
    expect(weeks[4].isDeload).toBe(true); // week 3's deload sessions repeat
  });

  it('handles the legacy sessions-only program format', () => {
    const legacy = {
      sessions: [
        {
          day: 'Full Body A',
          focus: 'Hypertrophy',
          exercises: [
            {
              exercise: { id: 'sq', name: 'Squat', primaryMuscle: 'quads', secondaryMuscles: [] },
              sets: 3,
              repRange: '8-12',
              restSeconds: 120,
              notes: '',
            },
          ],
          totalSets: 3,
          estimatedMinutes: 40,
          warmup: [],
        },
      ],
    } as unknown as FullProgramRecommendation;

    const weeks = buildPlanPreview({ ...baseInput, programData: legacy, totalWeeks: 2, daysPerWeek: 1 });

    expect(weeks).toHaveLength(2);
    expect(weeks[0].sessions[0].session.exercises[0].repRange).toEqual({ min: 8, max: 12 });
    expect(weeks[0].focus).toBe('Hypertrophy');
  });

  it('returns no weeks when the mesocycle has no program data', () => {
    expect(buildPlanPreview({ ...baseInput, programData: null })).toEqual([]);
    expect(nextPlanSession([])).toBeNull();
    expect(currentPlanWeek([])).toBeNull();
  });
});

describe('trainingDayLabels', () => {
  it('uses the preferred days in schedule order', () => {
    expect(trainingDayLabels(3, ['Monday', 'Thursday', 'Saturday'])).toEqual(['Mon', 'Thu', 'Sat']);
  });

  it('falls back to the default spread for the day count', () => {
    expect(trainingDayLabels(3, null)).toEqual(['Mon', 'Wed', 'Fri']);
  });
});

describe('sessionSetCount', () => {
  it('falls back to the stored total when exercises carry no set counts', () => {
    expect(
      sessionSetCount({
        dayName: 'Push',
        focus: '',
        muscles: [],
        exercises: [],
        estimatedMinutes: 30,
        totalSets: 9,
        warmup: [],
      })
    ).toBe(9);
  });
});
