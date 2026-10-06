/**
 * App Store Review Prompt Integration
 *
 * Requests Apple's native in-app review prompt (SKStoreReviewController) at
 * happy moments after workouts are successfully saved. iOS only (Capacitor);
 * silent no-op on web.
 *
 * Behavior:
 * - First request after the 3rd finished workout
 * - Native iOS only (Capacitor plugin); silent no-op on web or when unavailable
 * - Our cooldown: at most once every 90 days, not again for the same app version
 * - Small delay (500ms) after finish so it doesn't collide with haptics/transitions
 * - Never blocks or delays the actual save
 *
 * Apple's own rate limiting is layered on top of our cooldown, so the prompt
 * may not appear even when we request it.
 */

import { isNativePlatform } from './capacitor-stub';

// Capacitor App Review plugin - optional, use try-catch for web builds
let AppReview: any;

try {
  AppReview = require('@capacitor-community/app-review').AppReview;
} catch (e) {
  // Plugin not installed - provide no-op fallback
  AppReview = {
    requestReview: async () => {},
  };
}

// LocalStorage keys for persistence
const STORAGE_KEY_COUNTER = 'hypertrack:review:finishedCount';
const STORAGE_KEY_LAST_PROMPT = 'hypertrack:review:lastPrompt';
const STORAGE_KEY_LAST_VERSION = 'hypertrack:review:lastVersion';

// Configuration
const WORKOUTS_BEFORE_FIRST_PROMPT = 3;
const COOLDOWN_DAYS = 90;
const PROMPT_DELAY_MS = 500;

/**
 * Get the current app version. Returns empty string if unavailable (web).
 */
function getAppVersion(): string {
  if (typeof window === 'undefined') return '';
  // In a real Capacitor app, you might get this from @capacitor/app or package.json
  // For now, use a simple version string. This could be enhanced to read from
  // the native app info if needed.
  return '1.0.0'; // TODO: Could read from capacitor App.getInfo() if needed
}

/**
 * Get the number of successfully finished workouts from localStorage.
 */
function getFinishedWorkoutCount(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_COUNTER);
    return stored ? parseInt(stored, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Increment the finished workout counter in localStorage.
 */
function incrementFinishedWorkoutCount(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const current = getFinishedWorkoutCount();
    const next = current + 1;
    window.localStorage.setItem(STORAGE_KEY_COUNTER, next.toString());
    return next;
  } catch {
    return 0;
  }
}

/**
 * Get the timestamp of the last review prompt request (ms since epoch).
 * Returns 0 if never prompted.
 */
function getLastPromptTimestamp(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_LAST_PROMPT);
    return stored ? parseInt(stored, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Save the current timestamp as the last prompt time.
 */
function setLastPromptTimestamp(timestamp: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_LAST_PROMPT, timestamp.toString());
  } catch {
    // Best-effort
  }
}

/**
 * Get the app version that last showed a review prompt.
 */
function getLastPromptVersion(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY_LAST_VERSION) || '';
  } catch {
    return '';
  }
}

/**
 * Save the current app version as the last version that prompted.
 */
function setLastPromptVersion(version: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_LAST_VERSION, version);
  } catch {
    // Best-effort
  }
}

/**
 * Check if we should request a review based on:
 * 1. Platform (native iOS only)
 * 2. Workout count threshold (3rd workout)
 * 3. Cooldown period (90 days since last prompt)
 * 4. App version change (not again for the same version)
 */
export function shouldRequestReview(): boolean {
  // Only on native iOS
  if (!isNativePlatform()) return false;

  const count = getFinishedWorkoutCount();
  
  // Must have at least the threshold number of completed workouts
  if (count < WORKOUTS_BEFORE_FIRST_PROMPT) return false;

  const now = Date.now();
  const lastPrompt = getLastPromptTimestamp();
  
  // First time prompting
  if (lastPrompt === 0) return true;

  // Check cooldown period (90 days)
  const daysSinceLastPrompt = (now - lastPrompt) / (1000 * 60 * 60 * 24);
  if (daysSinceLastPrompt < COOLDOWN_DAYS) return false;

  // Check if app version has changed since last prompt
  const currentVersion = getAppVersion();
  const lastVersion = getLastPromptVersion();
  
  // If we've already prompted for this version, don't prompt again
  // (even if cooldown has passed)
  if (currentVersion && lastVersion === currentVersion) return false;

  return true;
}

/**
 * Request the native in-app review prompt. Call this after a successful
 * workout save. Increments the counter, checks eligibility, and requests
 * the prompt if appropriate.
 *
 * - Silent no-op on web or when the plugin is unavailable
 * - Never throws or blocks the caller
 * - Waits PROMPT_DELAY_MS before requesting to avoid collision with haptics
 *
 * @returns A promise that resolves once the request completes (or is skipped)
 */
export async function requestReviewAfterWorkout(): Promise<void> {
  // Increment counter first (counts every successful save)
  const newCount = incrementFinishedWorkoutCount();

  // Check if we should request
  if (!shouldRequestReview()) {
    return;
  }

  // Wait briefly so the prompt doesn't collide with the success haptic
  // or the navigation transition
  await new Promise((resolve) => setTimeout(resolve, PROMPT_DELAY_MS));

  // Request the native review prompt
  try {
    await AppReview.requestReview();
    
    // Record that we prompted (regardless of whether Apple actually showed it)
    setLastPromptTimestamp(Date.now());
    setLastPromptVersion(getAppVersion());
  } catch (error) {
    // Plugin unavailable or request failed - silent no-op
    console.debug('[AppReview] Request failed (expected on web):', error);
  }
}

/**
 * Reset the review prompt state. Useful for testing or user preference resets.
 * DO NOT call this in production code unless explicitly requested by the user.
 */
export function resetReviewPromptState(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_COUNTER);
    window.localStorage.removeItem(STORAGE_KEY_LAST_PROMPT);
    window.localStorage.removeItem(STORAGE_KEY_LAST_VERSION);
  } catch {
    // Best-effort
  }
}

// Export for testing
export const testHelpers = {
  getFinishedWorkoutCount,
  getLastPromptTimestamp,
  getLastPromptVersion,
  incrementFinishedWorkoutCount,
  setLastPromptTimestamp,
  setLastPromptVersion,
  WORKOUTS_BEFORE_FIRST_PROMPT,
  COOLDOWN_DAYS,
};
