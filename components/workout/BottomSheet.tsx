'use client';

import type { ReactNode } from 'react';
import { Sheet } from '@/components/ui/Sheet';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Bottom sheet used by the set logger (feedback sheet, suggestion
 * explanation, plateau suggestions) and a few other workout/body screens.
 *
 * Now a thin wrapper over the shared `Sheet`, so it looks and behaves exactly
 * like every other pop-up in the app: slides up on phones, swipe down to
 * close, keyboard-aware, centred card on wider screens.
 */
export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      ariaLabel={title ?? 'Sheet'}
      size="lg"
      data-testid="bottom-sheet"
    >
      {children}
    </Sheet>
  );
}

export default BottomSheet;
