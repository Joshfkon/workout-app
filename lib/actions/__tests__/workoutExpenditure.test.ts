/**
 * Workout calories must accumulate per session, survive later step entries,
 * and be recorded even when the day has no daily_activity_data row yet.
 */
jest.mock('@/lib/supabase/server', () => ({
  createUntypedServerClient: jest.fn(),
  createClient: jest.fn(),
}));

import { createUntypedServerClient } from '@/lib/supabase/server';
import { createMemorySupabase, type MemorySupabase } from './memorySupabase';
import { updateWorkoutExpenditure, saveDailyActivityData } from '@/lib/actions/wearable';

const USER = 'user-1';
const DAY = '2026-11-12';

const session = (id: string) => ({
  workoutSessionId: id,
  startTime: '2026-11-12T07:00:00.000Z',
  endTime: '2026-11-12T08:00:00.000Z',
  durationMinutes: 60,
  muscleGroups: ['chest'],
  totalSets: 12,
  totalVolume: 5000,
  averageRestSeconds: 120,
});

let fake: MemorySupabase;

const dayRow = () =>
  fake.rows('daily_activity_data').find((r) => r.user_id === USER && r.date === DAY);

beforeEach(() => {
  fake = createMemorySupabase(USER);
  (createUntypedServerClient as jest.Mock).mockResolvedValue(fake.client);
});

describe('updateWorkoutExpenditure', () => {
  it('creates the daily row when the day has none (was a silent 0-row update)', async () => {
    const result = await updateWorkoutExpenditure(DAY, 310, session('am'));

    expect(result.success).toBe(true);
    expect(dayRow()).toMatchObject({ workout_expenditure: 310, total_activity_expenditure: 310 });
  });

  it('accumulates a two-a-day instead of replacing the first session', async () => {
    await updateWorkoutExpenditure(DAY, 310, session('am'));
    await updateWorkoutExpenditure(DAY, 280, session('pm'));

    expect(dayRow()).toMatchObject({ workout_expenditure: 590, total_activity_expenditure: 590 });
    expect(fake.rows('app_workout_activity')).toHaveLength(2);
  });

  it('is idempotent when the same session is saved again', async () => {
    await updateWorkoutExpenditure(DAY, 310, session('am'));
    await updateWorkoutExpenditure(DAY, 330, session('am'));

    expect(dayRow()).toMatchObject({ workout_expenditure: 330 });
    expect(fake.rows('app_workout_activity')).toHaveLength(1);
  });

  it('adds to existing step expenditure in the daily total', async () => {
    fake.seed('daily_activity_data', [
      { id: 'd1', user_id: USER, date: DAY, steps_total: 8000, step_expenditure: 320, workout_expenditure: 0, total_activity_expenditure: 320 },
    ]);

    await updateWorkoutExpenditure(DAY, 300, session('am'));

    expect(dayRow()).toMatchObject({ workout_expenditure: 300, total_activity_expenditure: 620 });
  });

  it('without session details never lowers an already recorded value', async () => {
    fake.seed('daily_activity_data', [
      { id: 'd1', user_id: USER, date: DAY, step_expenditure: 0, workout_expenditure: 400, total_activity_expenditure: 400 },
    ]);

    await updateWorkoutExpenditure(DAY, 250);

    expect(dayRow()).toMatchObject({ workout_expenditure: 400, total_activity_expenditure: 400 });
  });
});

describe('saveDailyActivityData', () => {
  it('keeps workout calories when steps are entered after the workout', async () => {
    await updateWorkoutExpenditure(DAY, 310, session('am'));

    const result = await saveDailyActivityData(
      { date: DAY, steps: { total: 10000, source: 'manual', confidence: 'manual' } },
      70
    );

    expect(result.success).toBe(true);
    // 10,000 steps * 0.04 kcal at 70 kg = 400
    expect(dayRow()).toMatchObject({
      steps_total: 10000,
      step_expenditure: 400,
      workout_expenditure: 310,
      total_activity_expenditure: 710,
    });
  });

  it('still works for a day with no workout', async () => {
    await saveDailyActivityData(
      { date: DAY, steps: { total: 5000, source: 'manual', confidence: 'manual' } },
      70
    );
    const row = dayRow();
    expect(row).toMatchObject({ steps_total: 5000, step_expenditure: 200, total_activity_expenditure: 200 });
    expect(row?.workout_expenditure ?? 0).toBe(0);
  });
});
