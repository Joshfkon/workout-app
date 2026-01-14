# Load Performance Optimization Plan

## Executive Summary

The app currently has a 3-4 second white screen delay during initial load. This document analyzes the root causes and provides a prioritized plan to reduce perceived load time to under 1 second.

---

## Current Loading Timeline Analysis

### Measured Flow (Estimated Times)

| Phase | Duration | Cumulative | Notes |
|-------|----------|------------|-------|
| DNS + TCP + TLS | ~100ms | 100ms | Network overhead |
| Middleware auth check | ~300-500ms | 500ms | `supabase.auth.getUser()` in every request |
| HTML + CSS download | ~50ms | 550ms | Static splash appears |
| JS bundle download | ~500-800ms | 1.3s | Main bundle + chunks |
| React hydration | ~200-300ms | 1.6s | SplashProvider mounts |
| React splash min duration | 300ms | 1.9s | Hardcoded in SplashProvider |
| Supabase queries (11x) | ~800-1200ms | 3.1s | Dashboard data fetch |
| Splash fade out | ~300ms | 3.4s | Animation delay |

**Total: ~3-4 seconds**

---

## Root Causes

### 1. Hardcoded Splash Durations (High Impact)

**Files:** `components/providers/SplashProvider.tsx`, `components/ui/SplashScreen.tsx`

```typescript
// SplashProvider.tsx:82 - Minimum 300ms before splash can start hiding
const timer = setTimeout(() => setMinDurationPassed(true), 300);

// SplashProvider.tsx:107 - Additional 300ms delay before hiding
const hideTimer = setTimeout(() => {
  setShowSplash(false);
  // ...
}, 300);

// SplashScreen.tsx:131 - Duration prop defaults to 1500ms
<SplashScreen duration={1500} />
```

**Problem:** Even if the app is ready, users must wait 1500ms for the splash animation.

---

### 2. Dashboard Page Client-Side Data Fetching (High Impact)

**File:** `app/(dashboard)/dashboard/page.tsx`

The entire 1700-line dashboard is a `'use client'` component that fetches 11 queries after JavaScript loads:

```typescript
// Lines 442-524 - 11 parallel queries that MUST complete before showing content
const [
  userProfileResult,      // User goal
  mesocyclesResult,       // Training programs
  nutritionResult,        // Today's food
  targetsResult,          // Nutrition targets
  prefsResult,            // User preferences
  weightResult,           // Today's weight
  weightHistoryResult,    // 90-day weight history
  weeklyBlocksResult,     // Weekly volume data
  frequentDataResult,     // Frequent foods
  systemFoodsResult,      // Food database
  completedWorkoutsResult // Completed workouts count
] = await Promise.all([...]);
```

**Problem:** Content is blocked until ALL queries complete (~800-1200ms after JS loads).

---

### 3. Middleware Auth Check on Every Request (Medium Impact)

**File:** `lib/supabase/middleware.ts:39-41`

```typescript
const {
  data: { user },
} = await supabase.auth.getUser();
```

**Problem:** Every page navigation makes a server-side auth check, adding ~300-500ms latency.

---

### 4. Large Client Bundle (Medium Impact)

**Files:** Dashboard page imports

```typescript
// Heavy imports that increase bundle size:
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';  // Imports entire adaptive-volume module
import { STANDARD_MUSCLE_GROUPS, STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
```

Dynamic imports are used for some components (good), but the main page bundle is still large.

---

### 5. Google Fonts Blocking (Low Impact)

