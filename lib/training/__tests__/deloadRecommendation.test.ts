import {
  buildExerciseDeloadMetadata,
  deriveDeloadType,
  parseDeloadReasons,
  pickDeloadTargetWeek,
} from '../deloadRecommendation';
import type {
  DetailedExerciseWithFatigue,
  DetailedSessionWithFatigue,
  MesocycleWeek,
} from '@/types/schema';

// ============================================================
// Fixtures
// ============================================================

function makeExercise(
  overrides: Partial<DetailedExerciseWithFatigue['exercise']> & { id?: string }
): DetailedExerciseWithFatigue {
  return {
    exercise: {
      id: overrides.id,
      name: overrides.name ?? 'Barbell Squat',
      primaryMuscle: overrides.primaryMuscle ?? 'quads',
      secondaryMuscles: overrides.secondaryMuscles ?? [],
      pattern: overrides.pattern ?? 'squat',
      equipment: overrides.equipment ?? 'barbell',
      difficulty: overrides.difficulty ?? 'intermediate',
      fatigueRating: overrides.fatigueRating ?? 3,
    },
    sets: 3,
    reps: {
      min: 6,
      max: 10,
      targetRIR: 2,
      tempoRecommendation: '3-1-1-0',
      notes: '',
    },
    restSeconds: 180,
    loadGuidance: 'RPE 8',
    notes: '',
    fatigueProfile: {
      systemicCost: 3,
      localCost: {},
      sfr: 1,
      efficiency: 'optimal',
    },
  };
}

function makeSession(exercises: DetailedExerciseWithFatigue[]): DetailedSessionWithFatigue {
  return {
    day: 'Monday',
    focus: 'Lower',
    exercises,
    totalSets: exercises.reduce((sum, ex) => sum + ex.sets, 0),
    estimatedMinutes: 60,
    warmup: [],
    fatigueSummary: {
      systemicFatigueGenerated: 0,
      systemicCapacityUsed: 0,
      averageSFR: 1,
      localFatigueByMuscle: {},
    },
  };
}

function makeWeek(sessions: DetailedSessionWithFatigue[]): MesocycleWeek {
  return {
    weekNumber: 2,
    focus: 'Accumulation',
    intensityModifier: 1.0,
    volumeModifier: 1.0,
    rpeTarget: { min: 7, max: 9 },
    sessions,
    isDeload: false,
  };
}

// ============================================================
// parseDeloadReasons
// ============================================================

describe('parseDeloadReasons', () => {
  it('passes through a string array (jsonb array)', () => {
    expect(parseDeloadReasons(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops non-string entries', () => {
    expect(parseDeloadReasons(['a', 1, null, 'b'])).toEqual(['a', 'b']);
  });

  it('parses a JSON-string payload', () => {
    expect(parseDeloadReasons('["x","y"]')).toEqual(['x', 'y']);
  });

  it('returns [] for null, objects, and malformed strings', () => {
    expect(parseDeloadReasons(null)).toEqual([]);
    expect(parseDeloadReasons(undefined)).toEqual([]);
    expect(parseDeloadReasons({ reasons: ['a'] })).toEqual([]);
    expect(parseDeloadReasons('not json')).toEqual([]);
    expect(parseDeloadReasons('"a plain string"')).toEqual([]);
  });
});

// ============================================================
// deriveDeloadType (mirrors checkDeloadTriggers assignment order)
// ============================================================

describe('deriveDeloadType', () => {
  it('defaults to volume (fatigue/motivation triggers)', () => {
    expect(deriveDeloadType([])).toBe('volume');
    expect(deriveDeloadType(['Perceived fatigue elevated for 2+ weeks'])).toBe('volume');
    expect(deriveDeloadType(['Declining motivation - possible overreaching'])).toBe('volume');
  });

  it('maps strength regression and joint pain to intensity', () => {
    expect(deriveDeloadType(['Strength regression or significant missed reps'])).toBe('intensity');
    expect(deriveDeloadType(['Joint pain reported'])).toBe('intensity');
  });

  it('maps poor sleep to full', () => {
    expect(deriveDeloadType(['Poor sleep for 2+ weeks'])).toBe('full');
  });

  it('later triggers overwrite earlier ones, matching engine order', () => {
    // Engine pushes in order: fatigue, strength, sleep, motivation, joint.
    // Joint pain comes after sleep, so intensity wins.
    expect(
      deriveDeloadType([
        'Perceived fatigue elevated for 2+ weeks',
        'Poor sleep for 2+ weeks',
        'Joint pain reported',
      ])
    ).toBe('intensity');
    // Sleep after strength: full wins.
    expect(
      deriveDeloadType([
        'Strength regression or significant missed reps',
        'Poor sleep for 2+ weeks',
      ])
    ).toBe('full');
  });
});

// ============================================================
// pickDeloadTargetWeek
// ============================================================

describe('pickDeloadTargetWeek', () => {
  it('targets the week after the current one', () => {
    expect(pickDeloadTargetWeek(2, 6)).toBe(3);
  });

  it('caps at total weeks (deload_week <= total_weeks constraint)', () => {
    expect(pickDeloadTargetWeek(6, 6)).toBe(6);
    expect(pickDeloadTargetWeek(9, 6)).toBe(6);
  });

  it('sanitizes degenerate inputs', () => {
    expect(pickDeloadTargetWeek(0, 0)).toBe(1);
    expect(pickDeloadTargetWeek(1, 4)).toBe(2);
  });
});

// ============================================================
// buildExerciseDeloadMetadata
// ============================================================

describe('buildExerciseDeloadMetadata', () => {
  it('maps pattern/equipment and derives mechanic from the pattern', () => {
    const week = makeWeek([
      makeSession([
        makeExercise({ id: 'sq', name: 'Barbell Squat', pattern: 'squat', equipment: 'barbell' }),
        makeExercise({ id: 'curl', name: 'DB Curl', pattern: 'elbow_flexion', equipment: 'dumbbell' }),
      ]),
    ]);

    const metadata = buildExerciseDeloadMetadata(week);
    expect(metadata.get('sq')).toEqual({
      movementPattern: 'squat',
      equipment: 'barbell',
      mechanic: 'compound',
    });
    expect(metadata.get('curl')).toEqual({
      movementPattern: 'elbow_flexion',
      equipment: 'dumbbell',
      mechanic: 'isolation',
    });
  });

  it('skips exercises without an id and dedupes repeats across sessions', () => {
    const week = makeWeek([
      makeSession([
        makeExercise({ name: 'Legacy No-Id Exercise' }), // id undefined
        makeExercise({ id: 'sq', pattern: 'squat' }),
      ]),
      makeSession([makeExercise({ id: 'sq', pattern: 'squat' })]),
    ]);

    const metadata = buildExerciseDeloadMetadata(week);
    expect(metadata.size).toBe(1);
    expect(metadata.has('sq')).toBe(true);
  });
});
