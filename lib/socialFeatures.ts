/**
 * Community / social features (activity feed, discover & shared workouts,
 * public profiles, follows, user search, leaderboards, comments, reactions)
 * are HIDDEN in the app.
 *
 * Why: user-generated content that users share with each other brings in App
 * Store Guideline 1.2 (reporting, blocking, moderation, filtering). The app
 * ships without it for now.
 *
 * How it is hidden (reversible — the code, tables and data are all kept):
 * - `lib/supabase/middleware.ts` redirects every route below with
 *   `hiddenSocialRedirect`, so typed URLs, `hypertrack://` deep links and old
 *   notifications all land on /dashboard (or the next onboarding step).
 * - Each entry point (More page, Sidebar, the workout page's "Post to your
 *   feed", onboarding's username step) checks `SOCIAL_FEATURES_ENABLED`.
 *
 * To restore: set `SOCIAL_FEATURES_ENABLED = true`. Before shipping that,
 * the app needs Guideline 1.2 tooling (report, block, filter, moderation).
 */
export const SOCIAL_FEATURES_ENABLED = false;

/** Route prefixes that only exist for the social features. */
export const SOCIAL_ROUTE_PREFIXES = [
  '/dashboard/feed',
  '/dashboard/discover',
  '/dashboard/leaderboards',
  // Public profile: username, avatar, bio, followers, shared workouts.
  // (Body stats, injuries and preferences live in Settings, not here.)
  '/dashboard/profile',
  // "Find people" — user search.
  '/dashboard/search',
] as const;

/** Onboarding's "Set up your profile" (public username) step. */
export const SOCIAL_ONBOARDING_PROFILE_ROUTE = '/onboarding/profile';
/** Where that step went next. */
export const ONBOARDING_AFTER_PROFILE_ROUTE = '/onboarding/enhanced';

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Where to send a request for a hidden social route, or null when the path
 * isn't one (or the features are enabled). Only the pathname is returned; the
 * caller keeps the query string (onboarding's `?session=` must survive).
 */
export function hiddenSocialRedirect(
  pathname: string,
  enabled: boolean = SOCIAL_FEATURES_ENABLED
): string | null {
  if (enabled) return null;
  if (matchesPrefix(pathname, SOCIAL_ONBOARDING_PROFILE_ROUTE)) {
    return ONBOARDING_AFTER_PROFILE_ROUTE;
  }
  if (SOCIAL_ROUTE_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return '/dashboard';
  }
  return null;
}
