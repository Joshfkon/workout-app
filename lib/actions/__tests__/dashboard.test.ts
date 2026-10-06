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
      deload_week: 4,
      program_data: null,
      exercise_overrides: null,
      generated_with_enhanced_mode: false,
      created_at: '2026-10-01T00:00:00Z',
    };

    const mockSelect = jest.fn();
    const mockEq = jest.fn();
    const mockOr = jest.fn();
    const mockOrder = jest.fn();

    // First call: mesocycle query with .or()
    mockSelect.mockReturnValueOnce({
      eq: mockEq,
    });
    mockEq.mockReturnValueOnce({
      or: mockOr,
    });
    mockOr.mockReturnValueOnce({
      order: mockOrder,
    });
    mockOrder.mockResolvedValueOnce({
      data: [mockMesocycle],
      error: null,
    });

    // Second call: sessions query
    mockSelect.mockReturnValueOnce({
      eq: jest.fn().mockResolvedValueOnce({
        data: [{ id: 'sess-1', planned_date: '2026-10-06', state: 'planned', completed_at: null }],
        error: null,
      }),
    });

    // Third call: exercise_blocks query for today's workout
    mockSelect.mockReturnValueOnce({
      eq: jest.fn().mockResolvedValueOnce({
        data: [
          { id: 'block-1', target_sets: 3, set_logs: [] },
          { id: 'block-2', target_sets: 3, set_logs: [] },
        ],
        error: null,
      }),
    });

    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: mockSelect,
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    const result = await fetchMesocycleData('user-123');

    expect(result.mesocycle).not.toBeNull();
    expect(result.mesocycle?.currentWeek).toBe(2); // Database value, not 5 from date math
    expect(result.mesocycle?.name).toBe('Arnold');
  });

  it('selects current_week from the database', async () => {
    const mockSelect = jest.fn();
    const mockEq = jest.fn();
    const mockOr = jest.fn();
    const mockOrder = jest.fn();

    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      or: mockOr,
    });
    mockOr.mockReturnValue({
      order: mockOrder,
    });
    mockOrder.mockResolvedValue({
      data: [],
      error: null,
    });

    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: mockSelect,
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    await fetchMesocycleData('user-123');

    // Verify the select includes current_week and created_at
    expect(mockSupabase.from).toHaveBeenCalledWith('mesocycles');
    const selectArg = mockSelect.mock.calls[0][0];
    expect(selectArg).toContain('current_week');
    expect(selectArg).toContain('created_at');
  });

  it('returns null when no active mesocycle exists', async () => {
    const mockSelect = jest.fn();
    const mockEq = jest.fn();
    const mockOr = jest.fn();
    const mockOrder = jest.fn();

    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      or: mockOr,
    });
    mockOr.mockReturnValue({
      order: mockOrder,
    });
    mockOrder.mockResolvedValue({
      data: [],
      error: null,
    });

    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: mockSelect,
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    const result = await fetchMesocycleData('user-123');

    expect(result.mesocycle).toBeNull();
    expect(result.todaysWorkout).toBeNull();
  });

  it('picks the newest mesocycle when user has both is_active=true and state=active rows', async () => {
    // Simulates David's case: older Upper/Lower with state='active', newer Arnold with is_active=true
    const olderMeso = {
      id: 'meso-old',
      name: 'Upper/Lower',
      start_date: '2026-09-01',
      current_week: 2,
      total_weeks: 6,
      split_type: 'Upper/Lower',
      days_per_week: 4,
      preferred_workout_days: [1, 2, 4, 5],
      schedule_mode: 'fixed_days',
      training_interval_days: null,
      sessions_per_day: 1,
      state: 'active',
      is_active: false,
      deload_week: 6,
      program_data: null,
      exercise_overrides: null,
      generated_with_enhanced_mode: false,
      created_at: '2026-09-01T00:00:00Z',
    };

    const newerMeso = {
      id: 'meso-new',
      name: 'Arnold Split',
      start_date: '2026-09-20',
      current_week: 1,
      total_weeks: 5,
      split_type: 'Arnold Split',
      days_per_week: 6,
      preferred_workout_days: [1, 2, 3, 4, 5, 6],
      schedule_mode: 'fixed_days',
      training_interval_days: null,
      sessions_per_day: 1,
      state: 'planned',
      is_active: true,
      deload_week: 4,
      program_data: null,
      exercise_overrides: null,
      generated_with_enhanced_mode: false,
      created_at: '2026-09-20T00:00:00Z',
    };

    const mockSelect = jest.fn();
    const mockEq = jest.fn();
    const mockOr = jest.fn();
    const mockOrder = jest.fn();

    // First call: mesocycle query returns BOTH, ordered by created_at DESC
    mockSelect.mockReturnValueOnce({
      eq: mockEq,
    });
    mockEq.mockReturnValueOnce({
      or: mockOr,
    });
    mockOr.mockReturnValueOnce({
      order: mockOrder,
    });
    mockOrder.mockResolvedValueOnce({
      data: [newerMeso, olderMeso], // Newer first
      error: null,
    });

    // Second call: sessions query for the newer meso
    mockSelect.mockReturnValueOnce({
      eq: jest.fn().mockResolvedValueOnce({
        data: [],
        error: null,
      }),
    });

    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        select: mockSelect,
      }),
    };

    mockCreateClient.mockResolvedValue(mockSupabase);

    const result = await fetchMesocycleData('user-123');

    expect(result.mesocycle).not.toBeNull();
    expect(result.mesocycle?.name).toBe('Arnold Split'); // Picks the newer one
    expect(result.mesocycle?.id).toBe('meso-new');
  });
});
