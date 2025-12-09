import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  User,
  UserPreferences,
  VolumeLandmarks,
  Goal,
  Experience,
} from '@/types/schema';
import { DEFAULT_USER_PREFERENCES, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';

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
        if (!user) {
          return DEFAULT_VOLUME_LANDMARKS.intermediate[muscle] || { mev: 6, mav: 12, mrv: 18 };
        }
        return (
          user.volumeLandmarks[muscle] ||
          DEFAULT_VOLUME_LANDMARKS[user.experience][muscle] ||
          { mev: 6, mav: 12, mrv: 18 }
        );
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
        set({ user: null, isLoading: false });
      },
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({
        user: state.user,
      }),
    }
  )
);

