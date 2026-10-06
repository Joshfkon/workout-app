/**
 * Tests for dashboard server actions, specifically mesocycle data fetching.
 *
 * Regression: Home and Train pages showed different mesocycle weeks because
 * Home computed currentWeek from start_date (naive date math) while Train
 * used the database's current_week column (managed by weekly rollover logic).
 * This test verifies fetchMesocycleData now uses the database value.
 */

jest.mock('@/lib/supabase/server', () => ({
  createUntypedServerClient: jest.fn(),
}));

import { fetchMesocycleData } from '@/lib/actions/dashboard';
import { createUntypedServerClient } from '@/lib/supabase/server';

const mockCreateClient = createUntypedServerClient as jest.Mock;

describe('fetchMesocycleData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses database current_week value instead of computing from start_date', async () => {
    const today = new Date('2026-10-06');
    // Mesocycle started 35 days ago (5 weeks by naive date math)
    const startDate = new Date('2026-09-01').toISOString();
    
    const mockMesocycle = {
      id: 'meso-1',
      name: 'Arnold',
      start_date: startDate,
      current_week: 2, // Database says week 2 (managed by rollover logic)
      total_weeks: 5,
      split_type: 'Arnold Split',
      days_per_week: 5,
      preferred_workout_days: [1, 2, 3, 4, 5],
      schedule_mode: 'fixed_days',
      training_interval_days: null,
      sessions_per_day: 1,
      state: 'active',
      is_active: true,
      workout_sessions: [
        { id: 'sess-1', planned_date: '2026-10-06', state: 'planned', completed_at: null }
      ],
    };

    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [mockMesocycle],
              error: null,
            }),
          }),
        }),
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    const result = await fetchMesocycleData('user-123');

    expect(result.mesocycle).not.toBeNull();
    expect(result.mesocycle?.currentWeek).toBe(2); // Database value, not 5 from date math
    expect(result.mesocycle?.name).toBe('Arnold');
  });

  it('selects current_week from the database', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    await fetchMesocycleData('user-123');

    // Verify the select includes current_week
    expect(mockSupabase.from).toHaveBeenCalledWith('mesocycles');
    const selectArg = mockSupabase.from().select.mock.calls[0][0];
    expect(selectArg).toContain('current_week');
  });

  it('returns null when no active mesocycle exists', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    const result = await fetchMesocycleData('user-123');

    expect(result.mesocycle).toBeNull();
    expect(result.todaysWorkout).toBeNull();
  });
});
