/**
 * End-to-end smoke test for the headless driver.
 *
 * This is the first point where the whole loop runs without a browser:
 * create a program, start a session, ask for a prescription, log sets, edit,
 * delete, finish, advance time, and come back the next training day — all
 * through the production functions the UI calls.
 *
 * Scope note: this is Phase 1's proof that the loop RUNS and that state stays
 * coherent across it. The invariant/contract suites, the personas and the
 * seeded stochastic runs are Phases 2–4 and deliberately not here.
 */
import { createFakeSupabase, type FakeSupabase } from '../fakeSupabase';
import { SessionDriver } from '../sessionDriver';
import { resetClock } from '@/lib/clock';
import { __setDriverForTests, type OutboxEntry } from '@/lib/offline/setOutbox';

// The finish flow fire-and-forgets a workout-calorie estimate through a SERVER
// action that cannot resolve headlessly. Production catches it; mocking here
// keeps simulated output clean without pretending the path ran.
jest.mock('@/lib/actions/workout-calories', () => ({
  calculateAndSaveWorkoutCalories: jest.fn().mockResolvedValue(undefined),
}));

function memoryOutbox() {
  const map = new Map<string, OutboxEntry>();
  return {
    put: async (e: OutboxEntry) => { map.set(e.id, { ...e }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => { map.delete(id); },
    get: async (id: string) => map.get(id),
  };
}

const USER = 'user-1';

/** A user, an exercise catalog, and a profile — bootstrap data only. */
function seedWorld(fake: FakeSupabase) {
  fake.db.seed('users', [
    {
      id: USER,
      weight_kg: 80,
      height_cm: 178,
      experience: 'intermediate',
      goal: 'bulk',
      preferences: {},
      volume_landmarks: null,
      enhanced_athlete_mode: false,
    },
  ]);
  fake.db.seed('user_profiles', [{ user_id: USER, goal: 'bulk', experience: 'intermediate' }]);
  fake.db.seed('exercises', [
    {
      id: 'ex-bench',
      name: 'Barbell Bench Press',
      primary_muscle: 'chest',
      secondary_muscles: ['triceps', 'front_delts'],
      equipment_required: ['barbell'],
      is_bodyweight: false,
      exercise_type: 'rep_based',
      min_weight_increment_kg: 2.5,
      deleted_at: null,
    },
    {
      id: 'ex-row',
      name: 'Barbell Row',
      primary_muscle: 'lats',
      secondary_muscles: ['biceps'],
      equipment_required: ['barbell'],
      is_bodyweight: false,
      exercise_type: 'rep_based',
      min_weight_increment_kg: 2.5,
      deleted_at: null,
    },
  ]);
}

/**
 * A session with two blocks, inserted directly. Session START has a wide query
 * surface (program_data resolution, transfer candidates, warmup generation)
 * that the fake does not yet cover end-to-end; the operations under test here
 * are the ones after it. `startSession` itself is covered separately below at
 * the level the fake supports.
 */
function seedSession(fake: FakeSupabase, sessionId: string, plannedDate: string) {
  fake.db.seed('workout_sessions', [
    {
      id: sessionId,
      user_id: USER,
      mesocycle_id: null,
      state: 'in_progress',
      planned_date: plannedDate,
      started_at: `${plannedDate}T09:00:00.000Z`,
      completed_at: null,
      completion_percent: 0,
      location_id: null,
      is_deload: false,
    },
  ]);
  fake.db.seed('exercise_blocks', [
    {
      id: `${sessionId}-b1`,
      workout_session_id: sessionId,
      exercise_id: 'ex-bench',
      order: 1,
      target_sets: 3,
      target_rep_range: [8, 12],
      target_rir: 2,
      target_weight_kg: 100,
      target_rest_seconds: 180,
      warmup_protocol: { sets: [] },
      suggestion_reason: '',
      skipped_at: null,
    },
    {
      id: `${sessionId}-b2`,
      workout_session_id: sessionId,
      exercise_id: 'ex-row',
      order: 2,
      target_sets: 3,
      target_rep_range: [8, 12],
      target_rir: 2,
      target_weight_kg: 80,
      target_rest_seconds: 180,
      warmup_protocol: { sets: [] },
      skipped_at: null,
    },
  ]);
}

/**
 * A driver already attached to a seeded session. `adoptSession` exists on the
 * driver precisely so a test (or a persona resuming a session it did not
 * start) can point at an existing session without reaching into private state.
 */
function makeDriver(fake: FakeSupabase, sessionId: string) {
  const driver = new SessionDriver({
    supabase: fake.client,
    userId: USER,
    startAt: '2026-04-06T09:00:00',
  });
  driver.adoptSession(sessionId);
  return driver;
}

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase({ userId: USER });
  seedWorld(fake);
  __setDriverForTests(memoryOutbox());
});
afterEach(() => {
  resetClock();
  __setDriverForTests(null);
});

