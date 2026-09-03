/**
 * Regression: editing secondary_muscles on an exercise must actually persist,
 * and the persisted value must be what the volume tracker and muscle-recovery
 * read paths consume — not just what the edit form displays.
 *
 * Bug being locked out: both edit surfaces wrote
 * `.from('exercises').update(...).eq('id', ...)` and checked only `error`.
 * Under RLS (20241212000001: direct UPDATE only where is_custom AND
 * created_by = auth.uid()) a stock catalog row is filtered OUT of the update
 * set and the request "succeeds" with zero rows — so the form showed
 * "Exercise updated successfully!" while writing nothing (the Glute Drive
 * Machine report). The verified write path (lib/exercises/updateExerciseRow)
 * now detects zero written rows and routes them through the audited
 * update_catalog_exercise RPC (20260727000004, widened by 20260903000001 to
 * cover custom rows created by OTHER users — the "Calf Press on Leg Press"
 * report, where a mis-tagged foreign custom row was editable by nobody but
 * its creator): whitelisted columns, old values recorded before the write,
 * applied to the shared row.
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

/** Column whitelist mirrored from 20260903000001_shared_exercise_editing.sql. */
const CATALOG_EDITABLE_COLUMNS = new Set([
  'name', 'is_bodyweight', 'bodyweight_type', 'assistance_type', 'equipment',
  'equipment_required', 'movement_pattern', 'primary_muscle',
  'secondary_muscles', 'hypertrophy_tier', 'default_rep_range', 'default_rir',
  'setup_note', 'youtube_video_id',
]);

interface FakeExerciseRow {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  is_custom: boolean;
  created_by: string | null;
}

interface AuditEntry {
  exercise_id: string;
  edited_by: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}

/**
 * In-memory `exercises` table with the production semantics under test:
 * - direct UPDATE hits only `is_custom = TRUE AND created_by = auth.uid()`
 *   rows; everything else matches ZERO rows with NO error (exactly what
 *   PostgREST returns) — the old silent-failure mode;
 * - the update_catalog_exercise RPC (when enabled) edits ANY live row for
 *   everyone (stock or custom, 20260903000001), enforcing the column
 *   whitelist and auditing old values first.
 */
