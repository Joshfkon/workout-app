'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/**
 * Light/dark theme toggle. Persists to localStorage and flips the
 * `data-theme` attribute on <html> (read by the no-FOUC script in layout.tsx
 * and the CSS variables in globals.css). Default is dark.
 */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('theme');
    } catch {
      // ignore
    }
    setThemeState(stored === 'light' ? 'light' : 'dark');
  }, []);

  const apply = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('theme', t);
    } catch {
      // ignore
    }
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  };

  return (
    <div className="inline-flex rounded-lg bg-surface-800 p-1 gap-1">
      {(['dark', 'light'] as const).map((t) => (
        <button
          key={t}
          onClick={() => apply(t)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
            theme === t
              ? 'bg-surface-600 text-surface-50'
              : 'text-surface-400 hover:text-surface-200'
          }`}
          aria-pressed={theme === t}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