**File:** `app/layout.tsx:79-82`

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap"
/>
```

**Problem:** Font stylesheet is render-blocking; `display=swap` helps but doesn't eliminate FOUT.

---

### 6. Zustand Store Hydration (Low Impact)

**Files:** `stores/userStore.ts`, `stores/exerciseStore.ts`

Persisted stores must hydrate from localStorage before rendering can complete accurately.

---

## Optimization Plan

### Phase 1: Quick Wins (Est. Savings: 1-1.5s)

#### 1.1 Remove Hardcoded Splash Delays

**Impact:** -1000ms+
**Effort:** Low
**Risk:** Low

Change splash logic to hide immediately when app is ready instead of waiting for animation.

```typescript
// SplashProvider.tsx - Make splash duration dynamic
// Replace hardcoded 1500ms with "as soon as ready"
useEffect(() => {
  if (isAppReady && showSplash && !hasSeenSplash) {
    // Hide immediately, no artificial delay
    setShowSplash(false);
    setHasSeenSplash(true);
    sessionStorage.setItem('splash_seen', 'true');
  }
}, [isAppReady, showSplash, hasSeenSplash]);
```

#### 1.2 Cache Dashboard Data in localStorage

**Impact:** -500-800ms on repeat visits
**Effort:** Low
**Risk:** Low

Show cached data immediately while fetching fresh data in background.

```typescript
// Dashboard page - Load from cache first
useEffect(() => {
  // Try to load cached dashboard data immediately
  const cached = localStorage.getItem('dashboard_cache');
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < 5 * 60 * 1000) { // 5 min cache
      setActiveMesocycle(data.mesocycle);
      setNutritionTotals(data.nutrition);
      // ... set other state
      setIsLoading(false); // Show content immediately
    }
  }
  // Then fetch fresh data in background
  fetchDashboardData();
}, []);
```

#### 1.3 Prioritize Critical Queries

**Impact:** -200-400ms
**Effort:** Low
**Risk:** Low

Fetch only essential data first, defer non-critical queries.

```typescript
// Critical queries (show loading skeleton after these complete):
const criticalQueries = Promise.all([
  supabase.from('users').select('goal').eq('id', user.id).single(),
  supabase.from('mesocycles').select('...').eq('user_id', user.id),
]);

// Non-critical queries (load after content shows):
const deferredQueries = Promise.all([
  supabase.from('system_foods').select('...'), // Defer: only needed when logging food
  supabase.from('food_log').select('...').limit(50), // Defer: frequent foods
]);
```

---

### Phase 2: Architectural Improvements (Est. Savings: 0.5-1s)

#### 2.1 Convert Dashboard to Server Component with Streaming

**Impact:** -300-500ms
**Effort:** Medium
**Risk:** Medium

Move data fetching to server side and stream content as it becomes available.

```typescript
// app/(dashboard)/dashboard/page.tsx - Server Component
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Suspense fallback={<QuickActionsSkeleton />}>
        <QuickActions />
      </Suspense>

      <Suspense fallback={<TodaysWorkoutSkeleton />}>
        <TodaysWorkout />
      </Suspense>

      <Suspense fallback={<NutritionSkeleton />}>
        <NutritionCard />
      </Suspense>

      {/* Stream each card independently */}
    </div>
  );
}

// Separate async server components for each card
async function TodaysWorkout() {
  const supabase = await createClient();
  const { data: mesocycle } = await supabase
    .from('mesocycles')
    .select('...')
    .single();

  return <TodaysWorkoutCard mesocycle={mesocycle} />;
}
```

#### 2.2 Implement Route Prefetching

**Impact:** -200-300ms on navigation
**Effort:** Low
**Risk:** Low

Add prefetch hints for likely next pages.

```typescript
// components/dashboard/BottomNavigation.tsx
import Link from 'next/link';

// Already using Link which prefetches by default
// Ensure prefetch is not disabled
<Link href="/dashboard/workout" prefetch={true}>
```

#### 2.3 Split Dashboard Bundle

**Impact:** -100-200ms
**Effort:** Medium
**Risk:** Low

Break the monolithic dashboard page into smaller chunks.

```typescript
// Create separate route segments:
// app/(dashboard)/dashboard/@workout/page.tsx
// app/(dashboard)/dashboard/@nutrition/page.tsx
// app/(dashboard)/dashboard/@volume/page.tsx

