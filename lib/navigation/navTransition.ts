/**
 * Decides how a dashboard screen enters (design system "Feels native"):
 *
 * - Pushed screens (a workout, history, a detail page…) slide in from the
 *   right, like a UINavigationController push.
 * - Switching tabs is instant — tab bars never animate the content.
 * - Going back (browser/WKWebView back, swipe-back) is instant: the system
 *   back gesture already animates, and a second slide would fight it.
 * - The very first screen after launch doesn't animate.
 *
 * Kept outside React so the app/(dashboard)/dashboard/template.tsx wrapper,
 * which remounts on every navigation, can ask "how did we get here?".
 */

export type NavTransition = 'none' | 'push';

/** Tab roots (BottomNavigation). Arriving at one of these is a tab switch. */
export const TAB_ROOTS: readonly string[] = [
  '/dashboard',
  '/dashboard/train',
  '/dashboard/nutrition',
  '/dashboard/analytics',
  '/dashboard/more',
];

let hasRenderedOnce = false;
let pendingPop = false;
let listening = false;

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', () => {
    pendingPop = true;
  });
}

// Start listening as soon as the module loads on the client, so the first
// back navigation is already caught.
listen();

/**
 * How the screen at `pathname` should enter. Call once per mount (the
 * template does it in a state initializer).
 */
export function consumeNavTransition(pathname: string): NavTransition {
  listen();
  const first = !hasRenderedOnce;
  hasRenderedOnce = true;
  const wasPop = pendingPop;
  pendingPop = false;

  if (first || wasPop) return 'none';
  const path = pathname.replace(/\/+$/, '') || '/';
  return TAB_ROOTS.includes(path) ? 'none' : 'push';
}

/** Test-only: forget launch/back state between tests. */
export function resetNavTransitionForTests(): void {
  hasRenderedOnce = false;
  pendingPop = false;
}
