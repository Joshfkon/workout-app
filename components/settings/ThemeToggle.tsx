'use client';

import { useTheme, type ThemePreference } from '@/hooks/useTheme';

/**
 * Light/dark/system theme controls. All state lives in useTheme (localStorage
 * cache + users.preferences.theme sync + the data-theme attribute on <html>),
 * so every mounted toggle — settings, dashboard header, homepage nav — stays
 * in sync.
 */

const SunIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 3v2m0 14v2M5.05 5.05l1.41 1.41m11.08 11.08l1.41 1.41M3 12h2m14 0h2M5.05 18.95l1.41-1.41M17.54 6.46l1.41-1.41M16 12a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const MoonIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
    />
  </svg>
);

const SystemIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
    />
  </svg>
);

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode; title: string }[] = [
  { value: 'dark', label: 'Dark', icon: MoonIcon, title: 'Dark theme' },
  { value: 'light', label: 'Light', icon: SunIcon, title: 'Light theme' },
  { value: 'system', label: 'System', icon: SystemIcon, title: 'Match device theme' },
];

/** Full segmented control (icon + label) for settings screens. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex rounded-lg bg-surface-800 p-1 gap-1" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            theme === value
              ? 'bg-surface-600 text-surface-50'
              : 'text-surface-400 hover:text-surface-200'
          }`}
          aria-pressed={theme === value}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

/** Icon-only segmented control for tight spots (header bars, nav). */
export function ThemeToggleCompact() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex rounded-lg bg-surface-800/80 p-0.5 gap-0.5" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, icon, title }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`p-1.5 rounded-md transition-colors ${
            theme === value
              ? 'bg-surface-600 text-surface-50'
              : 'text-surface-400 hover:text-surface-200'
          }`}
          aria-pressed={theme === value}
          aria-label={title}
          title={title}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
