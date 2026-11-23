/** The workout screen's one-toast-at-a-time mode and inline anchor. */
import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { nextToasts, ToastContainer, useToasts, type ToastItem } from '../Toast';
import { openOverlay } from '@/lib/ui/overlayRegistry';

const t = (id: string, type: ToastItem['type'] = 'success'): ToastItem => ({ id, type, message: id });

describe('nextToasts', () => {
  it('stack mode appends (app default unchanged)', () => {
    expect(nextToasts([t('a')], t('b'), 'stack').map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('single mode: a new toast replaces the current one', () => {
    expect(nextToasts([t('a')], t('b'), 'single').map((x) => x.id)).toEqual(['b']);
  });

  it('single mode: errors win — a non-error never replaces an error', () => {
    expect(nextToasts([t('err', 'error')], t('b'), 'single').map((x) => x.id)).toEqual(['err']);
    expect(nextToasts([t('a')], t('err', 'error'), 'single').map((x) => x.id)).toEqual(['err']);
    expect(nextToasts([t('e1', 'error')], t('e2', 'error'), 'single').map((x) => x.id)).toEqual(['e2']);
  });
});

describe('useToasts({ mode: "single" })', () => {
  it('keeps the newest toast and its Undo action', () => {
    const undo = jest.fn();
    const { result } = renderHook(() => useToasts({ mode: 'single' }));
    act(() => {
      result.current.showSuccess('Set 1 logged');
      result.current.addToast('success', 'Set 2 logged', 5000, { label: 'Undo', onClick: undo });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Set 2 logged');
    result.current.toasts[0].action?.onClick();
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe('ToastContainer anchor="inline"', () => {
  const toasts = [{ id: 't1', type: 'success' as const, message: 'Set 1 logged', duration: 0 }];

  it('renders in flow (no fixed layer) for a parent stack', () => {
    const { container } = render(
      <div data-testid="stack">
        <ToastContainer toasts={toasts} onDismiss={() => {}} anchor="inline" />
      </div>
    );
    const el = screen.getByTestId('toast-container');
    expect(el).toHaveAttribute('data-placement', 'inline');
    expect(el.className).not.toContain('fixed');
    expect(container.querySelector('[data-testid="stack"]')).toContainElement(el);
  });

  it('falls back to the viewport layer while a sheet is open', () => {
    let release: () => void = () => {};
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} anchor="inline" />);
    act(() => {
      release = openOverlay();
    });
    expect(screen.getByTestId('toast-container')).toHaveAttribute('data-placement', 'top');
    act(() => release());
  });
});
