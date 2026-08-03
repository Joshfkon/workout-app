import { applyRecoveryProfileToLandmarks } from '@/services/volumeBands';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  User,
  UserPreferences,
  VolumeLandmarks,
  Goal,
  Experience,
  StandardMuscleGroup,
} from '@/types/schema';
import {
  DEFAULT_USER_PREFERENCES,
  DEFAULT_VOLUME_LANDMARKS,
  isStandardMuscle,
} from '@/types/schema';
import {
  migrateStoredLandmarks,
  readLandmarkVersion,
} from '@/lib/migrations/volume-landmarks';

interface UserState {
  // User data
  user: User | null;
  isLoading: boolean;
  
  // Actions
  setUser: (user: User | null) => void;
  updateUser: (data: Partial<User>) => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => void;
  updateVolumeLandmark: (muscle: string, landmarks: VolumeLandmarks) => void;
  resetVolumeLandmarks: (experience: Experience) => void;
  
  // Getters
  getVolumeLandmarks: (muscle: string) => VolumeLandmarks;
  getPreference: <K extends keyof UserPreferences>(key: K) => UserPreferences[K];
  
  // Auth state
  setLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,

      setUser: (user) => {
        set({ user, isLoading: false });
      },

      updateUser: (data) => {
        const { user } = get();
        if (!user) return;
        set({ user: { ...user, ...data } });
      },

      updatePreferences: (prefs) => {
        const { user } = get();
        if (!user) return;
        set({
          user: {
            ...user,
            preferences: { ...user.preferences, ...prefs },
          },
        });
      },

      updateVolumeLandmark: (muscle, landmarks) => {
        const { user } = get();
        if (!user) return;
        set({
          user: {
            ...user,
            volumeLandmarks: {
              ...user.volumeLandmarks,
              [muscle]: landmarks,
            },
          },
        });
      },

      resetVolumeLandmarks: (experience) => {
        const { user } = get();
        if (!user) return;
        set({
          user: {
            ...user,
            volumeLandmarks: DEFAULT_VOLUME_LANDMARKS[experience],
          },
        });
      },

      getVolumeLandmarks: (muscle) => {
        const { user } = get();
        const defaultFallback = { mev: 6, mav: 12, mrv: 18 };
        // Use type assertion for string key access
        const defaultLandmarks = DEFAULT_VOLUME_LANDMARKS.intermediate as Record<string, VolumeLandmarks>;
        if (!user) {
          return defaultLandmarks[muscle] || defaultFallback;
        }
        const userExperienceLandmarks = DEFAULT_VOLUME_LANDMARKS[user.experience] as Record<string, VolumeLandmarks>;
        const stored = user.volumeLandmarks[muscle as StandardMuscleGroup];
        // Scalar-field landmark migration on read: a stored value still equal
        // to its v1 default moves to the new default; a customized value is
        // preserved. Skipped once preferences carry the current
        // landmarkVersion. See lib/migrations/volume-landmarks.
        const migrated =
          stored && isStandardMuscle(muscle)
            ? migrateStoredLandmarks(
                { [muscle]: stored },
                user.experience,
                readLandmarkVersion(
                  user.preferences as unknown as Record<string, unknown>
                )
              ).landmarks[muscle]
            : stored;
        const base =
          (migrated as VolumeLandmarks | undefined) ||
          userExperienceLandmarks[muscle] ||
          defaultFallback;
        // Enhanced Athlete Mode scales landmarks through the SINGLE profile
        // derivation (per-muscle-tiered MRV; MEV never rises).
        return applyRecoveryProfileToLandmarks(base, muscle as StandardMuscleGroup, {
          recoveryProfile: user.enhancedAthleteMode ? 'enhanced' : 'standard',
        });
      },

      getPreference: (key) => {
        const { user } = get();
        if (!user) return DEFAULT_USER_PREFERENCES[key];
        return user.preferences[key] ?? DEFAULT_USER_PREFERENCES[key];
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      signOut: () => {
        // Clear in-memory state. The persist middleware writes this through,
        // so persisted `user` becomes null. We also explicitly clear the
        // persisted storage to remove any stale/legacy keys that partialize
        // might not overwrite.
        set({ user: null, isLoading: false });
        void useUserStore.persist.clearStorage();
      },
    }),
    {
      name: 'user-storage',
      version: 1,
      partialize: (state) => ({
        user: state.user,
      }),
      // Migrate stale persisted shapes forward. A pre-versioned (version 0)
      // User object may not match the current schema, so we drop it and let
      // the app re-hydrate the user from the server/session on next load.
      migrate: (persistedState, version) => {
        if (version === 0) {
          return { user: null };
        }
        return persistedState as { user: User | null };
      },
    }
  )
);

