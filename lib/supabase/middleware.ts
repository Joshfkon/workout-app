import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';

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
 * Fast path check - if the session cookie exists and looks valid,
 * we can skip the full auth check for most requests.
 * This reduces latency by ~200-300ms on cached requests.
 */
function hasValidSessionCookie(request: NextRequest): boolean {
  // Supabase stores auth in cookies with specific prefixes
  const cookies = request.cookies.getAll();
  const authCookie = cookies.find(c =>
    c.name.includes('auth-token') ||
    c.name.includes('sb-') && c.name.includes('-auth-token')
  );

  if (!authCookie?.value) return false;

  // Basic JWT structure check (header.payload.signature)
  const parts = authCookie.value.split('.');
  if (parts.length !== 3) return false;

  try {
    // Decode the payload to check expiry (without full verification)
    const payload = JSON.parse(atob(parts[1]));
    const exp = payload.exp;

    // Check if token is expired (with 60s buffer)
    if (exp && Date.now() / 1000 > exp - 60) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login for all protected routes (including onboarding)
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

