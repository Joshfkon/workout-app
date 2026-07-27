/**
 * Regression: editing secondary_muscles on an exercise must actually persist,
 * and the persisted value must be what the volume tracker and muscle-recovery
 * read paths consume — not just what the edit form displays.
 *
 * Bug being locked out: both edit surfaces wrote
 * `.from('exercises').update(...).eq('id', ...)` and checked only `error`.
 * Under RLS (20241212000001: UPDATE only where is_custom AND created_by =
 * auth.uid()) a stock catalog row is filtered OUT of the update set and the
 * request "succeeds" with zero rows — so the form showed
 * "Exercise updated successfully!" while writing nothing (the Glute Drive
 * Machine report). The verified write path (lib/exercises/updateExerciseRow)
 * turns zero written rows into a visible failure.
 */

import {
  updateExerciseRow,
  type UpdateExerciseSupabase,
} from '@/lib/exercises/updateExerciseRow';
import { computeWeeklyMuscleVolume } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { computeMuscleRecovery, RECOVERY_CONFIG } from '@/services/muscleRecovery';
import { SECONDARY_MUSCLE_CREDIT } from '@/services/volumeTracker';
import { SEED_EXERCISE_TAGS } from '@/services/generated/seedExerciseTags';

const CURRENT_USER = 'user-1';

interface FakeExerciseRow {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  is_custom: boolean;
  created_by: string | null;
}

/**
 * In-memory `exercises` table with the production RLS UPDATE semantics:
 * only `is_custom = TRUE AND created_by = auth.uid()` rows are in the update
 * set; everything else matches ZERO rows with NO error (exactly what
 * PostgREST returns), which is the failure mode under test.
 */
function makeFakeDb(rows: FakeExerciseRow[]) {
  const table = rows.map((r) => ({ ...r }));
  const client: UpdateExerciseSupabase = {
    from(tableName: string) {
      if (tableName !== 'exercises') throw new Error(`unexpected table ${tableName}`);
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              return {
                select(_columns: string) {
                  const matched = table.filter(
                    (r) =>
                      (r as unknown as Record<string, unknown>)[column] === value &&
                      r.is_custom === true &&
                      r.created_by === CURRENT_USER
                  );
                  for (const row of matched) Object.assign(row, values);
                  return Promise.resolve({
                    data: matched.map((r) => ({ id: r.id })),
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  // "Reload": what any read-path join on exercises returns afterwards.
  const reload = (id: string) => table.find((r) => r.id === id)!;
  return { client, reload };
}

const customGluteDrive: FakeExerciseRow = {
  id: 'ex-custom',
  name: 'Glute Drive Machine (custom)',
  primary_muscle: 'glutes',
  secondary_muscles: ['hamstrings'],
  is_custom: true,
  created_by: CURRENT_USER,
};

const stockGluteDrive: FakeExerciseRow = {
  id: 'ex-stock',
  name: 'Glute Drive Machine',
  primary_muscle: 'glutes',
  secondary_muscles: ['hamstrings'],
  is_custom: false,
  created_by: null,
};

describe('secondary-muscle edit persistence (user-library exercise)', () => {
  it('persists the edit and the reloaded row carries the new secondary', async () => {
    const { client, reload } = makeFakeDb([customGluteDrive, stockGluteDrive]);

    const result = await updateExerciseRow(client, 'ex-custom', {
      secondary_muscles: ['hamstrings', 'quads'],
    });
    expect(result).toEqual({ ok: true, outcome: 'updated' });

    expect(reload('ex-custom').secondary_muscles).toEqual(['hamstrings', 'quads']);
  });

  it('the volume-tracker read path credits the newly added secondary after reload', async () => {
    const { client, reload } = makeFakeDb([customGluteDrive]);
    await updateExerciseRow(client, 'ex-custom', {
      secondary_muscles: ['hamstrings', 'quads'],
    });
    const row = reload('ex-custom');

    // Same shape the weekly-volume queries join out of the DB.
    const workingSets = [
      { id: 's1', is_warmup: false },
      { id: 's2', is_warmup: false },
      { id: 's3', is_warmup: false },
    ];
    const stats = computeWeeklyMuscleVolume([
      { exercises: row, set_logs: workingSets },
    ]);

    const quads = stats.find((s) => s.muscle === 'quads');
    expect(quads).toBeDefined();
    expect(quads!.sets).toBeCloseTo(workingSets.length * SECONDARY_MUSCLE_CREDIT);
    // And it is secondary (indirect) credit, not a mis-attributed primary.
    expect(quads!.indirectSets).toBeCloseTo(workingSets.length * SECONDARY_MUSCLE_CREDIT);

    // Pre-edit tags gave quads nothing — the edit is what feeds the tracker.
    const before = computeWeeklyMuscleVolume([
      { exercises: { ...row, secondary_muscles: ['hamstrings'] }, set_logs: workingSets },
    ]);
    expect(before.find((s) => s.muscle === 'quads')).toBeUndefined();
  });

  it('the muscle-recovery read path doses the newly added secondary after reload', async () => {
    const { client, reload } = makeFakeDb([customGluteDrive]);
    await updateExerciseRow(client, 'ex-custom', {
      secondary_muscles: ['hamstrings', 'quads'],
    });
    const row = reload('ex-custom');

    const now = new Date('2026-07-27T12:00:00Z');
    const sessionFor = (secondaries: string[]) => [
      {
        performedAt: new Date('2026-07-27T10:00:00Z'),
        exercises: [
          {
            primaryMuscle: row.primary_muscle,
            secondaryMuscles: secondaries,
            sets: Array.from({ length: 5 }, () => ({ repsInTank: 1 })),
          },
        ],
      },
    ];

    const after = computeMuscleRecovery(sessionFor(row.secondary_muscles), 'quads', now);
    expect(after.dose).toBeCloseTo(5 * RECOVERY_CONFIG.secondaryDoseFactor);
    expect(after.lastTrainedAt).not.toBeNull();
    expect(after.status).not.toBe('fresh');

    // Pre-edit tags left quads invisible to recovery — the readiness blindness
    // in the report.
    const before = computeMuscleRecovery(sessionFor(['hamstrings']), 'quads', now);
    expect(before.dose).toBe(0);
    expect(before.status).toBe('fresh');
  });

  it('a stock catalog row is reported as blocked, never as a silent success', async () => {
    const { client, reload } = makeFakeDb([customGluteDrive, stockGluteDrive]);

    const result = await updateExerciseRow(client, 'ex-stock', {
      secondary_muscles: ['hamstrings', 'quads'],
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toMatch(/catalog/i);

    // And nothing was written.
    expect(reload('ex-stock').secondary_muscles).toEqual(['hamstrings']);
  });

  it('the stock Glute Drive Machine catalog row itself now carries quads (20260727000003)', () => {
    // The user-reported row is stock, so the correction ships as an audited
    // catalog migration; the generated snapshot locks migration ↔ fallback.
    expect(SEED_EXERCISE_TAGS['Glute Drive Machine']).toEqual({
      primary: 'glutes',
      secondaries: ['hamstrings', 'quads'],
    });
  });
});
