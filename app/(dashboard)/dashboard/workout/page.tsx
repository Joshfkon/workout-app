import { redirect } from 'next/navigation';

/**
 * The old "Workouts" hub (a 3,000-line, 4-tab page) has been retired (P2-12).
 * Every capability it offered now lives in a dedicated route, so this index
 * route is just a redirect that keeps old links/bookmarks landing somewhere
 * sensible:
 *
 *   - Start a workout (ad-hoc / AI / mesocycle-day) → /dashboard/log
 *   - Plan, today's session & recovery              → /dashboard/mesocycle
 *   - Past workouts + repeat                         → /dashboard/history
 *   - Exercise library                              → /dashboard/exercises
 *   - Templates                                     → /dashboard/templates
 *
 * Retiring the hub also removed its duplicate `workout_sessions` INSERT paths,
 * leaving `getOrCreateTodaySession` (used by /dashboard/log) as the single
 * ad-hoc session-creation flow — the P0-1 concern the audit flagged.
 *
 * The active-session sub-routes (/workout/new, /workout/quick, /workout/[id])
 * are unaffected — this only replaces the hub index.
 */
export default function WorkoutHubRedirect() {
  redirect('/dashboard/log');
}
