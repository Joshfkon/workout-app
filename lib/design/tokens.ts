/**
 * Design-system colour tokens (2026 redesign).
 *
 * These values are mirrored as `--ht-*` CSS variables in app/globals.css
 * (dark on :root, light on :root[data-theme="light"]) and exposed to
 * Tailwind as bg-canvas, bg-card, bg-fill, border-sep, text-ink(-2/-3),
 * bg-action, text-on-action, text-status-*, text-macro-*.
 *
 * The test in __tests__/tokens.test.ts keeps globals.css in sync with this
 * file and checks every text/background pairing for WCAG contrast, so a
 * colour tweak that makes text unreadable fails CI instead of shipping.
 *
 * One accent ("action") for everything you tap. ok/warn/bad report status
 * only. Macro colours never reuse the status colours, so "over target" can
 * be red without reading as "fat".
 */

export type Rgb = readonly [number, number, number];

export interface ThemeTokens {
  bg: Rgb;
  card: Rgb;
  fill: Rgb;
  sep: Rgb;
  ink: Rgb;
  'ink-2': Rgb;
  'ink-3': Rgb;
  action: Rgb;
  'on-action': Rgb;
  ok: Rgb;
  warn: Rgb;
  bad: Rgb;
  protein: Rgb;
  carbs: Rgb;
  fat: Rgb;
}

export const DARK: ThemeTokens = {
  bg: [11, 11, 13],
  card: [26, 26, 30],
  fill: [42, 42, 48],
  sep: [47, 47, 53],
  ink: [244, 244, 245],
  'ink-2': [169, 169, 178],
  'ink-3': [142, 142, 152],
  action: [56, 189, 248],
  'on-action': [6, 36, 54],
  ok: [74, 222, 128],
  warn: [250, 204, 21],
  bad: [248, 113, 113],
  protein: [45, 212, 191],
  carbs: [251, 146, 60],
  fat: [167, 139, 250],
};

export const LIGHT: ThemeTokens = {
  bg: [242, 242, 247],
  card: [255, 255, 255],
  fill: [233, 233, 239],
  sep: [220, 220, 226],
  ink: [17, 17, 20],
  'ink-2': [82, 82, 92],
  'ink-3': [107, 107, 118],
  action: [3, 105, 161],
  'on-action': [255, 255, 255],
  ok: [19, 117, 55],
  warn: [146, 88, 6],
  bad: [185, 28, 28],
  protein: [15, 118, 110],
  carbs: [194, 65, 12],
  fat: [124, 58, 237],
};

/** CSS variable name for a token key (bg → --ht-bg, protein → --ht-protein). */
export function cssVarName(key: keyof ThemeTokens): string {
  return `--ht-${key}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two colours (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
