'use client';

import { useCallback, useState } from 'react';

/**
 * Shared plain-text share action for the Wordle-style share cards (workout &
 * nutrition). Three-tier fallback, extracted so both share buttons run one
 * implementation instead of copy-pasting the handler:
 *
 *   1. Native build → the OS share sheet via the Capacitor Share plugin.
 *   2. Web with navigator.share → the browser share sheet.
 *   3. Otherwise → copy to clipboard and flip `copied` for 2s.
 *
 * `@capacitor/*` is imported dynamically inside the handler so web builds
 * that don't ship the plugin never break. A cancelled share sheet
 * (AbortError) is deliberately swallowed — it is not a failure and must NOT
 * fall through to the clipboard copy.
 */
export function useTextShare() {
  const [copied, setCopied] = useState(false);

  const share = useCallback(async (text: string) => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ text });
        return;
      }
    } catch {
      // Plugin unavailable — fall through to the web paths.
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        // User cancelled the sheet — not an error, and don't copy instead.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions) — the preview is selectable as a last resort.
    }
  }, []);

  return { share, copied };
}
