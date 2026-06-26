# Site Load Performance Analysis

## Issue Summary

Users experience two distinct issues on site load:
1. **2-second white screen** before any content appears
2. **0.15-second static image flash** where the non-animated splash shows briefly before the animated splash begins

## Implemented Fixes

The following fixes have been applied to eliminate the static image flash:

### 1. Z-Index Fix (`components/ui/SplashScreen.tsx`)
Changed React splash z-index from `100` to `10000` (higher than static splash's `9999`):
```typescript
<div className="fixed inset-0 z-[10000] ..."
```

### 2. Instant Handoff (`components/providers/SplashProvider.tsx`)
Removed the 150ms fade transition - static splash now hides instantly:
```typescript
function hideStaticSplash() {
  const staticSplash = document.getElementById('static-splash');
  if (staticSplash) {
    staticSplash.style.display = 'none'; // Instant, no fade
  }
}
```

**Result**: When React splash mounts, it immediately covers the static splash (higher z-index), then the static splash is hidden. The animation plays from frame 1 with no visible transition.

---

## Architecture (Before Fixes)

### Layer 1: Static HTML Splash (`app/layout.tsx:160-172`)
- Inline CSS + HTML rendered server-side
- Shows immediately before JavaScript loads
- **z-index: 9999** (on top of everything)
- Contains: logo SVG, "HYPERTROPHY" text, "Train Smarter" tagline

### Layer 2: React Animated Splash (`components/ui/SplashScreen.tsx`)
- Client-side component with CSS animations
- **z-index: 100** (BELOW static splash!)
- Contains: animated background, pulsing rings, animated lines, logo with glow, staggered letter animation, progress bar
- Duration: 1300ms

### Layer 3: Splash Provider (`components/providers/SplashProvider.tsx`)
- Orchestrates handoff between static and React splash
- Checks `sessionStorage.getItem('splash_seen')` to skip on repeat visits
- Calls `hideStaticSplash()` when React splash signals ready

## Root Cause Analysis

### Issue 1: 2-Second White Screen

**The static splash should prevent white screen, but it's not working because:**

1. **CSS Paint Timing on Mobile Safari**
   - Even with inline CSS, mobile browsers may delay first paint
   - Document parsing can block paint until critical resources load
   - The `<html style="backgroundColor: '#09090b'">` inline style should help but may not be honored immediately

2. **JavaScript Bundle Parsing**
   - Next.js bundles must download and parse before React hydrates
   - During this ~1-2 second window, if CSS paint is delayed, white screen appears
   - The static splash HTML exists but may not be visible

3. **Possible CSS Specificity Issue**
   - `#static-splash` has `background: linear-gradient(...)` (no `!important`)
   - If any other CSS loads first with conflicting rules, it could override

4. **Third-Party Blocking**
   - Google Fonts preload (lines 84-94) could delay render on slow connections
   - Even with `media="print"` trick, the preload fetch still happens

### Issue 2: 0.15-Second Static Image Flash

**Root Cause: Z-Index Mismatch**

```
Static Splash: z-index: 9999  (TOP - visible to user)
React Splash:  z-index: 100   (BEHIND static splash)
```

**Timeline of what happens:**

| Time | Static Splash | React Splash | User Sees |
|------|--------------|--------------|-----------|
| 0ms | Visible (z-9999) | Mounting | Static image |
| ~16ms | Visible | Calls `onReady` via rAF | Static image |
| ~16ms | Starts fade (opacity → 0, 150ms) | Animating behind | Static image fading |
| ~166ms | Hidden (display: none) | Fully visible | Animation in progress |

**The Problem:**
1. React splash animations start immediately on mount
2. But they're BEHIND the static splash (lower z-index)
3. When static splash fades, user sees animation already mid-way
4. The 150ms fade creates visible transition where both are semi-visible

## Recommended Fixes

### Fix 1: Instant Static-to-Animated Handoff (Recommended)

**Change**: Make static splash hide INSTANTLY (no fade) when React splash is ready

```typescript
// SplashProvider.tsx - line 35
function hideStaticSplash() {
  if (typeof document !== 'undefined') {
    const staticSplash = document.getElementById('static-splash');
    if (staticSplash) {
      // INSTANT hide - no fade transition
      staticSplash.style.display = 'none';
    }
  }
}
```

**Why**: The React splash has identical visual content. Instant swap = no visible change.

**Effort**: Minimal - 3 line change

### Fix 2: Match Z-Index Hierarchy

**Change**: Make React splash z-index higher than static splash

```typescript
// SplashScreen.tsx - line 50
<div className="fixed inset-0 z-[10000] ..." // Higher than 9999
```

**Why**: React splash covers static splash entirely when ready.

**Effort**: Minimal - 1 line change

### Fix 3: Delay Animation Start Until Visible

**Change**: Don't start CSS animations until static splash is hidden

```typescript
// SplashScreen.tsx
const [animationsStarted, setAnimationsStarted] = useState(false);

useEffect(() => {
  // Wait for parent to signal static splash is hidden
  const timer = setTimeout(() => setAnimationsStarted(true), 20);
  return () => clearTimeout(timer);
}, []);

// Apply 'animate' class conditionally
<div className={`splash-logo-enter ${animationsStarted ? '' : 'paused'}`}>
```

**Why**: Animations start from frame 1 when visible to user.

**Effort**: Medium - requires CSS changes

### Fix 4: Remove Static Splash for First-Visit (Most Dramatic)

**Change**: Only show static splash on repeat visits; first visit goes straight to React splash

```typescript
// SplashProvider.tsx
const [showStaticUntilReady, setShowStaticUntilReady] = useState(() => {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('splash_seen') === 'true';
  }
  return false;
});
```

**Why**: First visit users see beautiful animation from start. Repeat visit users see instant load.

**Effort**: Medium - logic change

---

## Fix 5: Eliminate White Screen (Critical)

### Option A: Add CSS Fallback Background

```css
/* globals.css - add at very top */
html {
  background-color: #09090b !important;
}

html::before {
  content: '';
  position: fixed;
  inset: 0;
  background: linear-gradient(to bottom right, #09090b, #18181b, #09090b);
  z-index: -1;
}
```

**Why**: Ensures dark background even if static splash CSS fails to load.

### Option B: Critical CSS Inlining

Move ALL splash-related CSS to `<style>` in `<head>` with `!important`:

```html
<!-- layout.tsx -->
<style dangerouslySetInnerHTML={{ __html: `
  html, body {
    background-color: #09090b !important;
    min-height: 100vh !important;
  }
  /* ... rest of critical styles */
`}} />
```

### Option C: Preload Nothing Initially

Remove Google Fonts preload entirely for first paint:

```typescript
// layout.tsx - defer font loading to after splash
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/..."
  media="print"
  onLoad="this.media='all'"
/>
```

The current implementation already does this, but the `preload` link might still delay render.

---

## Implementation Priority

### Phase 1: Quick Wins (Immediate)
1. **Fix z-index mismatch** - Make React splash z-index 10000
2. **Remove fade transition** - Instant hide for static splash
3. **Add fallback background** - Ensure `html` always has dark bg

**Expected Impact**: Eliminates 0.15s flash completely

### Phase 2: White Screen Investigation (Requires Testing)
1. Remove Google Fonts preload, use system fonts only
2. Add performance markers to measure exact timing
3. Test on real iOS device with Network Link Conditioner

**Diagnostic Code to Add:**
```javascript
// In layout.tsx <head>
<script dangerouslySetInnerHTML={{ __html: `
  performance.mark('html-start');
  document.addEventListener('DOMContentLoaded', () => {
    performance.mark('dom-ready');
    console.log('DOMContentLoaded:', performance.measure('load-time', 'html-start', 'dom-ready'));
  });
`}} />
```

### Phase 3: Architecture Improvements (If Needed)
1. Consider removing static splash entirely for web (keep for Capacitor only)
2. Implement proper loading state that shows immediately
3. Use Service Worker to precache splash assets

---

## Capacitor-Specific Considerations

The native iOS/Android app has additional splash timing:

```typescript
// capacitor.config.ts
SplashScreen: {
  launchShowDuration: 2000, // 2 seconds native splash!
}
```

**Total splash time for native app:**
- Native splash: 2000ms
- React splash: 1300ms
- **Total: 3.3 seconds** before dashboard

**Recommendation**: Reduce native splash to 500ms since React splash provides branded experience:

```typescript
SplashScreen: {
  launchShowDuration: 500, // Just enough for webview to load
}
```

---

## Testing Checklist

After implementing fixes:

- [ ] First visit: No white screen, animation starts immediately
- [ ] First visit: No static image flash before animation
- [ ] Repeat visit: Instant load (no splash at all)
- [ ] Slow 3G network: No white screen, graceful loading
- [ ] iOS Safari: Smooth experience
- [ ] Android Chrome: Smooth experience
- [ ] Capacitor iOS: Total time < 2 seconds to dashboard
- [ ] Capacitor Android: Total time < 2 seconds to dashboard

---

## Metrics to Track

Add these performance markers:

```typescript
// Before implementing
console.time('splash-total');
console.time('static-visible');
console.time('react-splash-mount');
console.time('first-contentful-paint');

// Track in SplashProvider
useEffect(() => {
  console.timeEnd('react-splash-mount');
}, []);
```

Target metrics:
- Time to First Paint: < 100ms
- Time to Static Splash: < 100ms
- Time to React Splash: < 500ms
- Total Splash Duration: 1300ms (first visit) / 0ms (repeat)
