/**
 * Tests for the extracted mesocycle-creation write (lib/training/createMesocycle).
 *
 * Two things matter here and neither was testable while this lived in a form
 * handler: the week reconciliation that keeps `current_week` from indexing past
 * the end of `program_data`, and the refusal to insert a new block when
 * deactivating the old one failed (which would leave two active mesocycles —
 * a state every "the active mesocycle" read in the app assumes is impossible).
 */
import {
  createMesocycle,
  reconcileMesocycleWeeks,
  buildMesocycleRow,
  type CreateMesocycleInput,
  type MesocycleWriteClient,
} from '@/lib/training/createMesocycle';
import { resetClock, setClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';
import type { FullProgramRecommendation } from '@/types/schema';

afterEach(resetClock);

const program = (weeks: { weekNumber: number; isDeload?: boolean }[]) =>
  ({ mesocycleWeeks: weeks, periodization: { model: 'linear' } } as unknown as FullProgramRecommendation);

function stubClient(opts: {
  deactivateError?: { message: string } | null;
  insertError?: { message: string } | null;
  insertedId?: string;
} = {}) {
  const calls: string[] = [];
  let insertedRow: Record<string, unknown> | null = null;

  const client = {
    from(table: string) {
      return {
        update: () => ({
          eq: () => ({
            eq: async () => {
              calls.push(`deactivate:${table}`);
              return { error: opts.deactivateError ?? null };
            },
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          calls.push(`insert:${table}`);
          insertedRow = row;
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : { data: { id: opts.insertedId ?? 'm1', ...row }, error: null },
            }),
          };
        },
      };
    },
  };
  return {
    client: client as unknown as MesocycleWriteClient,
    calls,
    inserted: () => insertedRow,
  };
}

const baseInput: CreateMesocycleInput = {
  userId: 'u1',
  splitType: 'PPL',
  daysPerWeek: 3,
  totalWeeks: 6,
  scheduleMode: 'fixed_days',
  preferredWorkoutDays: ['Monday', 'Wednesday', 'Friday'],
  fullProgram: null,
};

describe('reconcileMesocycleWeeks', () => {
  it('clamps the requested length to the program actually generated', () => {
    // Asking for 8 weeks but generating 4 must not leave current_week able to
    // run past the end of program_data.mesocycleWeeks.
    expect(reconcileMesocycleWeeks(8, program([{ weekNumber: 1 }, { weekNumber: 2 }, { weekNumber: 3 }, { weekNumber: 4 }])))
      .toEqual({ effectiveTotalWeeks: 4, effectiveDeloadWeek: 4 });
  });

  it('keeps the requested length when the program is longer', () => {
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8].map((weekNumber) => ({ weekNumber }));
    expect(reconcileMesocycleWeeks(6, program(weeks)).effectiveTotalWeeks).toBe(6);
  });

  it("uses the program's marked deload week", () => {
    const result = reconcileMesocycleWeeks(
      5,
      program([{ weekNumber: 1 }, { weekNumber: 2 }, { weekNumber: 3 }, { weekNumber: 4, isDeload: true }, { weekNumber: 5 }])
    );
    expect(result.effectiveDeloadWeek).toBe(4);
  });

  it('falls back to the last week when the marked deload is out of range', () => {
    // Deload marked at week 8 but the block was clamped to 4 — pointing at 8
    // would mark a deload that can never arrive.
    const weeks = [1, 2, 3, 4].map((weekNumber) => ({ weekNumber, isDeload: weekNumber === 8 }));
    expect(reconcileMesocycleWeeks(4, program(weeks)).effectiveDeloadWeek).toBe(4);
  });

  it('trusts the requested length when there is no program at all', () => {
    expect(reconcileMesocycleWeeks(6, null)).toEqual({
      effectiveTotalWeeks: 6,
      effectiveDeloadWeek: 6,
    });
  });
});

