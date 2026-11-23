import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

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
        orange: {
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
        },
        // ── Design system (2026 redesign) ──────────────────────────────
        // Theme-aware via the --ht-* variables in app/globals.css; values
        // and contrast checks live in lib/design/tokens.ts. Use ONLY these
        // for UI colour (orange and meal-* are categorical identities).
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
      // In rem (same pixels at the default 16px root) so the Text size
      // setting (lib/textSize: root font-size 100 / 112.5 / 125%) scales it.
      fontSize: {
        display: ['2.5rem', { lineHeight: '2.75rem', fontWeight: '700', letterSpacing: '-0.02em' }], // 40/44px
        'large-title': ['2rem', { lineHeight: '2.375rem', fontWeight: '700', letterSpacing: '-0.02em' }], // 32/38px
        title: ['1.375rem', { lineHeight: '1.75rem', fontWeight: '700', letterSpacing: '-0.01em' }], // 22/28px
        headline: ['1.0625rem', { lineHeight: '1.375rem', fontWeight: '600' }], // 17/22px
        body: ['0.9375rem', { lineHeight: '1.25rem' }], // 15/20px
        subhead: ['0.8125rem', { lineHeight: '1.125rem' }], // 13/18px
        caption: ['0.75rem', { lineHeight: '1rem', fontWeight: '500' }], // 12/16px
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
        // A just-added food row: slides in, then its tint fades out.
        'row-added': 'rowAdded 2.2s ease-out',
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
        rowAdded: {
          '0%': { backgroundColor: 'rgb(var(--ht-ok) / 0.22)', transform: 'translateY(-6px)', opacity: '0' },
          '12%': { backgroundColor: 'rgb(var(--ht-ok) / 0.22)', transform: 'translateY(0)', opacity: '1' },
          '60%': { backgroundColor: 'rgb(var(--ht-ok) / 0.14)' },
          '100%': { backgroundColor: 'rgb(var(--ht-ok) / 0)' },
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
  plugins: [
    // `large-text:` applies when the Text size setting is above Default
    // (lib/textSize stamps data-text-size on <html> only then). For the few
    // rows whose fixed-px controls (44px steppers, icon buttons) leave too
    // little room once text grows: wrap or stack them instead of clipping.
    plugin(({ addVariant }) => {
      addVariant('large-text', 'html[data-text-size] &');
    }),
  ],
};

export default config;

