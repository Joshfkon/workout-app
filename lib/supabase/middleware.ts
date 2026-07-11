import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';
import { isSessionCookieValid, hasAuthTokenCookie } from './sessionCookie';
import { isRetryableAuthError } from './authState';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Public routes that don't require auth - checked before any auth validation
const PUBLIC_ROUTES = ['/', '/login', '/register', '/learn', '/privacy', '/terms', '/auth/callback', '/forgot-password', '/reset-password', '/opengraph-image', '/twitter-image', '/api/og'];

/**
 * Check if a route is public (no auth required)
 */
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );
}

/**
 * Fast path check - if a non-expired Supabase session cookie is present, skip
 * the full server-side auth check for most requests (saves a ~200-300ms
 * round-trip AND, crucially, avoids triggering a token refresh on every
 * navigation — concurrent refreshes from Next's link prefetching race on the
 * single-use refresh token and randomly log users out).
 *
 * The parsing lives in ./sessionCookie (Supabase cookies are base64-encoded
 * JSON, possibly chunked — not raw JWTs). It fails closed: anything it can't
 * confidently validate returns false and we fall through to the full check.
 */
function hasValidSessionCookie(request: NextRequest): boolean {
  return isSessionCookieValid(request.cookies.getAll());
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Fast path: public routes don't need any auth check
  if (isPublicRoute(pathname)) {
    return NextResponse.next({ request });
  }

  // Fast path: if we have a valid-looking session cookie and this isn't
  // a sensitive operation, skip the full Supabase auth check
  const isOnboardingRoute = pathname.startsWith('/onboarding');
  const isSensitiveRoute = pathname.startsWith('/api/') ||
                           pathname.includes('/settings') ||
                           pathname.includes('/checkout');

  // For non-sensitive routes, trust valid session cookies
  // This avoids a ~300ms round-trip to Supabase on every page navigation
  if (!isSensitiveRoute && hasValidSessionCookie(request)) {
    return NextResponse.next({ request });
  }

  // Full auth check for:
  // - Routes without valid session cookie
  // - Sensitive routes (always verify)
  // - Onboarding routes
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  let user: { id: string } | null = null;
  let getUserError: unknown = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    getUserError = result.error;
  } catch (err) {
    // getUser threw (network / failed client init) — treated as a transient
    // failure below, never as a logout.
    getUserError = err;
  }

  if (!user) {
    // Distinguish a genuinely signed-out request from a transient failure to
    // VERIFY the session. getUser() returns a null user on any failure —
    // a dropped connection, a 5xx from the auth server, a refresh-token race —
    // not just a real logout. Bouncing those to /login destroys a valid
    // session. So when an auth cookie is still present and the failure looks
    // transient, let the request through (with any refreshed cookies) instead
    // of logging the user out; the page's own guards handle a truly dead
    // session. Only a request with no session cookie, or one the server
    // actively rejected, is sent to /login.
    const sessionCookiePresent = hasAuthTokenCookie(request.cookies.getAll());
    if (sessionCookiePresent && isRetryableAuthError(getUserError)) {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

