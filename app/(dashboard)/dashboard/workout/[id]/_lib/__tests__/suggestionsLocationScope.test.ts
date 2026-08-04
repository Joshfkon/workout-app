import {
  buildExerciseHistories,
  type HistoryBlockRow,
} from '../suggestions';
import { OTHER_LOCATION_SOFTEN_FACTOR } from '@/services/progressionScope';

/** Build a completed-session history block with one working set. */
function block(
  exerciseId: string,
  sessionId: string,
  weightKg: number,
  reps: number,
  locationId: string | null,
  completedAt: string
): HistoryBlockRow {
  return {
    id: `${sessionId}-${exerciseId}`,
    exercise_id: exerciseId,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
    },
    set_logs: [
      {
        weight_kg: weightKg,
        reps,
        rpe: 8,
        is_warmup: false,
        set_number: 1,
        set_type: 'normal',
        logged_at: completedAt,
        location_id: locationId,
      },
    ],
  };
}

const CALF = 'calf-machine'; // local scope
const SQUAT = 'squat'; // global scope

const scopeForExercise = (id: string) => (id === CALF ? ('local' as const) : ('global' as const));

describe('buildExerciseHistories — location-scoped calibration', () => {
  it('local exercise at location A ignores location B loads (two tracks)', () => {
    const blocks = [
      block(CALF, 's1', 100, 12, 'A', '2026-01-02'),
      block(CALF, 's2', 140, 12, 'B', '2026-01-03'),
    ];
    const atA = buildExerciseHistories(blocks, { currentLocationId: 'A', scopeForExercise });
    const atB = buildExerciseHistories(blocks, { currentLocationId: 'B', scopeForExercise });

    // A's track only sees the 100kg set; B's only the 140kg set.
    expect(atA[CALF].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 100, reps: 12, rpe: 8 }),
    ]);
    expect(atA[CALF].estimatedFromOtherLocation).toBe(false);
    expect(atB[CALF].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 140, reps: 12, rpe: 8 }),
    ]);
    // The two tracks produce different e1RMs.
    expect(atA[CALF].estimatedE1RM).toBeLessThan(atB[CALF].estimatedE1RM);
  });

  it('first session at a new location softens + flags the estimate', () => {
    const blocks = [block(CALF, 's1', 100, 10, 'B', '2026-01-02')];
    const unscoped = buildExerciseHistories(blocks); // full history e1RM
    const atNew = buildExerciseHistories(blocks, { currentLocationId: 'A', scopeForExercise });

    expect(atNew[CALF].estimatedFromOtherLocation).toBe(true);
    expect(atNew[CALF].calibrationNote).toMatch(/starting point/i);
    // Softened ~10% below the raw cross-location e1RM.
    expect(atNew[CALF].estimatedE1RM).toBeCloseTo(
      unscoped[CALF].estimatedE1RM * OTHER_LOCATION_SOFTEN_FACTOR
    );
  });

  it('global (barbell) exercise keeps a single cross-location track', () => {
    const blocks = [
      block(SQUAT, 's1', 100, 5, 'A', '2026-01-02'),
      block(SQUAT, 's2', 120, 5, 'B', '2026-01-03'),
    ];
    const atA = buildExerciseHistories(blocks, { currentLocationId: 'A', scopeForExercise });
    expect(atA[SQUAT].progressionScope).toBe('global');
    expect(atA[SQUAT].estimatedFromOtherLocation).toBe(false);
    // Best e1RM comes from the 120kg set logged at B — proving no scoping.
    const unscoped = buildExerciseHistories(blocks);
    expect(atA[SQUAT].estimatedE1RM).toBe(unscoped[SQUAT].estimatedE1RM);
  });

  it('legacy null-location sets count toward the most-used location', () => {
    const blocks = [
      // Blocks arrive most-recent-first (query order). Most sets logged at A →
      // legacy nulls attributed to A; the newest set is the null-location one.
      block(CALF, 's3', 110, 12, null, '2026-01-03'),
      block(CALF, 's2', 95, 12, 'A', '2026-01-02'),
      block(CALF, 's1', 90, 12, 'A', '2026-01-01'),
    ];
    const atA = buildExerciseHistories(blocks, { currentLocationId: 'A', scopeForExercise });
    // The null-location 110kg set is attributed to A and is the most recent.
    expect(atA[CALF].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 110, reps: 12, rpe: 8 }),
    ]);
    expect(atA[CALF].estimatedFromOtherLocation).toBe(false);
  });

  it('without scope options, behavior is the legacy full-history read', () => {
    const blocks = [
      block(CALF, 's1', 100, 12, 'A', '2026-01-02'),
      block(CALF, 's2', 140, 12, 'B', '2026-01-03'),
    ];
    const unscoped = buildExerciseHistories(blocks);
    expect(unscoped[CALF].progressionScope).toBeUndefined();
    // Sees the heaviest set regardless of location.
    expect(unscoped[CALF].personalRecord?.weightKg).toBe(140);
  });
});
