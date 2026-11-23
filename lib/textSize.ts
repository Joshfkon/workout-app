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
 * The OS text-size signal, used only while the user has never picked a size.
 *
 * On iOS / iPadOS (Safari and the app's WKWebView) the `-apple-system-body`
 * font keyword resolves to the Dynamic Type body size the user set in
 * Settings → Display & Text Size: 17px at the default, 19px one step up,
 * 21px+ beyond. A web view does NOT scale rem text with Dynamic Type on its
 * own, so this is the one reliable "the OS already asks for bigger text"
 * signal we have. Browsers without the keyword reject it (the inline style
 * stays empty) and get Default. A browser's own default font size needs no
 * handling: every size here is a % of it already.
 */
export const SYSTEM_BODY_DEFAULT_PX = 17;

export function textSizeForSystemBodyPx(px: number): TextSize {
  if (!Number.isFinite(px) || px <= SYSTEM_BODY_DEFAULT_PX + 0.5) return 'default';
  return px >= 21 ? 'larger' : 'large';
}

/** The size the OS asks for (see {@link textSizeForSystemBodyPx}); Default when unknown. */
export function systemPreferredTextSize(doc: Document = document): TextSize {
  try {
    const probe = doc.createElement('span');
    probe.style.font = '-apple-system-body';
    if (!probe.style.font) return 'default'; // keyword not supported: no signal
    doc.documentElement.appendChild(probe);
    const px = parseFloat(doc.defaultView?.getComputedStyle(probe).fontSize ?? '');
    probe.remove();
    return textSizeForSystemBodyPx(px);
  } catch {
    return 'default';
  }
}

/**
 * Runs inline in <head> before first paint: read the saved size and stamp
 * the attribute; with no saved choice, follow the OS text size. Kept tiny and
 * dependency-free; mirrors applyTextSizeToDocument + systemPreferredTextSize.
 */
export const TEXT_SIZE_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=null;try{s=localStorage.getItem('${TEXT_SIZE_STORAGE_KEY}');}catch(e){}if(s==='large'||s==='larger'){d.setAttribute('${TEXT_SIZE_ATTRIBUTE}',s);return;}if(s==='default')return;var p=document.createElement('span');p.style.font='-apple-system-body';if(!p.style.font)return;d.appendChild(p);var px=parseFloat(getComputedStyle(p).fontSize);d.removeChild(p);if(px>=21)d.setAttribute('${TEXT_SIZE_ATTRIBUTE}','larger');else if(px>${SYSTEM_BODY_DEFAULT_PX + 0.5})d.setAttribute('${TEXT_SIZE_ATTRIBUTE}','large');}catch(e){}})();`;