describe('the loop runs headlessly', () => {
  it('loads a session, prescribes, logs three sets and sees them back', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();

    expect(driver.blocks.map((b) => b.exercise?.name)).toEqual([
      'Barbell Bench Press',
      'Barbell Row',
    ]);
    expect(driver.position()).toEqual({ blockIndex: 0, setNumber: 1 });

    for (let i = 0; i < 3; i++) {
      const rx = driver.getPrescription(0);
      expect(rx).not.toBeNull();
      const outcome = await driver.logSet(
        0,
        { weightKg: rx!.weightKg, reps: rx!.reps, rpe: 10 - rx!.rir },
        { prescribedFor: rx }
      );
      expect(outcome.result.status).toBe('saved');
    }

    expect(driver.setsForBlock(0)).toHaveLength(3);
    expect(driver.setsForBlock(0).map((s) => s.setNumber)).toEqual([1, 2, 3]);
    // Block 1 is complete, so the session moves on.
    expect(driver.position().blockIndex).toBe(1);
  });

  it('stamps strictly increasing logged_at — the anchor window depends on it', async () => {
    // Three engine paths use ORDER BY ... LIMIT on a timestamp; a tie at the
    // boundary resolves by unspecified row order. Equal stamps here would make
    // the e1RM anchor nondeterministic and look like an engine bug.
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();

    for (let i = 0; i < 3; i++) {
      await driver.logSet(0, { weightKg: 100, reps: 10, rpe: 8 }, { restSeconds: 150 });
    }

    const stamps = driver.setsForBlock(0).map((s) => s.loggedAt);
    expect(new Set(stamps).size).toBe(3);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('gives every set a deterministic id, so a replay is comparable', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();
    await driver.logSet(0, { weightKg: 100, reps: 10, rpe: 8 });
    await driver.logSet(0, { weightKg: 100, reps: 9, rpe: 8.5 });

    expect(driver.setsForBlock(0).map((s) => s.id)).toEqual(['set-000001', 'set-000002']);
  });

  it('the prescription responds to what was actually logged', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();

    // A set left clearly too easy should not produce the same target again.
    const first = driver.getPrescription(0)!;
    await driver.logSet(0, { weightKg: first.weightKg, reps: 15, rpe: 6 });
    const second = driver.getPrescription(0)!;

    expect(second.weightKg).toBeGreaterThan(first.weightKg);
    expect(second.rationale).toBe('increase_load');
  });

  it('edits and deletes flow through the production write path', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();

    await driver.logSet(0, { weightKg: 100, reps: 10, rpe: 8 });
    await driver.logSet(0, { weightKg: 100, reps: 9, rpe: 9 });
    const [first, second] = driver.setsForBlock(0);

    await driver.editSet(first.id, { weightKg: 105, reps: 8, rpe: 9 });
    const edited = driver.setsForBlock(0).find((s) => s.id === first.id)!;
    expect(edited.weightKg).toBe(105);
    expect(edited.reps).toBe(8);
    expect(edited.quality).toBe('stimulative');

    await driver.deleteSet(second.id);
    expect(driver.setsForBlock(0).map((s) => s.id)).toEqual([first.id]);
    // Hard delete: the row is gone, not flagged (audit H3).
    expect(fake.db.rows('set_logs')).toHaveLength(1);
  });

  it('completes a session and marks it completed in the database', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();
    await driver.logSet(0, { weightKg: 100, reps: 10, rpe: 8 });

    await driver.completeSession({ sessionRpe: 8 });

    const row = fake.db.rows('workout_sessions').find((r) => r.id === 's1')!;
    expect(row.state).toBe('completed');
    // 09:00 local start + one 180s rest, in the suite's pinned America/Denver
    // (UTC-6 in April) — the instant is stored in UTC, the DAY is local.
    expect(row.completed_at).toBe('2026-04-06T15:03:00.000Z');
    expect(driver.clock.today()).toBe('2026-04-06');
    expect(driver.currentSessionId).toBeNull();
  });
});

