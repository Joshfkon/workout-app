/**
 * Pinned "Log set" bar (UX panel: the in-card button sat below the fold at
 * phone width). The bar shows only while the card's own button is below the
 * visible area, and it logs through the SAME handler — one tap, one log.
 */

import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetLoggerRow, STICKY_LOG_SLOT_ID } from '../SetLoggerRow';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ioCallback: IOCallback | null = null;
let observed: Element[] = [];

beforeEach(() => {
  ioCallback = null;
  observed = [];
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: IOCallback) {
      ioCallback = cb;
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  document.getElementById(STICKY_LOG_SLOT_ID)?.remove();
});

const VIEWPORT = { top: 0, bottom: 844 } as DOMRectReadOnly;

/** Report the in-card button's position to the observer. */
function reportButton(where: 'below' | 'visible' | 'above') {
  const rect =
    where === 'below'
      ? { top: 900, bottom: 952 }
      : where === 'above'
        ? { top: -200, bottom: -148 }
        : { top: 600, bottom: 652 };
  act(() => {
    ioCallback?.([
      {
        isIntersecting: where === 'visible',
        intersectionRatio: where === 'visible' ? 1 : 0,
        boundingClientRect: rect as DOMRectReadOnly,
        rootBounds: VIEWPORT,
      },
    ]);
  });
}

const baseProps = {
  setNumber: 2,
  weight: '135',
  reps: '8',
  onWeightChange: jest.fn(),
  onRepsChange: jest.fn(),
  targetRir: 2,
  unit: 'lb' as const,
  stickyLabel: 'Bench Press',
};

describe('SetLoggerRow pinned Log set bar', () => {
  it('observes the in-card Log set button', () => {
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} />);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(screen.getByRole('button', { name: 'Log set' }));
  });

  it('is hidden while the in-card button is on screen', () => {
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} />);
    reportButton('visible');
    expect(screen.queryByTestId('sticky-log-set')).not.toBeInTheDocument();
  });

  it('shows when the in-card button is below the fold, with what it will log', () => {
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} />);
    reportButton('below');
    const bar = screen.getByTestId('sticky-log-set');
    expect(bar).toHaveTextContent('Bench Press · Set 2');
    expect(bar).toHaveTextContent('135 lbs × 8 reps · 2 left');
    // Scrolling the real button into view hides the bar again.
    reportButton('visible');
    expect(screen.queryByTestId('sticky-log-set')).not.toBeInTheDocument();
  });

  it('stays hidden when the button scrolled off the TOP (lifter moved on)', () => {
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} />);
    reportButton('above');
    expect(screen.queryByTestId('sticky-log-set')).not.toBeInTheDocument();
  });

  it('logs once through the same handler, with the same payload as the in-card button', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SetLoggerRow {...baseProps} onLog={onLog} />);
    reportButton('below');

    await user.click(
      within(screen.getByTestId('sticky-log-set')).getByRole('button', { name: /^Log set 2/ })
    );
    expect(onLog).toHaveBeenCalledTimes(1);
    const fromSticky = onLog.mock.calls[0][0];

    onLog.mockClear();
    await user.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toEqual(fromSticky);
  });

  it('is disabled exactly when the in-card button is (the parent in-flight lock)', () => {
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} disabled />);
    reportButton('below');
    expect(
      within(screen.getByTestId('sticky-log-set')).getByRole('button', { name: /^Log set 2/ })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
  });

  it('portals into the workout page bottom-chrome slot when it exists', () => {
    const slot = document.createElement('div');
    slot.id = STICKY_LOG_SLOT_ID;
    document.body.appendChild(slot);
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} />);
    reportButton('below');
    expect(slot).toContainElement(screen.getByTestId('sticky-log-set'));
  });

  it('steps aside while a weight/reps field is being typed into', async () => {
    const user = userEvent.setup();
    render(<SetLoggerRow {...baseProps} onLog={jest.fn()} />);
    reportButton('below');
    expect(screen.getByTestId('sticky-log-set')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Reps: 8 reps\. Tap to type/ }));
    expect(screen.queryByTestId('sticky-log-set')).not.toBeInTheDocument();
  });
});
