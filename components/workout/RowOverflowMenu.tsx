'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

/**
 * A single row-overflow (⋮) action.
 *
 * `separatorBefore` draws a divider above the item (used to fence off the
 * destructive Remove action). `destructive` renders it in the danger color.
 */
export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  separatorBefore?: boolean;
}

interface RowOverflowMenuProps {
  items: RowMenuItem[];
  /** Accessible label for the trigger button. */
  ariaLabel?: string;
  /** Forwarded to the trigger for e2e targeting. */
  testId?: string;
  /** Extra data attribute on the trigger (e.g. block id) for tests. */
  dataBlockId?: string;
}

const MENU_WIDTH = 244;
const GAP = 6; // px between trigger and popover
const EDGE = 8; // min viewport margin

/**
 * Read the device safe-area insets (iOS/Capacitor) by probing computed
 * `env(safe-area-inset-*)` values off a throwaway element. Falls back to 0 on
 * platforms without insets.
 */
function readSafeAreaInsets(): { top: number; bottom: number } {
  if (typeof document === 'undefined') return { top: 0, bottom: 0 };
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

/**
 * Per-row overflow menu: a 44×44 ⋮ trigger opening a portaled popover.
 *
 * Portaled to <body> so the list's overflow/scroll container can't clip it,
 * flips above the trigger when there isn't room below (respecting safe-area
 * insets), and closes on outside tap, Escape, scroll, route change, and after
 * any item is chosen. Full keyboard menu semantics (arrow keys, Enter, Escape
 * returns focus to the trigger) with the matching aria roles.
 */
export function RowOverflowMenu({
  items,
  ariaLabel = 'More actions',
  testId,
  dataBlockId,
}: RowOverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pathname = usePathname();

  const close = useCallback((returnFocus = false) => {
    setIsOpen(false);
    setPos(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Position (and re-position after measuring), flipping above when the
  // popover would overflow the safe viewport below the trigger.
  const place = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const { top: safeTop, bottom: safeBottom } = readSafeAreaInsets();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Right-align the popover to the trigger, clamped into the viewport.
    let left = rect.right - MENU_WIDTH;
    if (left < EDGE) left = EDGE;
    if (left + MENU_WIDTH > vw - EDGE) left = vw - EDGE - MENU_WIDTH;

    const menuH = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + GAP;
    const roomBelow = vh - safeBottom - EDGE - below;

    let top: number;
    if (menuH > 0 && roomBelow < menuH) {
      // Flip above the trigger.
      top = rect.top - GAP - menuH;
      if (top < safeTop + EDGE) top = safeTop + EDGE;
    } else {
      top = below;
    }
    setPos({ top, left });
  }, []);

  const open = useCallback(() => {
    setActiveIndex(0);
    setIsOpen(true);
    // Initial placement uses a below-anchor guess; the layout effect below
    // re-measures once the popover has real height and flips if needed.
    place();
  }, [place]);

  // Re-measure after the menu mounts (real height known) and focus the first item.
  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    itemRefs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Close on outside pointer, Escape, scroll, and resize.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    // Any scroll (list, page, nested container) dismisses the popover — it is
    // anchored to a fixed coordinate and would otherwise detach from the row.
    const onScroll = () => close();
    const onResize = () => close();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, close]);

  // Close on route change.
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== firstPath.current) {
      firstPath.current = pathname;
      close();
    }
  }, [pathname, close]);

  const focusItem = (i: number) => {
    const n = items.length;
    const next = ((i % n) + n) % n;
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(activeIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Tab':
        // Keep focus trapped-ish: close rather than tabbing into page chrome.
        close();
        break;
    }
  };

  const choose = (item: RowMenuItem) => {
    close();
    item.onSelect();
  };

  const menu = isOpen && pos && (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      data-testid="row-menu"
      className="fixed z-[60] rounded-xl border border-surface-700 bg-surface-800 py-1 shadow-2xl animate-fade-in"
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {item.separatorBefore && <div className="my-1 border-t border-surface-700/60" />}
          <button
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            role="menuitem"
            tabIndex={activeIndex === i ? 0 : -1}
            data-testid={`row-menu-item-${item.key}`}
            onClick={() => choose(item)}
            onMouseEnter={() => setActiveIndex(i)}
            className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
              item.destructive
                ? 'text-danger-400 hover:bg-danger-500/10 focus:bg-danger-500/10'
                : 'text-surface-200 hover:bg-surface-700 focus:bg-surface-700'
            } focus:outline-none`}
          >
            {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="More"
        data-testid={testId}
        data-block-id={dataBlockId}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      </button>
      {typeof document !== 'undefined' && createPortal(menu, document.body)}
    </>
  );
}
