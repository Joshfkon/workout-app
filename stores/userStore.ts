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

/** The `users` columns the store is built from (see {@link userFromRow}). */
export const USER_STORE_ROW_SELECT =
  'id, email, created_at, goal, experience, enhanced_athlete_mode, preferences, volume_landmarks';

export interface UserStoreRow {
  id: string;
  email?: string | null;
  created_at?: string | null;
  goal?: string | null;
  experience?: string | null;
  enhanced_athlete_mode?: boolean | null;
  preferences?: unknown;
  volume_landmarks?: unknown;
}

/**
 * Map a `users` row onto the store's `User`.
 *
 * `users.preferences` is free-form JSONB written by Settings /
 * useUserPreferences under its own key names (notably `restTimer`, not
 * `restTimerDefault`), so every field is read defensively and falls back to
 * the same defaults those writers use — `units` defaults to 'lb', matching
 * `useUserPreferences`, so the two sources can never disagree for a user who
 * hasn't chosen. Custom volume landmarks are kept only when the row has some;
 * an empty object means "use the experience defaults".
 */
export function userFromRow(row: UserStoreRow): User {
  const prefs =
    row.preferences && typeof row.preferences === 'object'
      ? (row.preferences as Record<string, unknown>)
      : {};
  const experience: Experience =
    row.experience === 'novice' || row.experience === 'advanced' ? row.experience : 'intermediate';
  const landmarks =
    row.volume_landmarks && typeof row.volume_landmarks === 'object'
      ? (row.volume_landmarks as Record<string, VolumeLandmarks>)
      : {};
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;

  return {
    id: row.id,
    email: row.email ?? '',
    createdAt: row.created_at ?? '',
    goal: ((row.goal as Goal | null) ?? 'maintenance') as Goal,
    experience,
    enhancedAthleteMode: row.enhanced_athlete_mode === true,
    preferences: {
      // Unknown keys (theme, landmarkVersion, body-hub settings, …) ride
      // along untouched; readLandmarkVersion() reads one of them.
      ...(prefs as Partial<UserPreferences>),
      units: prefs.units === 'kg' ? 'kg' : 'lb',
      restTimerDefault:
        typeof prefs.restTimer === 'number' && prefs.restTimer > 0
          ? prefs.restTimer
          : DEFAULT_USER_PREFERENCES.restTimerDefault,
      showFormCues: bool(prefs.showFormCues, true),
      showWarmupSuggestions: bool(prefs.showWarmupSuggestions, true),
      prioritizeHypertrophy: bool(prefs.prioritizeHypertrophy, true),
      skipPreWorkoutCheckIn: bool(prefs.skipPreWorkoutCheckIn, false),
    },
    volumeLandmarks: landmarks,
  };
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
      // The persisted user is applied AFTER mount (UserStoreHydrator calls
      // persist.rehydrate()), not at module load: localStorage is read
      // synchronously on the client only, so auto-hydrating made the first
      // client render differ from the server HTML (hydration mismatch) for
      // every component that renders a store-derived value.
      skipHydration: true,
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

