/**
 * Tests for components/ui/Sheet.tsx — the shared bottom sheet behind Modal
 * and the workout BottomSheet.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Sheet } from '../Sheet';
import { BottomSheet } from '@/components/workout/BottomSheet';

function touch(el: Element, type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) {
  fireEvent[type](el, { touches: [{ clientY: y }] });
}

describe('Sheet', () => {
  const base = { isOpen: true, onClose: jest.fn(), children: <p>Body</p> };
  beforeEach(() => jest.clearAllMocks());

  it('renders a labelled dialog with a grabber and close button', () => {
    render(<Sheet {...base} title="Log weight" />);
    const dialog = screen.getByRole('dialog', { name: 'Log weight' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('rounded-t-sheet', 'animate-sheet-up');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('uses aria-label when there is no title', () => {
    render(<Sheet {...base} ariaLabel="Plates" showCloseButton={false} />);
    expect(screen.getByRole('dialog', { name: 'Plates' })).toBeInTheDocument();
  });

  it('renders a sticky footer when given', () => {
    render(<Sheet {...base} footer={<button>Save</button>} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('closes when dragged down from the header past the threshold', () => {
    const onClose = jest.fn();
    render(<Sheet {...base} onClose={onClose} title="Drag me" />);
    const dialog = screen.getByRole('dialog');
    const header = screen.getByText('Drag me');
    touch(header, 'touchStart', 100);
    touch(dialog, 'touchMove', 220);
    touch(dialog, 'touchEnd', 220);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('springs back on a short drag', () => {
    const onClose = jest.fn();
    render(<Sheet {...base} onClose={onClose} title="Drag me" />);
    const dialog = screen.getByRole('dialog');
    touch(screen.getByText('Drag me'), 'touchStart', 100);
    touch(dialog, 'touchMove', 140);
    touch(dialog, 'touchEnd', 140);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('slides out before unmounting when motion is allowed', () => {
    jest.useFakeTimers();
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    try {
      const { rerender } = render(<Sheet {...base} title="Bye" />);
      rerender(<Sheet {...base} isOpen={false} title="Bye" />);
      expect(screen.getByRole('dialog')).toHaveClass('animate-sheet-down');
      act(() => {
        jest.advanceTimersByTime(250);
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
      jest.useRealTimers();
    }
  });

  it('unmounts immediately when the user prefers reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      const { rerender } = render(<Sheet {...base} title="Bye" />);
      rerender(<Sheet {...base} isOpen={false} title="Bye" />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('BottomSheet (workout)', () => {
  it('renders through the shared Sheet', () => {
    render(
      <BottomSheet isOpen onClose={jest.fn()} title="Set type">
        <p>Options</p>
      </BottomSheet>
    );
    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(sheet).toHaveClass('animate-sheet-up');
    expect(screen.getByRole('dialog', { name: 'Set type' })).toBe(sheet);
  });
});

describe('Sheet stacking (a sheet opened over another)', () => {
  const touchMove = (el: Element) => {
    const ev = new Event('touchmove', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };

  it('lets the top sheet take touches: the sheet underneath does not block them', () => {
    render(
      <>
        <Sheet isOpen onClose={jest.fn()} title="Describe meal">
          <p>below</p>
        </Sheet>
        <Sheet isOpen onClose={jest.fn()} title="Allow AI features?">
          <div data-allow-touch-move data-testid="top-content">long disclosure</div>
        </Sheet>
      </>
    );
    expect(touchMove(screen.getByTestId('top-content')).defaultPrevented).toBe(false);
  });

  it('Escape closes only the top sheet', () => {
    const lower = jest.fn();
    const upper = jest.fn();
    render(
      <>
        <Sheet isOpen onClose={lower} title="Lower"><p>x</p></Sheet>
        <Sheet isOpen onClose={upper} title="Upper"><p>x</p></Sheet>
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it('keeps the page scroll-locked until the last sheet closes', () => {
    const { rerender } = render(
      <>
        <Sheet isOpen onClose={jest.fn()} title="Lower"><p>x</p></Sheet>
        <Sheet isOpen onClose={jest.fn()} title="Upper"><p>x</p></Sheet>
      </>
    );
    rerender(
      <>
        <Sheet isOpen onClose={jest.fn()} title="Lower"><p>x</p></Sheet>
        <Sheet isOpen={false} onClose={jest.fn()} title="Upper"><p>x</p></Sheet>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <>
        <Sheet isOpen={false} onClose={jest.fn()} title="Lower"><p>x</p></Sheet>
        <Sheet isOpen={false} onClose={jest.fn()} title="Upper"><p>x</p></Sheet>
      </>
    );
    expect(document.body.style.overflow).toBe('');
  });
});
