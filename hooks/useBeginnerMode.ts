'use client';

import { useUserStore } from '@/stores/userStore';
import { resolveBeginnerMode } from '@/lib/beginnerMode';

/**
 * THE read point for beginner mode. Components never read
 * `preferences.beginnerMode` themselves: the stored choice wins, and with
 * none it follows experience (on for novices) — see lib/beginnerMode.
 *
 * Reads the user store (hydrated from users.preferences by
 * UserStoreHydrator; Settings updates it on save), so a change applies on
 * every mounted screen at once. Off while no user is loaded.
 */
export function useBeginnerMode(): boolean {
  return useUserStore((state) =>
    state.user
      ? resolveBeginnerMode(state.user.preferences.beginnerMode, state.user.experience)
      : false
  );
}
