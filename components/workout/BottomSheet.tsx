'use client';

import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { IconX } from '@tabler/icons-react';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useRegisterOverlay } from '@/hooks/useOverlayRegistry';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Downward drag past this (px) dismisses the sheet. */
const SWIPE_DISMISS_PX = 80;

/**
 * Minimal bottom sheet used by the set logger (feedback sheet, suggestion
 * explanation, plateau suggestions). Slides from the bottom on mobile,
 * centers on larger screens.
 *
 * Swipe to dismiss: dragging down from the top of the sheet (content
 * scrolled to the top) follows the finger; releasing past
 * SWIPE_DISMISS_PX closes it, otherwise it springs back.
 *
 * Keyboard-aware: while the on-screen keyboard is up the scroll container
 * gains matching bottom padding and the focused field is scrolled into view,
 * so lower fields are never trapped behind the keyboard/accessory bar.
 */
export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const { inset: keyboardInset, scrollContainerRef } =
    useKeyboardInset<HTMLDivElement>(isOpen);
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  const onTouchStart = (e: TouchEvent) => {
    // Only a drag that starts with the content at the top dismisses —
    // otherwise the gesture is ordinary scrolling.
    const atTop = (scrollContainerRef.current?.scrollTop ?? 0) <= 0;
    dragStartY.current = atTop ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (dragStartY.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStartY.current));
  };
  const onTouchEnd = () => {
    if (dragStartY.current !== null && dragY > SWIPE_DISMISS_PX) onClose();
    dragStartY.current = null;
    setDragY(0);
  };
  // Tell app chrome (the resume-workout pill) to stand down while we're up —
  // it's fixed at the layout root and would otherwise paint over our fields.
  useRegisterOverlay(isOpen);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Sheet'}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={scrollContainerRef}
        className="relative w-full max-w-lg overflow-y-auto bg-surface-900 border border-surface-800 rounded-t-2xl sm:rounded-xl shadow-2xl"
        style={{
          // Keep the whole sheet above the keyboard so every field can be
          // scrolled fully into view, and cap its height to the space that
          // remains. Safe-area stays additive with the keyboard inset,
          // never replaced by it.
          marginBottom: keyboardInset > 0 ? keyboardInset : undefined,
          maxHeight: `min(85vh, calc(100vh - ${keyboardInset}px))`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragY > 0 ? 'none' : 'transform 150ms ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        data-testid="bottom-sheet"
      >
        <div className="sm:hidden flex justify-center pt-2" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-surface-700" />
        </div>
        <div className="sticky top-0 bg-surface-900 px-4 pt-2 sm:pt-4 pb-3 border-b border-surface-800 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-medium text-surface-100">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
            aria-label="Close"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default BottomSheet;
