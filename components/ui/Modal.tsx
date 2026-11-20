'use client';

import { memo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Sheet } from './Sheet';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Width on screens wider than a phone; on phones every modal is a full-width bottom sheet. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
}

/**
 * The app's dialog. Renders as a bottom sheet on phones (slides up, grabber,
 * swipe down to close) and a centred card on wider screens — see `Sheet`.
 * The props are unchanged from the old centred modal, so every existing
 * caller picks up the sheet without changes.
 */
export const Modal = memo(function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  showCloseButton = true,
}: ModalProps) {
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      showCloseButton={showCloseButton}
      closeLabel="Close modal"
      titleId="modal-title"
    >
      {children}
    </Sheet>
  );
});

// Modal sub-components for structured content
export const ModalFooter = memo(function ModalFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 pt-4 mt-4 border-t border-sep',
        className
      )}
    >
      {children}
    </div>
  );
});
