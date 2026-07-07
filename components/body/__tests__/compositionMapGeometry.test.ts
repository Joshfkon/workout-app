/**
 * compositionMapGeometry — pixel-space direction cues for the Composition
 * Map: arrowhead placement/rotation along travel direction, and label
 * placement that stays inside the plot and flips to the other side of the
 * point instead of colliding with reference lines or axis text.
 */

import {
  arrowAt,
  pointToSegmentDistance,
  placeLabel,
  estimateTextWidth,
  type PlotRect,
} from '@/components/body/compositionMapGeometry';

const PLOT: PlotRect = { left: 40, right: 400, top: 20, bottom: 300 };

describe('arrowAt', () => {
  it('sits at the segment midpoint pointing along travel direction', () => {
    const arrow = arrowAt({ x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect(arrow).toMatchObject({ x: 50, y: 0, angleDeg: 0 });
  });

  it('rotates with the segment (SVG y-down: downward = +90°)', () => {
    expect(arrowAt({ x: 0, y: 0 }, { x: 0, y: 10 })!.angleDeg).toBeCloseTo(90, 5);
    expect(arrowAt({ x: 0, y: 0 }, { x: -10, y: 0 })!.angleDeg).toBeCloseTo(180, 5);
    // Up-and-right travel (gaining FFMI while gaining FMI) points up-right.
    expect(arrowAt({ x: 0, y: 100 }, { x: 100, y: 0 })!.angleDeg).toBeCloseTo(-45, 5);
  });

  it('returns null for a zero-length segment (no direction to show)', () => {
    expect(arrowAt({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });
});

describe('pointToSegmentDistance', () => {
  it('measures perpendicular distance inside the segment span', () => {
    expect(
      pointToSegmentDistance({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })
    ).toBe(10);
  });

  it('measures to the nearest endpoint beyond the span', () => {
    expect(
      pointToSegmentDistance({ x: 130, y: 40 }, { x: 0, y: 0 }, { x: 100, y: 0 })
    ).toBeCloseTo(50, 5);
  });
});

describe('placeLabel', () => {
  it('prefers right-above the point when nothing is in the way', () => {
    const placement = placeLabel({ x: 100, y: 265 }, PLOT, "Start · Mar '25");
    expect(placement.side).toBe('right-above');
    expect(placement.anchor).toBe('start');
    expect(placement.x).toBeGreaterThan(100);
    expect(placement.y).toBeLessThan(265);
  });

  it('flips to the left of the point near the right plot edge', () => {
    const placement = placeLabel({ x: 395, y: 150 }, PLOT, 'Now · Jun 2');
    expect(placement.anchor).toBe('end');
    expect(placement.x).toBeLessThan(395);
  });

  it('lands left-below for a point in the top-right corner', () => {
    const placement = placeLabel({ x: 388, y: 27 }, PLOT, 'Now · Jun 2');
    expect(placement.side).toBe('left-below');
    expect(placement.y).toBeGreaterThan(27);
  });

  it('flips off a reference line running under the preferred spot', () => {
    const point = { x: 100, y: 265 };
    // Horizontal line right where the right-above label would sit.
    const placement = placeLabel(point, PLOT, 'Start', {
      avoidLines: [{ x1: PLOT.left, y1: 252, x2: PLOT.right, y2: 252 }],
    });
    expect(placement.side).not.toBe('right-above');
  });

  it('always returns a placement, even when every candidate is cramped', () => {
    const tiny: PlotRect = { left: 0, right: 30, top: 0, bottom: 20 };
    const placement = placeLabel({ x: 15, y: 10 }, tiny, 'A long label that fits nowhere');
    expect(placement.anchor).toMatch(/start|end/);
    expect(Number.isFinite(placement.x)).toBe(true);
  });

  it('estimates width proportionally to text length', () => {
    expect(estimateTextWidth('ab', 10)).toBeLessThan(estimateTextWidth('abcd', 10));
  });
});
