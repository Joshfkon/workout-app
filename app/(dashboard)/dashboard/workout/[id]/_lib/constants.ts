/**
 * Shared constants for workout session management.
 * Can be imported by both client and server code.
 */

/**
 * If the gap between the last logged set and "now" is at least this many
 * minutes, treat the session as abandoned and backdate the end time to the
 * last set's timestamp. Prevents inflated session durations when the user
 * forgets to hit save/finish.
 * 
 * Also used by the in-workout idle prompt (useIdleWorkoutPrompt hook) to
 * show "Still training?" after the same threshold.
 */
export const ABANDONED_SESSION_THRESHOLD_MINUTES = 20;
