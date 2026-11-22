import { act, render, screen } from '@testing-library/react';
import { ToastContainer, toastPlacementClasses } from '../Toast';
import { openOverlay } from '@/lib/ui/overlayRegistry';

const toasts = [{ id: 't1', type: 'success' as const, message: 'Added Banana to Lunch', duration: 0 }];

describe('ToastContainer placement with an open sheet', () => {
  it('sits at the bottom with no sheet open', () => {
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);
    const container = screen.getByTestId('toast-container');
    expect(container).toHaveAttribute('data-placement', 'bottom');
    expect(container.className).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]');
  });

  it('moves to the top, clear of the close button, while a sheet is open', () => {
    let release: () => void = () => {};
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);
    act(() => {
      release = openOverlay();
    });
    const container = screen.getByTestId('toast-container');
    expect(container).toHaveAttribute('data-placement', 'top');
    expect(container.className).not.toContain('bottom-[calc');
    expect(container.className).toContain('right-16');

    act(() => release());
    expect(screen.getByTestId('toast-container')).toHaveAttribute('data-placement', 'bottom');
  });

  it('keeps the desktop top-right stack either way', () => {
    for (const open of [true, false]) {
      expect(toastPlacementClasses(open)).toContain('sm:top-4');
      expect(toastPlacementClasses(open)).toContain('sm:right-4');
    }
  });
});
