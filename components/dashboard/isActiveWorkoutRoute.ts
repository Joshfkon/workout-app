/**
 * isActiveWorkoutRoute.ts
 *
 * Shared helper to detect active workout routes where the app header and mobile
 * menu button should be hidden (workout page has its own back button).
 */

export function isActiveWorkoutRoute(pathname: string | null): boolean {
  return pathname?.includes('/dashboard/workout/') ?? false;
}
