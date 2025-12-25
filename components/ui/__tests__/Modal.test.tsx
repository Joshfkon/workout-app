/**
 * Tests for components/ui/Modal.tsx
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal, ModalFooter } from '../Modal';

describe('Modal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    children: <div>Modal content</div>,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // RENDERING TESTS
  // ============================================

  it('renders when isOpen is true', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<Modal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Modal {...defaultProps} title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <Modal {...defaultProps} title="Title" description="Test description" />
    );
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  // ============================================
  // CLOSE BUTTON TESTS
  // ============================================

  it('shows close button by default', () => {
    render(<Modal {...defaultProps} title="Title" />);
    const closeButton = screen.getByRole('button');
    expect(closeButton).toBeInTheDocument();
  });

  it('hides close button when showCloseButton is false', () => {
    render(<Modal {...defaultProps} showCloseButton={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(<Modal {...defaultProps} onClose={onClose} title="Title" />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============================================
  // SIZE TESTS
  // ============================================

  it('applies small size', () => {
    render(<Modal {...defaultProps} size="sm" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-sm');
  });

  it('applies medium size by default', () => {
    render(<Modal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-md');
  });

  it('applies large size', () => {
    render(<Modal {...defaultProps} size="lg" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-lg');
  });

  it('applies xl size', () => {
    render(<Modal {...defaultProps} size="xl" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-xl');
  });

  it('applies full size', () => {
    render(<Modal {...defaultProps} size="full" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-4xl');
  });

  // ============================================
  // KEYBOARD INTERACTION TESTS
  // ============================================

  it('closes on Escape key press', () => {
    const onClose = jest.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============================================
  // OVERLAY CLICK TESTS
  // ============================================

  it('closes when clicking overlay', () => {
    const onClose = jest.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);

    // Click the overlay (backdrop)
    const overlay = screen.getByRole('dialog').parentElement;
    if (overlay) {
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('does not close when clicking modal content', () => {
    const onClose = jest.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);

    // Click the dialog content
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ============================================
  // BODY SCROLL LOCK TESTS
  // ============================================

  it('locks body scroll when open', () => {
    render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Modal {...defaultProps} isOpen={false} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores body scroll on unmount', () => {
    const { unmount } = render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  // ============================================
  // ACCESSIBILITY TESTS
  // ============================================

  it('has dialog role', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has aria-modal attribute', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-labelledby when title is provided', () => {
    render(<Modal {...defaultProps} title="Accessible Title" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
  });

  it('title has correct id for aria-labelledby', () => {
    render(<Modal {...defaultProps} title="Accessible Title" />);
    const title = screen.getByText('Accessible Title');
    expect(title).toHaveAttribute('id', 'modal-title');
  });

  // ============================================
  // PORTAL TESTS
  // ============================================

  it('renders via portal at document body', () => {
    render(
      <div id="app-root">
        <Modal {...defaultProps} title="Portal Test" />
      </div>
    );

    // Modal should be in body, not inside #app-root
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('#app-root')).toBeNull();
  });
});

// ============================================
// MODAL FOOTER TESTS
// ============================================

describe('ModalFooter', () => {
  it('renders children', () => {
    render(
      <ModalFooter>
        <button>Cancel</button>
        <button>Confirm</button>
      </ModalFooter>
    );

    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <ModalFooter className="custom-footer">
        <button>Action</button>
      </ModalFooter>
    );

    const footer = screen.getByText('Action').parentElement;
    expect(footer).toHaveClass('custom-footer');
  });

  it('has correct base styles', () => {
    render(
      <ModalFooter>
        <button>Action</button>
      </ModalFooter>
    );

    const footer = screen.getByText('Action').parentElement;
    expect(footer).toHaveClass('flex', 'items-center', 'justify-end', 'gap-3');
  });
});
