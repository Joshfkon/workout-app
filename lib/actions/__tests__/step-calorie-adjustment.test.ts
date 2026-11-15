/**
 * getStepAdjustmentInputs: the setting gate (default 'fixed' → nothing moves)
 * and the data it hands the client-side math.
 */
jest.mock('@/lib/supabase/server', () => ({
  createUntypedServerClient: jest.fn(),
  createClient: jest.fn(),
}));

import { createUntypedServerClient } from '@/lib/supabase/server';
import { createMemorySupabase, type MemorySupabase } from './memorySupabase';
import { getStepAdjustmentInputs } from '../step-calorie-adjustment';

const USER = 'user-1';
let db: MemorySupabase;

function seedSteps(start: string, steps: number[]) {
  db.seed(
    'daily_activity_data',
    steps.map((s, i) => {
      const d = new Date(start + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      return { user_id: USER, date: d.toISOString().slice(0, 10), steps_total: s };
    })
  );
}

beforeEach(() => {
  db = createMemorySupabase(USER);
  (createUntypedServerClient as jest.Mock).mockResolvedValue(db.client);
});

describe('getStepAdjustmentInputs', () => {
  it('is disabled when the user has no activity_settings row (default fixed)', async () => {
    seedSteps('2026-11-01', Array(14).fill(8000));
    const r = await getStepAdjustmentInputs('2026-11-14');
    expect(r.enabled).toBe(false);
    expect(r.baseline).toBeNull();
  });

  it.each(['fixed', 'deficit_locked'])('is disabled for mode %s', async (mode) => {
    db.seed('activity_settings', [{ user_id: USER, adjustment_mode: mode, max_daily_adjustment: 300 }]);
    seedSteps('2026-11-01', Array(14).fill(8000));
    expect((await getStepAdjustmentInputs('2026-11-14')).enabled).toBe(false);
  });

  it('returns baseline, day steps, weight and cap when activity_adjusted', async () => {
    db.seed('activity_settings', [{ user_id: USER, adjustment_mode: 'activity_adjusted', max_daily_adjustment: 200 }]);
    seedSteps('2026-11-01', [...Array(13).fill(8000), 11000]); // 11-01..11-14
    db.seed('weight_log', [
      { user_id: USER, logged_at: '2026-11-10', weight: 176.4, unit: 'lb' },
      { user_id: USER, logged_at: '2026-11-01', weight: 190, unit: 'lb' },
    ]);
    const r = await getStepAdjustmentInputs('2026-11-14');
    expect(r.enabled).toBe(true);
    expect(r.maxDailyAdjustment).toBe(200);
    expect(r.daySteps).toBe(11000);
    expect(r.baseline).toEqual({ avgSteps: 8000, days: 13 });
    expect(r.weightKg).toBeCloseTo(80, 0);
  });

  it('reports no day steps when today has not synced yet', async () => {
    db.seed('activity_settings', [{ user_id: USER, adjustment_mode: 'activity_adjusted', max_daily_adjustment: 300 }]);
    seedSteps('2026-11-01', Array(13).fill(8000));
    const r = await getStepAdjustmentInputs('2026-11-14');
    expect(r.daySteps).toBeNull();
    expect(r.baseline?.days).toBe(13);
  });

  it('rejects malformed dates', async () => {
    expect((await getStepAdjustmentInputs('nope')).enabled).toBe(false);
  });
});
