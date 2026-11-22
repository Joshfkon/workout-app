/**
 * Long-page snapshots are cut around what's on screen, so scrolling changes
 * what the persona can reach (a head cut hid a workout's Log set button).
 */
import { windowLines } from '../lib/agent.mjs';

const lines = Array.from({ length: 100 }, (_, i) => `line ${String(i).padStart(2, '0')} xxxxxxxx`); // 18 chars each

describe('windowLines', () => {
  it('centres the window on the visible lines, not the top of the page', () => {
    const w = windowLines(lines, [60, 61, 62], 200)!;
    expect(w.lo).toBeLessThanOrEqual(60);
    expect(w.hi).toBeGreaterThanOrEqual(62);
    expect(w.lo).toBeGreaterThan(40);
  });

  it('stays within the budget', () => {
    const w = windowLines(lines, [50], 200)!;
    expect(lines.slice(w.lo, w.hi + 1).join('\n').length).toBeLessThanOrEqual(200);
  });

  it('uses the whole page when it fits, and returns null with nothing on screen', () => {
    expect(windowLines(lines.slice(0, 5), [2], 10000)).toEqual({ lo: 0, hi: 4, extras: [] });
    expect(windowLines(lines, [], 200)).toBeNull();
  });

  it('grows downward when the visible part is at the top', () => {
    const w = windowLines(lines, [0, 1], 200)!;
    expect(w.lo).toBe(0);
    expect(w.hi).toBeGreaterThan(5);
  });

  it('ignores fixed bars at the ends of the DOM when centring, but keeps them', () => {
    // header at line 1, tab bar at line 98, the screen's content around 60
    const w = windowLines(lines, [1, 58, 60, 62, 98], 200)!;
    expect(w.lo).toBeGreaterThan(40);
    expect(w.hi).toBeLessThan(80);
    expect(w.extras).toEqual([1, 98]);
  });
});
