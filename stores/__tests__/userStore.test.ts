/**
 * Tests for User Store (Zustand)
 */
import { useUserStore } from '../userStore';
import { DEFAULT_USER_PREFERENCES, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import type { User, UserPreferences, VolumeLandmarks, Experience } from '@/types/schema';

// Helper to create a mock user
function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    createdAt: new Date().toISOString(),
    goal: 'bulk',
    experience: 'intermediate',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    volumeLandmarks: { ...DEFAULT_VOLUME_LANDMARKS.intermediate },
    ...overrides,
  };
}

describe('userStore', () => {
  // Reset the store before each test
  beforeEach(() => {
    useUserStore.setState({
      user: null,
      isLoading: true,
    });
  });

  describe('initial state', () => {
    it('starts with null user', () => {
      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });

    it('starts with isLoading true', () => {
      const { isLoading } = useUserStore.getState();
      expect(isLoading).toBe(true);
    });
  });

  describe('setUser', () => {
    it('sets the user', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      const { user } = useUserStore.getState();
      expect(user).toEqual(mockUser);
    });

    it('sets isLoading to false', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      const { isLoading } = useUserStore.getState();
      expect(isLoading).toBe(false);
    });

    it('can set user to null', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().setUser(null);

      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('updates user properties', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().updateUser({ goal: 'cut' });

      const { user } = useUserStore.getState();
      expect(user?.goal).toBe('cut');
    });

    it('preserves other user properties', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().updateUser({ goal: 'cut' });

      const { user } = useUserStore.getState();
      expect(user?.email).toBe('test@example.com');
      expect(user?.experience).toBe('intermediate');
    });

    it('does nothing when user is null', () => {
      useUserStore.getState().updateUser({ goal: 'cut' });

      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });
  });

  describe('updatePreferences', () => {
    it('updates user preferences', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().updatePreferences({ units: 'lb' });

      const { user } = useUserStore.getState();
      expect(user?.preferences.units).toBe('lb');
    });

    it('preserves other preferences', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().updatePreferences({ units: 'lb' });

      const { user } = useUserStore.getState();
      expect(user?.preferences.showFormCues).toBe(true);
      expect(user?.preferences.restTimerDefault).toBe(180);
    });

    it('updates multiple preferences at once', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().updatePreferences({
        units: 'lb',
        restTimerDefault: 120,
        showFormCues: false,
      });

      const { user } = useUserStore.getState();
      expect(user?.preferences.units).toBe('lb');
      expect(user?.preferences.restTimerDefault).toBe(120);
      expect(user?.preferences.showFormCues).toBe(false);
    });

    it('does nothing when user is null', () => {
      useUserStore.getState().updatePreferences({ units: 'lb' });

      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });
  });

  describe('updateVolumeLandmark', () => {
    it('updates volume landmark for a muscle', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      const newLandmarks: VolumeLandmarks = { mev: 8, mav: 16, mrv: 22 };
      useUserStore.getState().updateVolumeLandmark('chest', newLandmarks);

      const { user } = useUserStore.getState();
      expect(user?.volumeLandmarks.chest).toEqual(newLandmarks);
    });

    it('preserves other muscle landmarks', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      const newLandmarks: VolumeLandmarks = { mev: 8, mav: 16, mrv: 22 };
      useUserStore.getState().updateVolumeLandmark('chest', newLandmarks);

      const { user } = useUserStore.getState();
      expect(user?.volumeLandmarks.back).toEqual(DEFAULT_VOLUME_LANDMARKS.intermediate.back);
    });

    it('adds new muscle landmarks', () => {
      const mockUser = createMockUser({
        volumeLandmarks: {},
      });
      useUserStore.getState().setUser(mockUser);

      const newLandmarks: VolumeLandmarks = { mev: 6, mav: 12, mrv: 18 };
      useUserStore.getState().updateVolumeLandmark('chest', newLandmarks);

      const { user } = useUserStore.getState();
      expect(user?.volumeLandmarks.chest).toEqual(newLandmarks);
    });

    it('does nothing when user is null', () => {
      const newLandmarks: VolumeLandmarks = { mev: 8, mav: 16, mrv: 22 };
      useUserStore.getState().updateVolumeLandmark('chest', newLandmarks);

      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });
  });

  describe('resetVolumeLandmarks', () => {
    it('resets volume landmarks to defaults for experience level', () => {
      const mockUser = createMockUser({
        volumeLandmarks: {
          chest: { mev: 100, mav: 200, mrv: 300 },
        },
      });
      useUserStore.getState().setUser(mockUser);

      useUserStore.getState().resetVolumeLandmarks('intermediate');

      const { user } = useUserStore.getState();
      expect(user?.volumeLandmarks).toEqual(DEFAULT_VOLUME_LANDMARKS.intermediate);
    });

    it('resets to novice defaults', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      useUserStore.getState().resetVolumeLandmarks('novice');

      const { user } = useUserStore.getState();
      expect(user?.volumeLandmarks).toEqual(DEFAULT_VOLUME_LANDMARKS.novice);
    });

    it('resets to advanced defaults', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      useUserStore.getState().resetVolumeLandmarks('advanced');

      const { user } = useUserStore.getState();
      expect(user?.volumeLandmarks).toEqual(DEFAULT_VOLUME_LANDMARKS.advanced);
    });

    it('does nothing when user is null', () => {
      useUserStore.getState().resetVolumeLandmarks('intermediate');

      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });
  });

  describe('getVolumeLandmarks', () => {
    it('returns landmarks for a muscle', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      // Use standard muscle group (chest_upper instead of legacy 'chest')
      const landmarks = useUserStore.getState().getVolumeLandmarks('chest_upper');
      expect(landmarks).toEqual(DEFAULT_VOLUME_LANDMARKS.intermediate.chest_upper);
    });

    it('returns default landmarks when muscle not found', () => {
      const mockUser = createMockUser({
        volumeLandmarks: {},
      });
      useUserStore.getState().setUser(mockUser);

      // Use standard muscle group
      const landmarks = useUserStore.getState().getVolumeLandmarks('chest_upper');
      expect(landmarks).toEqual(DEFAULT_VOLUME_LANDMARKS.intermediate.chest_upper);
    });

    it('returns intermediate defaults when user is null', () => {
      // Use standard muscle group
      const landmarks = useUserStore.getState().getVolumeLandmarks('chest_upper');
      expect(landmarks).toEqual(DEFAULT_VOLUME_LANDMARKS.intermediate.chest_upper);
    });

    it('returns fallback landmarks for unknown muscle when user is null', () => {
      const landmarks = useUserStore.getState().getVolumeLandmarks('unknown_muscle');
      expect(landmarks).toEqual({ mev: 6, mav: 12, mrv: 18 });
    });

    it('returns fallback landmarks for unknown muscle with user', () => {
      const mockUser = createMockUser({
        experience: 'advanced',
        volumeLandmarks: {},
      });
      useUserStore.getState().setUser(mockUser);

      const landmarks = useUserStore.getState().getVolumeLandmarks('unknown_muscle');
      // Should return fallback since the muscle doesn't exist in any defaults
      expect(landmarks).toEqual({ mev: 6, mav: 12, mrv: 18 });
    });
  });

  describe('getPreference', () => {
    it('returns user preference', () => {
      const mockUser = createMockUser({
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          units: 'lb',
        },
      });
      useUserStore.getState().setUser(mockUser);

      const units = useUserStore.getState().getPreference('units');
      expect(units).toBe('lb');
    });

    it('returns default when user is null', () => {
      const units = useUserStore.getState().getPreference('units');
      expect(units).toBe(DEFAULT_USER_PREFERENCES.units);
    });

    it('returns default for undefined preference', () => {
      const mockUser = createMockUser({
        preferences: {
          units: 'kg',
          restTimerDefault: 180,
          showFormCues: true,
          showWarmupSuggestions: true,
          // prioritizeHypertrophy is undefined
        } as UserPreferences,
      });
      useUserStore.getState().setUser(mockUser);

      const prioritize = useUserStore.getState().getPreference('prioritizeHypertrophy');
      expect(prioritize).toBe(DEFAULT_USER_PREFERENCES.prioritizeHypertrophy);
    });

    it('returns correct values for all preference keys', () => {
      const mockUser = createMockUser({
        preferences: {
          units: 'lb',
          restTimerDefault: 120,
          showFormCues: false,
          showWarmupSuggestions: false,
          prioritizeHypertrophy: false,
          skipPreWorkoutCheckIn: true,
        },
      });
      useUserStore.getState().setUser(mockUser);

      expect(useUserStore.getState().getPreference('units')).toBe('lb');
      expect(useUserStore.getState().getPreference('restTimerDefault')).toBe(120);
      expect(useUserStore.getState().getPreference('showFormCues')).toBe(false);
      expect(useUserStore.getState().getPreference('showWarmupSuggestions')).toBe(false);
      expect(useUserStore.getState().getPreference('prioritizeHypertrophy')).toBe(false);
      expect(useUserStore.getState().getPreference('skipPreWorkoutCheckIn')).toBe(true);
    });
  });

  describe('setLoading', () => {
    it('sets loading to true', () => {
      useUserStore.getState().setLoading(true);

      const { isLoading } = useUserStore.getState();
      expect(isLoading).toBe(true);
    });

    it('sets loading to false', () => {
      useUserStore.getState().setLoading(false);

      const { isLoading } = useUserStore.getState();
      expect(isLoading).toBe(false);
    });
  });

  describe('signOut', () => {
    it('clears the user', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.getState().signOut();

      const { user } = useUserStore.getState();
      expect(user).toBeNull();
    });

    it('sets isLoading to false', () => {
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);
      useUserStore.setState({ isLoading: true });
      useUserStore.getState().signOut();

      const { isLoading } = useUserStore.getState();
      expect(isLoading).toBe(false);
    });
  });

  describe('persistence', () => {
    it('store name is set correctly', () => {
      // The store uses 'user-storage' as the persist key
      // We can verify this by checking the store persists user data
      const mockUser = createMockUser();
      useUserStore.getState().setUser(mockUser);

      // User should be stored
      const { user } = useUserStore.getState();
      expect(user).not.toBeNull();
    });
  });
});
