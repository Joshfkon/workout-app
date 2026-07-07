'use client';

import type { ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Minimal bottom sheet used by the set logger (feedback sheet, suggestion
 * explanation, plateau suggestions). Slides from the bottom on mobile,
 * centers on larger screens.
 *
 * Keyboard-aware: while the on-screen keyboard is up the scroll container
 * gains matching bottom padding and the focused field is scrolled into view,
 * so lower fields are never trapped behind the keyboard/accessory bar.
 */
export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const { inset: keyboardInset, scrollContainerRef } =
    useKeyboardInset<HTMLDivElement>(isOpen);

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
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-900 px-4 pt-4 pb-3 border-b border-surface-800 flex items-center justify-between gap-2">
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
