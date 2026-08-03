/**
 * The overlay registry is what lets app chrome (the resume-workout pill) get
 * out of the way of an open modal/sheet, so its counting has to be exact:
 * a leaked count hides the pill forever, an early drop puts it back on top
 * of a sheet that's still open.
 */

import {
  getOpenOverlayCount,
  openOverlay,
  resetOverlayRegistry,
  subscribeOverlays,
} from '../overlayRegistry';

describe('overlayRegistry', () => {
  afterEach(() => {
    resetOverlayRegistry();
  });

  it('starts closed', () => {
    expect(getOpenOverlayCount()).toBe(0);
  });

  it('counts nested overlays and only reports closed once all release', () => {
    const releaseSheet = openOverlay();
    const releaseModal = openOverlay();
    expect(getOpenOverlayCount()).toBe(2);

    releaseModal();
    expect(getOpenOverlayCount()).toBe(1);

    releaseSheet();
    expect(getOpenOverlayCount()).toBe(0);
  });

  it('ignores a repeated release (StrictMode double-invokes effect cleanups)', () => {
    const releaseA = openOverlay();
    const releaseB = openOverlay();

    releaseA();
    releaseA();
    releaseA();

    // B is still open — the extra releases must not have decremented it away.
    expect(getOpenOverlayCount()).toBe(1);
    releaseB();
    expect(getOpenOverlayCount()).toBe(0);
  });

  it('notifies subscribers on open and close, and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeOverlays(listener);

    const release = openOverlay();
    expect(listener).toHaveBeenCalledTimes(1);

    release();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    openOverlay()();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
