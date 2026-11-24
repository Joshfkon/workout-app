/**
 * The "Set N logged · Undo" toast joins the workout's fixed bottom stack and
 * grew it upward over the logger for 5 s (UX panel round 20). The page now
 * scrolls the logger clear by exactly the overlap.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { scrollToClear, shouldClearAfterGrowth, CLEAR_AFTER_TAP_MS, useKeepLoggerClearOfBottomChrome } from '../bottomChromeClearance';

describe('scrollToClear', () => {
  it('is 0 when the target already sits above the stack', () => {
    expect(scrollToClear({ top: 300, bottom: 500 }, 600)).toBe(0);
  });

  it('scrolls by the overlap plus the gap', () => {
    // Stack top moved up to 520 (toast arrived); logger bottom at 560.
    expect(scrollToClear({ top: 300, bottom: 560 }, 520)).toBe(48);
  });

  it('never pushes the target’s top off the screen', () => {
    expect(scrollToClear({ top: 30, bottom: 700 }, 500)).toBe(22);
  });

  it('leaves a target wholly below the stack alone (the pinned bar covers it)', () => {
    expect(scrollToClear({ top: 700, bottom: 900 }, 600)).toBe(0);
  });
});

describe('shouldClearAfterGrowth', () => {
  it('only right after a logger tap, and not once the lifter has scrolled', () => {
    expect(shouldClearAfterGrowth(1000, null, null)).toBe(false);
    expect(shouldClearAfterGrowth(1000, 500, null)).toBe(true);
    expect(shouldClearAfterGrowth(500 + CLEAR_AFTER_TAP_MS + 1, 500, null)).toBe(false);
    expect(shouldClearAfterGrowth(1000, 500, 700)).toBe(false);
    expect(shouldClearAfterGrowth(1000, 500, 400)).toBe(true);
  });
});

describe('useKeepLoggerClearOfBottomChrome', () => {
  let resizeCb: (() => void) | null = null;
  let stackHeight = 80;
  let stackTop = 760;
  const scrollBy = jest.fn();

  beforeEach(() => {
    resizeCb = null;
    stackHeight = 80;
    stackTop = 760;
    scrollBy.mockClear();
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        resizeCb = cb;
      }
      observe() {}
      disconnect() {}
    };
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  });
  afterEach(() => {
    delete (global as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  });

  function Page() {
    const ref = useKeepLoggerClearOfBottomChrome();
    return (
      <div>
        <div data-active-logger="" data-testid="logger" />
        <div ref={ref} data-testid="stack" />
      </div>
    );
  }

  function setup() {
    const utils = render(<Page />);
    const stack = utils.getByTestId('stack');
    const logger = utils.getByTestId('logger');
    stack.getBoundingClientRect = () => ({ top: stackTop, height: stackHeight, bottom: stackTop + stackHeight } as DOMRect);
    logger.getBoundingClientRect = () => ({ top: 500, bottom: 740 } as DOMRect);
    return utils;
  }

  it('scrolls the logger clear when a toast makes the stack taller right after a tap in the logger', () => {
    const { getByTestId } = setup();
    fireEvent.pointerDown(getByTestId('logger'));
    // The observer attached with the stack's first height; now a toast joins.
    stackHeight = 150;
    stackTop = 690;
    act(() => resizeCb?.());
    expect(scrollBy).toHaveBeenCalledWith({ top: 58, behavior: 'smooth' });
  });

  it('never pulls the lifter back down after they scroll (user report)', () => {
    const { getByTestId } = setup();
    // Scrolling up with no tap: the pinned Log set bar joins the stack.
    stackHeight = 150;
    stackTop = 690;
    act(() => resizeCb?.());
    expect(scrollBy).not.toHaveBeenCalled();
    // A tap, then a scroll before the stack grows: the scroll wins.
    fireEvent.pointerDown(getByTestId('logger'));
    fireEvent.touchMove(window);
    stackHeight = 220;
    stackTop = 620;
    act(() => resizeCb?.());
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does nothing when the stack shrinks, even over the logger', () => {
    setup();
    // Settle on a tall stack first (that growth may scroll), then shrink.
    stackHeight = 200;
    stackTop = 640;
    act(() => resizeCb?.());
    scrollBy.mockClear();
    stackHeight = 120;
    stackTop = 700; // still over the logger's bottom (740)
    act(() => resizeCb?.());
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
