/**
 * Mid-mesocycle Enhanced Athlete Mode flow — regeneration semantics.
 *
 * regenerateRemainingWeeksForEnhancedMode always rebuilds program_data from
 * the LIVE profile + the new flag (never from already-adjusted values), so
 * toggling on→adjust→off→adjust in the same week converges. When the current
 * week has already started, its plan is carried over verbatim.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  regenerateRemainingWeeksForEnhancedMode,
  type ActiveMesocycleRow,
} from '../enhancedAthleteMode';
import type { FullProgramRecommendation } from '@/types/schema';

// ------------------------------------------------------------------
// Chainable thenable Supabase mock
// ------------------------------------------------------------------

type QueryResult = { data?: unknown; error?: unknown; count?: number };

function makeQuery(result: QueryResult) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  for (const method of ['select', 'eq', 'order', 'limit', 'update', 'upsert']) {
    query[method] = jest.fn(chain);
  }
  query.single = jest.fn(() => Promise.resolve(result));
  query.maybeSingle = jest.fn(() => Promise.resolve(result));
  // The builder itself is thenable (awaiting without .single()).
  query.then = (resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve);
  return query;
}

interface MockDb {
  users: QueryResult;
  user_profiles: QueryResult;
  dexa_scans: QueryResult;
  workout_sessions: QueryResult;
}

function makeSupabaseMock(db: MockDb) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];

  const client = {
    from: jest.fn((table: string) => {
      if (table === 'mesocycles') {
        const query: Record<string, unknown> = {};
        query.update = jest.fn((payload: Record<string, unknown>) => {
          updates.push({ table, payload });
          return query;
        });
        query.eq = jest.fn(() => Promise.resolve({ error: null }));
        return query;
      }
      return makeQuery(db[table as keyof MockDb] ?? { data: null, error: null });
    }),
  } as unknown as SupabaseClient;

  return { client, updates };
}

const NATURAL_USER_ROW = {
  id: 'user-1',
  age: 30,
  experience: 'intermediate',
  goal: 'bulk',
  sleep_quality: 3,
  stress_level: 3,
  training_age_years: 2,
  available_equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
  injury_history: [],
  height_cm: 175,
  enhanced_athlete_mode: false,
};

function makeDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    users: { data: NATURAL_USER_ROW, error: null },
    user_profiles: { data: { goal: 'bulk', experience: 'intermediate' }, error: null },
    dexa_scans: { data: [], error: null },
    workout_sessions: { count: 0, error: null },
    ...overrides,
  };
}

function makeMesocycle(overrides: Partial<ActiveMesocycleRow> = {}): ActiveMesocycleRow {
  return {
    id: 'meso-1',
    name: 'Test Block',
    current_week: 2,
    total_weeks: 6,
    deload_week: 6,
    days_per_week: 4,
    session_duration_minutes: 60,
    program_data: null,
    ...overrides,
  };
}

async function regenerate(
  db: MockDb,
  mesocycle: ActiveMesocycleRow,
  enhanced: boolean
): Promise<{ payload: Record<string, unknown>; program: FullProgramRecommendation }> {
  const { client, updates } = makeSupabaseMock(db);
  await regenerateRemainingWeeksForEnhancedMode(client, 'user-1', mesocycle, enhanced);
  expect(updates).toHaveLength(1);
  const payload = updates[0].payload;
  return { payload, program: payload.program_data as FullProgramRecommendation };
}

describe('regenerateRemainingWeeksForEnhancedMode', () => {
  jest.setTimeout(30000);

  it('toggling ON regenerates with enhanced volume and tags the mesocycle', async () => {
    const { payload: naturalPayload, program: naturalProgram } = await regenerate(
      makeDb(),
      makeMesocycle(),
      false
    );
    const { payload: enhancedPayload, program: enhancedProgram } = await regenerate(
      makeDb(),
      makeMesocycle(),
      true
    );

    expect(naturalPayload.generated_with_enhanced_mode).toBe(false);
    expect(enhancedPayload.generated_with_enhanced_mode).toBe(true);

    // Enhanced landmarks raise weekly volume for at least some muscles and
    // never lower any of them.
    const naturalVolume = naturalProgram.volumePerMuscle;
    const enhancedVolume = enhancedProgram.volumePerMuscle;
    const muscles = Object.keys(naturalVolume) as Array<keyof typeof naturalVolume>;
    expect(muscles.length).toBeGreaterThan(0);
    let someHigher = false;
    for (const muscle of muscles) {
      expect(enhancedVolume[muscle].sets).toBeGreaterThanOrEqual(naturalVolume[muscle].sets);
      if (enhancedVolume[muscle].sets > naturalVolume[muscle].sets) someHigher = true;
    }
    expect(someHigher).toBe(true);

    // Accumulation runs one week longer before deload.
    expect(enhancedProgram.mesocycleWeeks!.length).toBe(
      naturalProgram.mesocycleWeeks!.length + 1
    );
  });

  it('toggling OFF clamps volume back to natural-MRV territory', async () => {
    // Start from an enhanced program in program_data.
    const { program: enhancedProgram } = await regenerate(makeDb(), makeMesocycle(), true);
    const { payload, program: naturalProgram } = await regenerate(
      makeDb(),
      makeMesocycle({ program_data: enhancedProgram }),
      false
    );

    expect(payload.generated_with_enhanced_mode).toBe(false);

    // Regenerated natural program equals a from-scratch natural program —
    // i.e. everything the enhanced plan pushed above natural limits came
    // back down (the generator clamps weekly volume to natural MRV).
    const { program: freshNatural } = await regenerate(makeDb(), makeMesocycle(), false);
    expect(JSON.parse(JSON.stringify(naturalProgram))).toEqual(
      JSON.parse(JSON.stringify(freshNatural))
    );
  });

  it('is idempotent from the base profile — repeat toggles never compound', async () => {
    const first = await regenerate(makeDb(), makeMesocycle(), true);
    // Second regeneration runs against the ALREADY-adjusted program_data.
    const second = await regenerate(
      makeDb(),
      makeMesocycle({ program_data: first.program }),
      true
    );
    expect(JSON.parse(JSON.stringify(second.program))).toEqual(
      JSON.parse(JSON.stringify(first.program))
    );
  });

  it('carries the current week over verbatim when the week has already started', async () => {
    const { program: oldProgram } = await regenerate(makeDb(), makeMesocycle(), false);

    // 5 completed sessions at 4/week -> 1 session into week 2 (mid-week).
    const db = makeDb({ workout_sessions: { count: 5, error: null } });
    const { program: newProgram } = await regenerate(
      db,
      makeMesocycle({ current_week: 2, program_data: oldProgram }),
      true
    );

    // Week 2 (index 1) is preserved from the old plan; later weeks are new.
    expect(JSON.parse(JSON.stringify(newProgram.mesocycleWeeks![1]))).toEqual(
      JSON.parse(JSON.stringify(oldProgram.mesocycleWeeks![1]))
    );
  });

  it('updates the current week too when the week has NOT started', async () => {
    const { program: oldProgram } = await regenerate(makeDb(), makeMesocycle(), false);

    // 4 completed sessions at 4/week -> exactly at the week-2 boundary.
    const db = makeDb({ workout_sessions: { count: 4, error: null } });
    const { program: newProgram } = await regenerate(
      db,
      makeMesocycle({ current_week: 2, program_data: oldProgram }),
      true
    );

    // No splice: week 2 comes from the fresh enhanced generation, not from
    // the old natural plan.
    const { program: freshEnhanced } = await regenerate(makeDb(), makeMesocycle(), true);
    expect(JSON.parse(JSON.stringify(newProgram.mesocycleWeeks![1]))).toEqual(
      JSON.parse(JSON.stringify(freshEnhanced.mesocycleWeeks![1]))
    );
  });
});
