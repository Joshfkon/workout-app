/**
 * compositionMapGeometry — pixel-space direction cues for the Composition
 * Map: arrowhead placement/rotation along travel direction, rect-vs-geometry
 * intersection tests, and 8-candidate label placement that dodges the path,
 * trail, points, and reference lines — falling back to `clear: false` (the
 * caller adds a background pill) instead of fading or dropping the label.
 */

import {
  arrowAt,
  pointToSegmentDistance,
  placeLabel,
  estimateTextWidth,
  labelBox,
  rectIntersectsSegment,
  rectIntersectsCircle,
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

describe('rectIntersectsSegment', () => {
  const rect = labelBox(100, 100, 'start', 50, 11); // x [100,150], y [89,100]

  it('detects a segment crossing straight through', () => {
    expect(rectIntersectsSegment(rect, { x: 90, y: 95 }, { x: 160, y: 95 })).toBe(true);
  });

  it('detects a diagonal cutting a corner', () => {
    expect(rectIntersectsSegment(rect, { x: 95, y: 85 }, { x: 110, y: 105 })).toBe(true);
  });

  it('detects an endpoint inside the rect', () => {
    expect(rectIntersectsSegment(rect, { x: 120, y: 95 }, { x: 300, y: 300 })).toBe(true);
  });

  it('rejects a segment passing cleanly by', () => {
    expect(rectIntersectsSegment(rect, { x: 0, y: 200 }, { x: 400, y: 200 })).toBe(false);
    expect(rectIntersectsSegment(rect, { x: 160, y: 0 }, { x: 160, y: 300 })).toBe(false);
    // Diagonal near, but not touching, the corner.
    expect(rectIntersectsSegment(rect, { x: 40, y: 84 }, { x: 98, y: 26 })).toBe(false);
  });
});

describe('rectIntersectsCircle', () => {
  const rect = labelBox(100, 100, 'start', 50, 11);

  it('detects overlap via the nearest rect point', () => {
    expect(rectIntersectsCircle(rect, { x: 95, y: 95 }, 6)).toBe(true); // left edge
    expect(rectIntersectsCircle(rect, { x: 125, y: 95 }, 3)).toBe(true); // inside
  });

  it('rejects a circle clear of the rect', () => {
    expect(rectIntersectsCircle(rect, { x: 95, y: 95 }, 4)).toBe(false);
    expect(rectIntersectsCircle(rect, { x: 200, y: 200 }, 20)).toBe(false);
  });
});

describe('placeLabel', () => {
  it('prefers right-above the point when nothing is in the way', () => {
    const placement = placeLabel({ x: 100, y: 265 }, PLOT, "Start · Mar '25");
    expect(placement.side).toBe('right-above');
    expect(placement.anchor).toBe('start');
    expect(placement.clear).toBe(true);
    expect(placement.x).toBeGreaterThan(100);
    expect(placement.y).toBeLessThan(265);
  });

  it('flips to the left of the point near the right plot edge', () => {
    const placement = placeLabel({ x: 395, y: 150 }, PLOT, 'Now · Jun 2');
    expect(placement.anchor).toBe('end');
    expect(placement.clear).toBe(true);
    expect(placement.x).toBeLessThan(395);
  });

  it('lands left-below for a point in the top-right corner', () => {
    const placement = placeLabel({ x: 388, y: 27 }, PLOT, 'Now · Jun 2');
    expect(placement.side).toBe('left-below');
    expect(placement.y).toBeGreaterThan(27);
  });

  it('dodges a path segment running under the preferred spot', () => {
    const point = { x: 100, y: 265 };
    // Horizontal segment right where the right-above label would sit.
    const placement = placeLabel(point, PLOT, 'Start', {
      avoidSegments: [{ x1: PLOT.left, y1: 252, x2: PLOT.right, y2: 252 }],
    });
    expect(placement.side).not.toBe('right-above');
    expect(placement.clear).toBe(true);
  });

  it('dodges point markers, not just lines', () => {
    const point = { x: 100, y: 265 };
    // A big marker sitting right-above forces the label elsewhere.
    const placement = placeLabel(point, PLOT, 'May', {
      avoidPoints: [{ x: 125, y: 252, r: 9 }],
    });
    expect(placement.side).not.toBe('right-above');
    expect(placement.clear).toBe(true);
  });

  it('reports clear: false when every candidate collides (caller adds a pill)', () => {
    const point = { x: 200, y: 150 };
    // Dense hatch of segments over the whole neighborhood.
    const avoidSegments = Array.from({ length: 40 }, (_, i) => ({
      x1: 120,
      y1: 100 + i * 3,
      x2: 280,
      y2: 100 + i * 3,
    }));
    const placement = placeLabel(point, PLOT, 'Dec', { avoidSegments });
    expect(placement.clear).toBe(false);
    expect(Number.isFinite(placement.x)).toBe(true);
    expect(placement.anchor).toMatch(/start|middle|end/);
  });

  it('always returns a placement, even when every candidate is cramped', () => {
    const tiny: PlotRect = { left: 0, right: 30, top: 0, bottom: 20 };
    const placement = placeLabel({ x: 15, y: 10 }, tiny, 'A long label that fits nowhere');
    expect(placement.clear).toBe(false);
    expect(Number.isFinite(placement.x)).toBe(true);
  });

  it('estimates width proportionally to text length', () => {
    expect(estimateTextWidth('ab', 10)).toBeLessThan(estimateTextWidth('abcd', 10));
  });
});
