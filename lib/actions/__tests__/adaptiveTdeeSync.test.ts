/**
 * The adaptive TDEE sync must never overwrite hand-set targets, must respect
 * the user's goal, and must compute the formula from the user's real stats.
 */
jest.mock('@/lib/supabase/server', () => ({
  createUntypedServerClient: jest.fn(),
  createClient: jest.fn(),
}));

// Force a stable, clearly-different measured estimate so the gating (not the
// estimator) is what is under test.
jest.mock('@/lib/nutrition/interval-tdee', () => {
  const actual = jest.requireActual('@/lib/nutrition/interval-tdee');
  return {
    ...actual,
    estimateIntervalTDEE: jest.fn((input: { formulaTDEE: number; now: unknown }) => ({
      ...actual.estimateIntervalTDEE({ ...input, weighIns: [], intakeDays: [] }),
      estimatedTDEE: 2800,
      burnRatePerLb: 15,
      confidence: 'stable',
      confidenceScore: 90,
      source: 'blended',
    })),
  };
});

import { createUntypedServerClient, createClient } from '@/lib/supabase/server';
import { createMemorySupabase, type MemorySupabase } from './memorySupabase';
import { estimateIntervalTDEE } from '@/lib/nutrition/interval-tdee';
import { syncAdaptiveTDEEWithTargets, getAdaptiveTDEE } from '@/lib/actions/tdee';
import { today } from '@/lib/clock';
import { addLocalDays } from '@/lib/date/localDay';

const USER = 'user-1';
let fake: MemorySupabase;

const targets = () => fake.rows('nutrition_targets').find((r) => r.user_id === USER);

beforeEach(() => {
  fake = createMemorySupabase(USER);
  (createUntypedServerClient as jest.Mock).mockResolvedValue(fake.client);
  (createClient as jest.Mock).mockResolvedValue(fake.client);
  (estimateIntervalTDEE as jest.Mock).mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  fake.seed('users', [{ id: USER, height_cm: 160, age: 45, sex: 'female', weight_kg: 60, preferences: { units: 'kg' } }]);
  fake.seed('weight_log', [{ id: 'w1', user_id: USER, logged_at: today(), weight: 60, unit: 'kg' }]);
  fake.seed('nutrition_targets', [
    { id: 't1', user_id: USER, calories: 1900, protein: 140, carbs: 180, fat: 60 },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('syncAdaptiveTDEEWithTargets', () => {
  it('leaves hand-entered targets alone when there is no macro_settings row', async () => {
    const result = await syncAdaptiveTDEEWithTargets();

    expect(result?.synced).toBe(false);
    expect(targets()).toMatchObject({ calories: 1900, protein: 140, carbs: 180, fat: 60 });
  });

  it('leaves targets alone when auto-update is switched off', async () => {
    fake.seed('macro_settings', [
      { id: 'm1', user_id: USER, height_cm: 160, age: 45, sex: 'female', activity_level: 'moderate', goal: 'moderate_cut', auto_update_enabled: false },
    ]);

    const result = await syncAdaptiveTDEEWithTargets();

    expect(result?.synced).toBe(false);
    expect(targets()).toMatchObject({ calories: 1900 });
  });

  it("updates an opted-in user's targets using their own goal (a cut stays a cut)", async () => {
    fake.seed('macro_settings', [
      { id: 'm1', user_id: USER, height_cm: 160, age: 45, sex: 'female', activity_level: 'moderate', goal: 'moderate_cut', peptide: 'none', auto_update_enabled: true },
    ]);

    const result = await syncAdaptiveTDEEWithTargets();

    expect(result?.synced).toBe(true);
    const updated = targets();
    expect(updated?.calories).toBe(result?.newCalories);
    // Cutting from a measured 2,800 kcal TDEE: below maintenance, not at it.
    expect(updated?.calories as number).toBeLessThan(2800);
    expect(updated?.calories as number).toBeGreaterThan(1200);
  });
});

describe('getAdaptiveTDEE', () => {
  it("computes the formula from the user's real profile, not male / 175 cm / 30", async () => {
    const tdee = await getAdaptiveTDEE();
    const call = (estimateIntervalTDEE as jest.Mock).mock.calls[0][0];

    // Mifflin-St Jeor BMR for 60 kg / 160 cm / 45 y female is 1,214 kcal
    // (the old hard-coded profile gave 1,549): TDEE is well under 2,300.
    expect(tdee?.formulaEstimate.estimatedTDEE).toBeLessThan(2300);
    expect(call.formulaTDEE).toBe(tdee?.formulaEstimate.estimatedTDEE);
  });

  it("anchors the window on the client's local day, so a weigh-in logged 'tomorrow' in UTC terms counts", async () => {
    const clientDay = addLocalDays(today(), 1); // e.g. Sydney morning on a UTC host
    fake.seed('weight_log', [{ id: 'w2', user_id: USER, logged_at: clientDay, weight: 59.5, unit: 'kg' }]);

    await getAdaptiveTDEE(undefined, undefined, clientDay);

    const call = (estimateIntervalTDEE as jest.Mock).mock.calls[0][0];
    expect(call.now).toBe(clientDay);
    expect(call.weighIns.map((w: { date: string }) => w.date)).toContain(clientDay);
  });

  it('defaults to the server day when no local date is passed', async () => {
    await getAdaptiveTDEE();
    expect((estimateIntervalTDEE as jest.Mock).mock.calls[0][0].now).toBe(today());
  });
});