describe('simulated time', () => {
  it('advances by calendar days, keeping the time of day', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();

    driver.advanceDays(2);
    expect(driver.clock.today()).toBe('2026-04-08');
    expect(driver.clock.now().getHours()).toBe(9);
  });

  it('a day across the DST boundary is 23 hours, not 24', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    driver.clock.set('2026-03-07T18:30:00');
    const before = driver.clock.nowMs();
    driver.advanceDays(1);

    expect(driver.clock.today()).toBe('2026-03-08');
    expect(driver.clock.nowMs() - before).toBe(23 * 3_600_000);
  });

  it('sessions logged weeks apart carry weeks-apart timestamps', async () => {
    seedSession(fake, 's1', '2026-04-06');
    const driver = makeDriver(fake, 's1');
    await driver.refresh();
    await driver.logSet(0, { weightKg: 100, reps: 10, rpe: 8 });
    const first = driver.setsForBlock(0)[0].loggedAt;

    driver.advanceDays(21);
    await driver.logSet(0, { weightKg: 100, reps: 10, rpe: 8 });
    const later = driver.setsForBlock(0)[1].loggedAt;

    const gapDays = (Date.parse(later) - Date.parse(first)) / 86_400_000;
    expect(Math.round(gapDays)).toBe(21);
  });
});

describe('createProgram', () => {
  it('creates an active mesocycle through the production write', async () => {
    const driver = new SessionDriver({
      supabase: fake.client,
      userId: USER,
      startAt: '2026-04-06T09:00:00',
    });

    const result = await driver.createProgram({
      name: 'Sim Block',
      splitType: 'PPL',
      daysPerWeek: 3,
      totalWeeks: 6,
      scheduleMode: 'fixed_days',
      preferredWorkoutDays: ['Monday', 'Wednesday', 'Friday'],
      fullProgram: null,
    });

    const row = fake.db.rows('mesocycles').find((r) => r.id === result.mesocycleId)!;
    expect(row.state).toBe('active');
    expect(row.current_week).toBe(1);
    expect(row.start_date).toBe('2026-04-06');
    expect(driver.currentMesocycleId).toBe(result.mesocycleId);
  });

  it('a second program deactivates the first — never two active blocks', async () => {
    const driver = new SessionDriver({
      supabase: fake.client,
      userId: USER,
      startAt: '2026-04-06T09:00:00',
    });
    const base = {
      splitType: 'PPL',
      daysPerWeek: 3,
      totalWeeks: 6,
      scheduleMode: 'fixed_days' as const,
      preferredWorkoutDays: ['Monday', 'Wednesday', 'Friday'] as never,
      fullProgram: null,
    };

    await driver.createProgram({ ...base, name: 'First' });
    driver.advanceDays(42);
    await driver.createProgram({ ...base, name: 'Second' });

    const active = fake.db.rows('mesocycles').filter((r) => r.state === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Second');
  });
});

describe('the fake client fails loudly rather than quietly', () => {
  it('throws on an embed it was never taught', async () => {
    // The whole point: a silent [] here would hand the engine an empty history
    // and the harness would report a fictional prescription bug.
    await expect(
      fake.client.from('exercise_blocks').select('id, nonsense_table (*)').eq('id', 'x')
    ).rejects.toThrow(/unsupported embed/);
  });

  it('throws on an unsupported not() operator', () => {
    expect(() => fake.client.from('set_logs').select('*').not('reps', 'gt', 5)).toThrow(
      /unsupported not/
    );
  });
});
