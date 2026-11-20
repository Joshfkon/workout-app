import type { Config } from "tailwindcss";

const config: Config = {
  // Bind dark: variants to the app's own theme attribute (set pre-paint by
  // the script in app/layout.tsx and managed by hooks/useTheme.ts). Without
  // this, Tailwind defaults to the `media` strategy and dark: classes follow
  // the OS setting, flipping independently of the in-app theme choice.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // Class-name constants live here too (e.g. lib/nutrition/mealAccents.ts)
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom color palette for the workout app
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        accent: {
          50: '#fdf4ff',
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',
          600: '#c026d3',
          700: '#a21caf',
          800: '#86198f',
          900: '#701a75',
          950: '#4a044e',
        },
        surface: {
          50: 'rgb(var(--surface-50) / <alpha-value>)',
          100: 'rgb(var(--surface-100) / <alpha-value>)',
          200: 'rgb(var(--surface-200) / <alpha-value>)',
          300: 'rgb(var(--surface-300) / <alpha-value>)',
          400: 'rgb(var(--surface-400) / <alpha-value>)',
          500: 'rgb(var(--surface-500) / <alpha-value>)',
          600: 'rgb(var(--surface-600) / <alpha-value>)',
          700: 'rgb(var(--surface-700) / <alpha-value>)',
          800: 'rgb(var(--surface-800) / <alpha-value>)',
          900: 'rgb(var(--surface-900) / <alpha-value>)',
          950: 'rgb(var(--surface-950) / <alpha-value>)',
        },
        success: {
          // 300/700 bracket the volume-heatmap green ramp (light "just over
          // MEV" through darkest "above MRV" — see HEAT_FILL_CLASSES in
          // app/(dashboard)/dashboard/_lib/volumeHeatmap.ts).
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        warning: {
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',
        },
        danger: {
          // 300 is the soft "untrained" red — a warning that must stay clearly
          // lighter than the solid 500 used for over-MRV (see weeklyVolume's
          // ZoneColorToken), so the two never read as the same signal.
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
        orange: {
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
        },
        // ── Design system (2026 redesign) ──────────────────────────────
        // Theme-aware via the --ht-* variables in app/globals.css; values
        // and contrast checks live in lib/design/tokens.ts. New UI uses
        // ONLY these. The primary/accent/surface ramps stay until every
        // screen has moved over (accent-* is the old purple — don't use).
        canvas: 'rgb(var(--ht-bg) / <alpha-value>)',
        card: 'rgb(var(--ht-card) / <alpha-value>)',
        fill: 'rgb(var(--ht-fill) / <alpha-value>)',
        sep: 'rgb(var(--ht-sep) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ht-ink) / <alpha-value>)',
          2: 'rgb(var(--ht-ink-2) / <alpha-value>)',
          3: 'rgb(var(--ht-ink-3) / <alpha-value>)',
        },
        action: {
          DEFAULT: 'rgb(var(--ht-action) / <alpha-value>)',
          tint: 'var(--ht-action-tint)',
        },
        'on-action': 'rgb(var(--ht-on-action) / <alpha-value>)',
        status: {
          ok: 'rgb(var(--ht-ok) / <alpha-value>)',
          'ok-tint': 'var(--ht-ok-tint)',
          warn: 'rgb(var(--ht-warn) / <alpha-value>)',
          'warn-tint': 'var(--ht-warn-tint)',
          bad: 'rgb(var(--ht-bad) / <alpha-value>)',
          'bad-tint': 'var(--ht-bad-tint)',
        },
        macro: {
          protein: 'rgb(var(--ht-protein) / <alpha-value>)',
          carbs: 'rgb(var(--ht-carbs) / <alpha-value>)',
          fat: 'rgb(var(--ht-fat) / <alpha-value>)',
        },
        scrim: 'var(--ht-scrim)',
        // Meal-section accent identities (theme-aware via CSS vars in
        // globals.css — 400-weight on dark, 600-weight on light).
        meal: {
          breakfast: 'rgb(var(--meal-breakfast) / <alpha-value>)',
          lunch: 'rgb(var(--meal-lunch) / <alpha-value>)',
          dinner: 'rgb(var(--meal-dinner) / <alpha-value>)',
          snack: 'rgb(var(--meal-snack) / <alpha-value>)',
        },
      },
      // Design-system type scale: sentence case, one scale everywhere.
      fontSize: {
        display: ['40px', { lineHeight: '44px', fontWeight: '700', letterSpacing: '-0.02em' }],
        'large-title': ['32px', { lineHeight: '38px', fontWeight: '700', letterSpacing: '-0.02em' }],
        title: ['22px', { lineHeight: '28px', fontWeight: '700', letterSpacing: '-0.01em' }],
        headline: ['17px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '20px' }],
        subhead: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      borderRadius: {
        input: '8px',
        button: '14px',
        card: '16px',
        sheet: '24px',
      },
      boxShadow: {
        card: 'var(--ht-shadow-card)',
        float: 'var(--ht-shadow-float)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        // Indeterminate bar shown while a tab's page is on its way.
        'nav-progress': 'navProgress 1s ease-in-out infinite',
        // Bottom sheet in/out (iOS-like spring-ish curve in, quick out).
        'sheet-up': 'sheetUp 0.34s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-down': 'sheetDown 0.2s ease-in forwards',
        'fade-out': 'fadeOut 0.2s ease-in forwards',
        // Pushed screen entering (see app/(dashboard)/dashboard/template.tsx).
        'push-in': 'pushIn 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        sheetUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        sheetDown: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(100%)' },
        },
        // Animates `left`, not transform, so fixed-position chrome inside the
        // screen doesn't jump (a transform would re-anchor it).
        pushIn: {
          '0%': { left: '30%', opacity: '0' },
          '55%': { opacity: '1' },
          '100%': { left: '0', opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        navProgress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
      // Safe area insets for notched devices (iPhone X+, Android punch-hole)
      padding: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      margin: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      height: {
        'safe-screen': 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
      },
      minHeight: {
        'safe-screen': 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
      },
    },
  },
  plugins: [],
};

export default config;

