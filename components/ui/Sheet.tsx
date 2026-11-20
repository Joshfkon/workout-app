'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useRegisterOverlay } from '@/hooks/useOverlayRegistry';

export type SheetSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Max width once the screen is wider than a phone (the sheet is full width on phones). */
  size?: SheetSize;
  showCloseButton?: boolean;
  /** Accessible label for the close button. */
  closeLabel?: string;
  /** id for the title element (aria-labelledby). Generated when omitted. */
  titleId?: string;
  /** Used as aria-label when there is no title. */
  ariaLabel?: string;
  /** Sticky footer (e.g. the primary action), kept above the home indicator. */
  footer?: ReactNode;
  /**
   * Grouped sheets (iOS "inset grouped") use the canvas grey so cards inside
   * stand out; plain sheets use the card colour. Default false.
   */
  grouped?: boolean;
  'data-testid'?: string;
}

/** Downward drag past this (px) dismisses the sheet. */
const SWIPE_DISMISS_PX = 80;
/** Must match the sheet-down / fade-out animation length in tailwind.config.ts. */
const EXIT_MS = 200;

// Phone: full width. Wider screens: a centred card capped at this width.
const SIZES: Record<SheetSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  full: 'sm:max-w-4xl',
};

function canAnimateExit(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The app's one overlay surface (design system "Bottom sheet").
 *
 * - Phones: slides up from the bottom, grabber on top, swipe down to close
 *   (from the grabber/header, or from the content when it is scrolled to the
 *   top), sized to its content up to nearly full height.
 * - Wider screens: a centred card.
 * - Closes on the scrim, the close button and Escape; locks page scroll while
 *   open; keyboard-aware so lower fields stay reachable.
 *
 * `Modal` and the workout `BottomSheet` both render through this, so every
 * pop-up in the app looks and behaves the same.
 */
export function Sheet({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  showCloseButton = true,
  closeLabel = 'Close',
  titleId,
  ariaLabel,
  footer,
  grouped = false,
  'data-testid': testId,
}: SheetProps) {
  const surface = grouped ? 'bg-canvas' : 'bg-card';
  const generatedId = useId();
  const headingId = titleId ?? `sheet-title-${generatedId}`;
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { inset: keyboardInset, scrollContainerRef } = useKeyboardInset<HTMLDivElement>(isOpen);
  useRegisterOverlay(isOpen);

  // Keep the sheet mounted briefly after close so it can slide out.
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = isOpen;
    if (was && !isOpen && canAnimateExit()) {
      setClosing(true);
      const t = window.setTimeout(() => setClosing(false), EXIT_MS);
      return () => window.clearTimeout(t);
    }
    setClosing(false);
    return undefined;
  }, [isOpen]);

  // Escape to close, lock page scroll, stop the page behind from scrolling on iOS.
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const preventScroll = (e: globalThis.TouchEvent) => {
      const panel = panelRef.current;
      const target = e.target as HTMLElement | null;
      // Range sliders (and other drag-based inputs) need touchmove.
      if (panel?.contains(target) && target?.closest('input[type="range"], [data-allow-touch-move]')) {
        return;
      }
      let el = target;
      while (el && panel?.contains(el)) {
        const { overflowY } = window.getComputedStyle(el);
        const scrollable =
          (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        if (scrollable) return;
        el = el.parentElement;
      }
      e.preventDefault();
    };

    document.addEventListener('keydown', handleEscape);
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('touchmove', preventScroll);
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [isOpen, onClose]);

  // Swipe down to dismiss.
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  // A drag from the grabber/header always dismisses; one that starts in the
  // content only does when the content is scrolled to the top (otherwise it
  // is ordinary scrolling).
  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      const content = scrollContainerRef.current;
      const inContent = Boolean(content?.contains(e.target as Node));
      const atTop = (content?.scrollTop ?? 0) <= 0;
      dragStartY.current = !inContent || atTop ? e.touches[0].clientY : null;
    },
    [scrollContainerRef]
  );
  const onTouchMove = (e: TouchEvent) => {
    if (dragStartY.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStartY.current));
  };
  const onTouchEnd = () => {
    if (dragStartY.current !== null && dragY > SWIPE_DISMISS_PX) onClose();
    dragStartY.current = null;
    setDragY(0);
  };

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  if (!isOpen && !closing) return null;
  if (typeof window === 'undefined') return null;

  const hasHeader = Boolean(title || description || showCloseButton);

  const sheet = (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={cn(
        'fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-scrim',
        closing ? 'animate-fade-out pointer-events-none' : 'animate-fade-in'
      )}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        aria-label={title ? undefined : ariaLabel}
        data-testid={testId}
        className={cn(
          'relative flex w-full flex-col text-ink shadow-float',
          surface,
          'rounded-t-sheet sm:rounded-card',
          closing ? 'animate-sheet-down sm:animate-fade-out' : 'animate-sheet-up sm:animate-scale-in',
          SIZES[size]
        )}
        style={{
          // Sit above the keyboard; cap to the space left. Safe-area is
          // additive with the keyboard inset, never replaced by it.
          marginBottom: keyboardInset > 0 ? keyboardInset : undefined,
          maxHeight: `calc(100dvh - env(safe-area-inset-top, 0px) - 12px - ${keyboardInset}px)`,
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragY > 0 ? 'none' : 'transform 150ms ease-out',
        }}
      >
        <div className="flex-shrink-0">
          <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
            <span className={cn('h-[5px] w-9 rounded-full', grouped ? 'bg-ink-3/40' : 'bg-fill')} />
          </div>
          {hasHeader && (
            <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 sm:pt-4">
              <div className="min-w-0">
                {title && (
                  <h2 id={headingId} className="text-headline text-ink">
                    {title}
                  </h2>
                )}
                {description && <p className="mt-1 text-subhead text-ink-2">{description}</p>}
              </div>
              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  className="-mr-1 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-fill text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
          style={footer ? undefined : { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {children}
        </div>

        {footer && (
          <div
            className={cn('flex-shrink-0 border-t border-sep px-4 pt-3', surface)}
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

export default Sheet;
