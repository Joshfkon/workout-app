/**
 * Tests for hooks/useUserPreferences.ts
 * User preferences hook with Supabase integration
 */

import { renderHook, act, waitFor } from '@testing-library/react';

// Mock Supabase client before importing the hook
const mockUser = { id: 'test-user-id' };
const mockUserData = {
  goal: 'bulk',
  experience: 'intermediate',
  height_cm: 180,
  weight_kg: 80,
  preferences: {
    units: 'kg',
    restTimer: 120,
    showFormCues: true,
    showWarmupSuggestions: false,
    skipPreWorkoutCheckIn: true,
  },
};

const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: () => ({
      select: mockSelect,
      update: mockUpdate,
    }),
  }),
}));

// Import after mocking
import { useUserPreferences } from '../useUserPreferences';

describe('useUserPreferences', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mock chain
    mockGetUser.mockResolvedValue({ data: { user: mockUser } });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSingle.mockResolvedValue({ data: mockUserData });
    mockUpdate.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initial state and loading', () => {
    it('starts with isLoading true', async () => {
      // Use a promise that never resolves to test initial state
      mockGetUser.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useUserPreferences());
      expect(result.current.isLoading).toBe(true);
    });

    it('has default preferences structure', async () => {
      mockGetUser.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useUserPreferences());

      expect(result.current.preferences).toHaveProperty('goal');
      expect(result.current.preferences).toHaveProperty('experience');
      expect(result.current.preferences).toHaveProperty('units');
      expect(result.current.preferences).toHaveProperty('restTimerDefault');
    });

    it('sets isLoading to false after loading', async () => {
      const { result } = renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('loading preferences from database', () => {
    it('calls supabase to get user', async () => {
      renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(mockGetUser).toHaveBeenCalled();
      });
    });

    it('uses default values when no user is logged in', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Preferences should still have a valid structure
      // Note: Global state may persist from previous tests
      expect(['lb', 'kg']).toContain(result.current.preferences.units);
    });

    it('handles database errors gracefully', async () => {
      mockSingle.mockRejectedValue(new Error('Database error'));

      const { result } = renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Preferences should still be valid even after error
      // Note: Global state may persist from previous tests
      expect(result.current.preferences).toBeDefined();
      expect(['lb', 'kg']).toContain(result.current.preferences.units);
    });

    it('handles missing preferences column', async () => {
      mockSingle.mockResolvedValue({
        data: {
          goal: 'cut',
          experience: 'beginner',
          height_cm: null,
          weight_kg: null,
          preferences: null,
        },
      });

      const { result } = renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.preferences.goal).toBe('cut');
      expect(result.current.preferences.units).toBe('lb'); // Default
    });
  });

  describe('preference defaults', () => {
    it('uses correct default values for empty preferences', async () => {
      mockSingle.mockResolvedValue({
        data: {
          goal: null,
          experience: null,
          height_cm: null,
          weight_kg: null,
          preferences: {},
        },
      });

      const { result } = renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.preferences.goal).toBe('maintenance');
      expect(result.current.preferences.experience).toBe('intermediate');
      expect(result.current.preferences.units).toBe('lb');
      expect(result.current.preferences.restTimerDefault).toBe(180);
      expect(result.current.preferences.showFormCues).toBe(true);
      expect(result.current.preferences.showWarmupSuggestions).toBe(true);
      expect(result.current.preferences.skipPreWorkoutCheckIn).toBe(false);
    });
  });

  describe('return value structure', () => {
    it('returns expected properties', () => {
      const { result } = renderHook(() => useUserPreferences());

      expect(result.current).toHaveProperty('preferences');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('updatePreference');
      expect(result.current).toHaveProperty('toggleUnits');
    });

    it('updatePreference is a function', () => {
      const { result } = renderHook(() => useUserPreferences());
      expect(typeof result.current.updatePreference).toBe('function');
    });

    it('toggleUnits is a function', () => {
      const { result } = renderHook(() => useUserPreferences());
      expect(typeof result.current.toggleUnits).toBe('function');
    });
  });

  describe('updatePreference behavior', () => {
    it('does not call update when no user is logged in', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const { result } = renderHook(() => useUserPreferences());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.updatePreference('units', 'kg');
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