describe('buildMesocycleRow', () => {
  const weeks = { effectiveTotalWeeks: 6, effectiveDeloadWeek: 6 };

  it('anchors start_date on the clock when not supplied', () => {
    setClock(createTestClock('2026-04-06T09:00:00'));
    expect(buildMesocycleRow(baseInput, weeks).start_date).toBe('2026-04-06');
  });

  it('prefers an explicit start_date — the interval anchor is load-bearing', () => {
    setClock(createTestClock('2026-04-06T09:00:00'));
    expect(buildMesocycleRow({ ...baseInput, startDate: '2026-05-01' }, weeks).start_date).toBe(
      '2026-05-01'
    );
  });

  it('stores the interval only in interval mode', () => {
    const fixed = buildMesocycleRow({ ...baseInput, trainingIntervalDays: 3 }, weeks);
    expect(fixed.training_interval_days).toBeNull();

    const interval = buildMesocycleRow(
      { ...baseInput, scheduleMode: 'interval', trainingIntervalDays: 3 },
      weeks
    );
    expect(interval.training_interval_days).toBe(3);
  });

  it('keeps preferred days even in interval mode so switching back restores them', () => {
    const row = buildMesocycleRow({ ...baseInput, scheduleMode: 'interval', trainingIntervalDays: 2 }, weeks);
    expect(row.preferred_workout_days).toEqual(['Monday', 'Wednesday', 'Friday']);
  });

  it('falls back to a generated name only when none was given', () => {
    setClock(createTestClock('2026-04-06T09:00:00'));
    expect(buildMesocycleRow({ ...baseInput, name: 'Spring Block' }, weeks).name).toBe('Spring Block');
    expect(String(buildMesocycleRow(baseInput, weeks).name)).toContain('PPL');
  });

  it('starts at week 1, active', () => {
    const row = buildMesocycleRow(baseInput, weeks);
    expect(row.current_week).toBe(1);
    expect(row.state).toBe('active');
    expect(row.is_active).toBe(true);
  });

  it("prefers the generated program's volume targets over the legacy recommendation", () => {
    const withProgram = buildMesocycleRow(
      {
        ...baseInput,
        fullProgram: { ...program([{ weekNumber: 1 }]), volumePerMuscle: { chest: 12 } } as never,
        recommendation: { volumePerMuscle: { chest: 99 } } as never,
      },
      weeks
    );
    expect(withProgram.volume_per_muscle).toEqual({ chest: 12 });
  });
});

describe('createMesocycle', () => {
  it('deactivates the previous block before inserting the new one', async () => {
    const { client, calls } = stubClient();
    await createMesocycle(client, baseInput);
    expect(calls).toEqual(['deactivate:mesocycles', 'insert:mesocycles']);
  });

  it('does NOT insert when deactivation failed', async () => {
    // Pressing on here is what would leave the user with two active
    // mesocycles — the failure mode this ordering exists to prevent.
    const { client, calls } = stubClient({ deactivateError: { message: 'permission denied' } });

    await expect(createMesocycle(client, baseInput)).rejects.toThrow(
      /Couldn't close your current mesocycle/
    );
    expect(calls).toEqual(['deactivate:mesocycles']);
  });

  it('returns the reconciled weeks alongside the id', async () => {
    const { client } = stubClient({ insertedId: 'meso-9' });
    const result = await createMesocycle(client, {
      ...baseInput,
      totalWeeks: 8,
      fullProgram: program([{ weekNumber: 1 }, { weekNumber: 2, isDeload: true }]),
    });

    expect(result.mesocycleId).toBe('meso-9');
    expect(result.effectiveTotalWeeks).toBe(2);
    expect(result.effectiveDeloadWeek).toBe(2);
  });

  it('routes an insert failure through the caller-supplied describer', async () => {
    const { client } = stubClient({ insertError: { message: 'PGRST204' } });
    await expect(
      createMesocycle(client, baseInput, {
        describeInsertFailure: () => 'run your migrations',
      })
    ).rejects.toThrow('run your migrations');
  });

  it('has a usable default message when no describer is given', async () => {
    const { client } = stubClient({ insertError: { message: 'boom' } });
    await expect(createMesocycle(client, baseInput)).rejects.toThrow(/boom|Failed to create/);
  });
});
