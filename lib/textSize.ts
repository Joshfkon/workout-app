/**
 * Text size: one app-wide setting that scales the root font size.
 *
 * Every design-system text token (tailwind.config fontSize) and Tailwind's
 * spacing scale are in rem, so changing the root font size scales the whole
 * UI. Fixed px values (icon sizes, 44px tap targets) stay put.
 *
 * Applied as a `data-text-size` attribute on <html> (absent = Default), with
 * the matching root font-size rules in app/layout.tsx's inline critical CSS.
 * The same layout runs {@link TEXT_SIZE_BOOT_SCRIPT} before first paint, so a
 * saved size is in place before any data loads: no flash of small text.
 *
 * Persistence mirrors the theme (hooks/useTheme.ts): localStorage for the
 * pre-paint read, users.preferences.textSize so it follows the user across
 * devices. See hooks/useTextSize.ts.
 */

export type TextSize = 'default' | 'large' | 'larger';

export const TEXT_SIZES: readonly TextSize[] = ['default', 'large', 'larger'];

export const DEFAULT_TEXT_SIZE: TextSize = 'default';

/** Root font size per step, as a % of the browser default (16px). */
export const TEXT_SIZE_PERCENT: Record<TextSize, number> = {
  default: 100,
  large: 112.5,
  larger: 125,
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  default: 'Default',
  large: 'Large',
  larger: 'Larger',
};

/** localStorage key read before first paint. */
export const TEXT_SIZE_STORAGE_KEY = 'textSize';

/** Attribute on <html>; absent means Default. */
export const TEXT_SIZE_ATTRIBUTE = 'data-text-size';

export function isTextSize(value: unknown): value is TextSize {
  return value === 'default' || value === 'large' || value === 'larger';
}

/** Stamp (or clear) the attribute that sets the root font size. */
export function applyTextSizeToDocument(size: TextSize, doc: Document = document): void {
  if (size === 'default') doc.documentElement.removeAttribute(TEXT_SIZE_ATTRIBUTE);
  else doc.documentElement.setAttribute(TEXT_SIZE_ATTRIBUTE, size);
}

/** Root font-size rules for the non-default steps (inline critical CSS). */
export const TEXT_SIZE_CSS = (['large', 'larger'] as const)
  .map((size) => `html[${TEXT_SIZE_ATTRIBUTE}="${size}"]{font-size:${TEXT_SIZE_PERCENT[size]}%;}`)
  .join('');

/**
 * Runs inline in <head> before first paint: read the saved size and stamp
 * the attribute. Kept tiny and dependency-free; mirrors
 * applyTextSizeToDocument.
 */
export const TEXT_SIZE_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('${TEXT_SIZE_STORAGE_KEY}');if(s==='large'||s==='larger'){document.documentElement.setAttribute('${TEXT_SIZE_ATTRIBUTE}',s);}}catch(e){}})();`;