function makeFakeDb(rows: FakeExerciseRow[], opts: { withCatalogRpc: boolean } = { withCatalogRpc: true }) {
  const table = rows.map((r) => ({ ...r }));
  const audit: AuditEntry[] = [];
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
    ...(opts.withCatalogRpc
      ? {
          rpc(fn: string, args: Record<string, unknown>) {
            if (fn !== 'update_catalog_exercise') throw new Error(`unexpected rpc ${fn}`);
            const id = args.p_exercise_id as string;
            const patch = args.p_patch as Record<string, unknown>;
            const row = table.find((r) => r.id === id);
            if (!row) {
              return Promise.resolve({ data: null, error: { message: `exercise ${id} does not exist` } });
            }
            const old: Record<string, unknown> = {};
            for (const key of Object.keys(patch)) {
              if (!CATALOG_EDITABLE_COLUMNS.has(key)) {
                return Promise.resolve({ data: null, error: { message: `column "${key}" is not editable` } });
              }
              old[key] = (row as unknown as Record<string, unknown>)[key];
            }
            audit.push({ exercise_id: id, edited_by: CURRENT_USER, old_values: old, new_values: patch });
            Object.assign(row, patch);
            return Promise.resolve({ data: { id, updated: true }, error: null });
          },
        }
      : {}),
  };
  // "Reload": what any read-path join on exercises returns afterwards.
  const reload = (id: string) => table.find((r) => r.id === id)!;
  return { client, reload, audit };
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

  it("another user's custom row persists through the audited RPC (Calf Press on Leg Press report)", async () => {
    // The reported row: a custom exercise created by a DIFFERENT account,
    // mis-tagged primary_muscle = quads, so its sets fed quad readiness
    // while the calf work went uncounted — and the direct owner-only UPDATE
    // matched zero rows, leaving nobody but the creator able to fix it.
    const foreignCalfPress: FakeExerciseRow = {
      id: 'ex-foreign',
      name: 'Calf Press on Leg Press',
      primary_muscle: 'quads',
      secondary_muscles: [],
      is_custom: true,
      created_by: 'user-2',
    };
    const { client, reload, audit } = makeFakeDb([foreignCalfPress]);

    const result = await updateExerciseRow(client, 'ex-foreign', {
      primary_muscle: 'calves',
    });
    expect(result).toEqual({ ok: true, outcome: 'updated_catalog' });
    expect(reload('ex-foreign').primary_muscle).toEqual('calves');

    // The cross-user edit is audited with the previous tag recoverable.
    expect(audit).toEqual([
      {
        exercise_id: 'ex-foreign',
        edited_by: CURRENT_USER,
        old_values: { primary_muscle: 'quads' },
        new_values: { primary_muscle: 'calves' },
      },
    ]);

    // And the volume read path moves the credit from quads to calves.
    const row = reload('ex-foreign');
    const workingSets = [{ id: 's1', is_warmup: false }, { id: 's2', is_warmup: false }];
    const stats = computeWeeklyMuscleVolume([{ exercises: row, set_logs: workingSets }]);
    expect(stats.find((s) => s.muscle === 'quads')).toBeUndefined();
    expect(stats.find((s) => s.muscle === 'calves')?.sets).toBeCloseTo(workingSets.length);
  });

  it('a stock catalog row persists through the audited RPC, with old values recorded', async () => {
    const { client, reload, audit } = makeFakeDb([customGluteDrive, stockGluteDrive]);

    const result = await updateExerciseRow(client, 'ex-stock', {
      secondary_muscles: ['hamstrings', 'quads'],
    });
    expect(result).toEqual({ ok: true, outcome: 'updated_catalog' });

    // Persisted on the shared row — every user's read paths see it.
    const row = reload('ex-stock');
    expect(row.secondary_muscles).toEqual(['hamstrings', 'quads']);

    // Audit BEFORE the write: the previous tags are recoverable.
    expect(audit).toEqual([
      {
        exercise_id: 'ex-stock',
        edited_by: CURRENT_USER,
        old_values: { secondary_muscles: ['hamstrings'] },
        new_values: { secondary_muscles: ['hamstrings', 'quads'] },
      },
    ]);

    // And the volume read path consumes the stock edit like any other row.
    const stats = computeWeeklyMuscleVolume([
      { exercises: row, set_logs: [{ id: 's1', is_warmup: false }, { id: 's2', is_warmup: false }] },
    ]);
    expect(stats.find((s) => s.muscle === 'quads')?.sets).toBeCloseTo(2 * SECONDARY_MUSCLE_CREDIT);
  });

  it('the RPC whitelist rejects non-editable columns and nothing is written', async () => {
    const { client, reload, audit } = makeFakeDb([stockGluteDrive]);

    const result = await updateExerciseRow(client, 'ex-stock', {
      secondary_muscles: ['hamstrings', 'quads'],
      is_custom: true,
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('error');
    expect(result.message).toMatch(/is_custom/);
    expect(reload('ex-stock').secondary_muscles).toEqual(['hamstrings']);
    expect(audit).toEqual([]);
  });

  it('without the catalog RPC, a stock row is reported blocked — never a silent success', async () => {
    const { client, reload } = makeFakeDb([customGluteDrive, stockGluteDrive], {
      withCatalogRpc: false,
    });

    const result = await updateExerciseRow(client, 'ex-stock', {
      secondary_muscles: ['hamstrings', 'quads'],
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('blocked');

    // And nothing was written.
    expect(reload('ex-stock').secondary_muscles).toEqual(['hamstrings']);
  });

  it('the stock Glute Drive Machine catalog row itself now carries quads (20260727000003)', () => {
    // The user-reported row is stock, so the correction also ships as an
    // audited catalog migration; the generated snapshot locks migration ↔
    // fallback.
    expect(SEED_EXERCISE_TAGS['Glute Drive Machine']).toEqual({
      primary: 'glutes',
      secondaries: ['hamstrings', 'quads'],
    });
  });
});
