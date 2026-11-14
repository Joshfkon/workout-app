/**
 * iOS keyboard toolbar ("form accessory bar") for the Capacitor shell.
 *
 * Capacitor's Keyboard plugin HIDES the iOS keyboard toolbar by default
 * (`hideFormAccessoryBar = YES` in its native code). That toolbar carries the
 * Done button and the prev/next arrows. Text keyboards still have a Return
 * key, but the iPhone number pad (`inputMode="numeric" | "decimal"` — weights,
 * reps, steps, macros…) has no key that dismisses it, so with the toolbar
 * hidden the number pad could never be closed.
 *
 * `showKeyboardAccessoryBar()` turns the toolbar back on. It runs from the
 * web app (mounted in NativeAppBehavior), so it reaches already-installed
 * builds on the next site deploy. Native iOS only; a no-op everywhere else.
 */

import { isNativePlatform, getPlatform } from './capacitor-stub';

export async function showKeyboardAccessoryBar(): Promise<void> {
  if (!isNativePlatform() || getPlatform() !== 'ios') return;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    // Call the method directly; never await or return the plugin object
    // itself — Capacitor plugin proxies look like promises (see
    // lib/integrations/healthkit.ts getPlugin).
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch (error) {
    console.warn('[Keyboard] Could not show the keyboard toolbar:', error);
  }
}
