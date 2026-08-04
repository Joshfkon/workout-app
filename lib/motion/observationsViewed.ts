/**
 * Session-scoped tracker for whether the user has expanded any motion
 * Observations block during a workout. Consumed only when a capture is
 * persisted (prior_observations_viewed_this_session) so the future RIR-fit
 * dataset can flag label contamination. sessionStorage keyed by workout
 * session id, memory fallback when storage is unavailable.
 */

const memoryFallback = new Set<string>();

function key(workoutSessionId: string): string {
  return `motion-observations-viewed:${workoutSessionId}`;
}

export function markObservationsViewed(workoutSessionId: string): void {
  memoryFallback.add(workoutSessionId);
  try {
    sessionStorage.setItem(key(workoutSessionId), '1');
  } catch {
    // Memory fallback already recorded it.
  }
}

export function observationsViewedThisSession(workoutSessionId: string): boolean {
  if (memoryFallback.has(workoutSessionId)) return true;
  try {
    return sessionStorage.getItem(key(workoutSessionId)) === '1';
  } catch {
    return false;
  }
}