// Use parallel routes in layout:
export default function DashboardLayout({
  workout,
  nutrition,
  volume,
}: {
  workout: React.ReactNode;
  nutrition: React.ReactNode;
  volume: React.ReactNode;
}) {
  return (
    <div>
      {workout}
      {nutrition}
      {volume}
    </div>
  );
}
```

---

### Phase 3: Advanced Optimizations (Est. Savings: 0.3-0.5s)

#### 3.1 Edge Middleware Caching

**Impact:** -200-300ms
**Effort:** Medium
**Risk:** Low

Cache auth state at the edge to avoid server round-trip.

```typescript
// middleware.ts - Use edge caching
export const config = {
  matcher: [...],
  runtime: 'edge',
};

export async function middleware(request: NextRequest) {
  // Check for cached session cookie first
  const sessionToken = request.cookies.get('sb-session');
  if (sessionToken && isValidJWT(sessionToken.value)) {
    // Skip server auth check for valid cached sessions
    return NextResponse.next();
  }

  return await updateSession(request);
}
```

#### 3.2 Service Worker Precaching

**Impact:** -300-500ms on repeat visits
**Effort:** Medium
**Risk:** Low

Precache critical assets and API responses.

```javascript
// public/sw.js - Add precaching
const CACHE_NAME = 'hypertrack-v1';
const PRECACHE_URLS = [
  '/',
  '/dashboard',
  '/_next/static/chunks/main.js',
  // Add critical chunks
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});
```

#### 3.3 Inline Critical CSS

**Impact:** -50-100ms
**Effort:** Low
**Risk:** Low

Already partially implemented. Ensure all above-the-fold CSS is inlined.

---

## Implementation Priority

| Priority | Task | Impact | Effort | Est. Savings |
|----------|------|--------|--------|--------------|
| 1 | Remove splash hardcoded delays | High | Low | 1000ms |
| 2 | Cache dashboard data locally | High | Low | 500-800ms |
| 3 | Prioritize critical queries | Medium | Low | 200-400ms |
| 4 | Convert to Server Components | High | Medium | 300-500ms |
| 5 | Split dashboard bundle | Medium | Medium | 100-200ms |
| 6 | Edge middleware caching | Medium | Medium | 200-300ms |

**Total Potential Savings: 2.3-3.2 seconds**

---

## Metrics to Track

1. **Time to First Contentful Paint (FCP)** - When splash screen appears
2. **Time to Interactive (TTI)** - When dashboard is usable
3. **Largest Contentful Paint (LCP)** - When main content is visible
4. **Total Blocking Time (TBT)** - JavaScript execution blocking

### Measurement Commands

```bash
# Lighthouse audit
npx lighthouse https://hypertrack.app/dashboard --view

# Next.js bundle analysis
ANALYZE=true npm run build
```

---

## Files to Modify

### Phase 1 Files
- `components/providers/SplashProvider.tsx` - Remove hardcoded delays
- `app/(dashboard)/dashboard/page.tsx` - Add localStorage caching, prioritize queries

### Phase 2 Files
- `app/(dashboard)/dashboard/page.tsx` - Convert to Server Component
- `app/(dashboard)/dashboard/layout.tsx` - Add parallel routes
- Create new files for streaming components

### Phase 3 Files
- `middleware.ts` - Add edge caching
- `public/sw.js` - Add precaching
- `app/layout.tsx` - Optimize critical CSS

---

## Success Criteria

- Initial load (cold cache): < 1.5 seconds
- Repeat load (warm cache): < 0.5 seconds
- Time to interactive: < 2 seconds

---

## Notes

- The splash animation itself is NOT being removed - only the artificial delays
- All optimizations preserve existing functionality
- Server Components are backward compatible with existing client components
- Cache invalidation should be handled carefully to avoid stale data issues
