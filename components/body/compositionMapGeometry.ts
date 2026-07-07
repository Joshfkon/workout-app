/**
 * compositionMapGeometry — pixel-space helpers for the Composition Map's
 * direction cues (arrowheads, endpoint/target labels). Pure math, no React,
 * no Recharts — unit-testable without a chart.
 *
 * Label placement tries 8 candidate offsets around a point and picks the
 * first whose bounding box intersects none of the nearby geometry — path
 * segments, the estimate trail, scan points, and reference lines — not just
 * other labels. When every candidate collides, the caller renders the label
 * on a background pill instead of fading or dropping it (`clear: false`).
 *
 * Domain-space geometry (FMI/FFMI points, iso-BMI clipping, goal projection)
 * lives in services/compositionSpace; this module only deals in pixels.
 */

export interface PxPoint {
  x: number;
  y: number;
}

/** The chart's plot area in pixels (inside the axes). */
export interface PlotRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A segment labels must keep clear of (path, trail, reference lines). */
export interface AvoidLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A circular marker labels must keep clear of. */
export interface AvoidPoint {
  x: number;
  y: number;
  r: number;
}

export interface ArrowPlacement {
  /** Arrow center (segment midpoint). */
  x: number;
  y: number;
  /** Travel direction in SVG degrees (0 = +x, clockwise positive). */
  angleDeg: number;
}

/**
 * Arrowhead for a path segment: sits at the midpoint, points from `from`
 * toward `to`. Null for a zero-length segment (no direction to show).
 */
export function arrowAt(from: PxPoint, to: PxPoint): ArrowPlacement | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** Distance from a point to a line segment. */
export function pointToSegmentDistance(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Axis-aligned label bounding box. */
export interface LabelBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Box for text drawn at baseline (x, y) with the given anchor. */
export function labelBox(
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end',
  width: number,
  height: number
): LabelBox {
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x0, x1: x0 + width, y0: y - height, y1: y };
}

function orientation(a: PxPoint, b: PxPoint, c: PxPoint): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function segmentsIntersect(p1: PxPoint, p2: PxPoint, p3: PxPoint, p4: PxPoint): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  // Collinear overlaps: fall back to bbox checks.
  const onSeg = (a: PxPoint, b: PxPoint, c: PxPoint) =>
    orientation(a, b, c) === 0 &&
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y);
  return onSeg(p1, p2, p3) || onSeg(p1, p2, p4) || onSeg(p3, p4, p1) || onSeg(p3, p4, p2);
}

/** Does a segment touch an axis-aligned rectangle? */
export function rectIntersectsSegment(rect: LabelBox, a: PxPoint, b: PxPoint): boolean {
  // Quick reject: both endpoints strictly on the same outside side.
  if (a.x < rect.x0 && b.x < rect.x0) return false;
  if (a.x > rect.x1 && b.x > rect.x1) return false;
  if (a.y < rect.y0 && b.y < rect.y0) return false;
  if (a.y > rect.y1 && b.y > rect.y1) return false;
  const inside = (p: PxPoint) =>
    p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
  if (inside(a) || inside(b)) return true;
  const corners: PxPoint[] = [
    { x: rect.x0, y: rect.y0 },
    { x: rect.x1, y: rect.y0 },
    { x: rect.x1, y: rect.y1 },
    { x: rect.x0, y: rect.y1 },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/** Does a circle touch an axis-aligned rectangle? */
export function rectIntersectsCircle(rect: LabelBox, c: PxPoint, r: number): boolean {
  const nx = Math.max(rect.x0, Math.min(c.x, rect.x1));
  const ny = Math.max(rect.y0, Math.min(c.y, rect.y1));
  return (nx - c.x) ** 2 + (ny - c.y) ** 2 <= r * r;
}

export interface LabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  /** Which candidate won, e.g. 'right-above'. */
  side: string;
  /** False when every candidate collided with geometry — render the label
   * on a background pill instead of hoping for the best. */
  clear: boolean;
}

export interface PlaceLabelOptions {
  /** Segments the label must not touch: path, trail, reference lines. */
  avoidSegments?: AvoidLine[];
  /** Circular markers the label must not touch. */
  avoidPoints?: AvoidPoint[];
  fontSize?: number;
  /** Padding added around the label box before intersection tests. */
  clearance?: number;
  /** Number of text lines in the label block (default 1). The placement's
   * y is the FIRST line's baseline; further lines stack downward, and
   * above-the-point candidates shift up so the whole block clears it. */
  lineCount?: number;
}

/** Rough text width for the chart's small labels (no canvas in SSR/jsdom). */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

interface Candidate {
  side: string;
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
}

// 8 positions around the point. Preference order: right-above reads most
// naturally, then flips across the point, then the straight compass spots.
const CANDIDATES: Candidate[] = [
  { side: 'right-above', dx: 10, dy: -8, anchor: 'start' },
  { side: 'right-below', dx: 10, dy: 14, anchor: 'start' },
  { side: 'left-above', dx: -10, dy: -8, anchor: 'end' },
  { side: 'left-below', dx: -10, dy: 14, anchor: 'end' },
  { side: 'above', dx: 0, dy: -12, anchor: 'middle' },
  { side: 'below', dx: 0, dy: 18, anchor: 'middle' },
  { side: 'right', dx: 12, dy: 3, anchor: 'start' },
  { side: 'left', dx: -12, dy: 3, anchor: 'end' },
];

/**
 * Choose a label position next to `point`: the first of 8 candidates whose
 * (slightly inflated) bounding box stays inside the plot and intersects no
 * avoid-geometry. When all fail, returns the least-colliding candidate with
 * `clear: false` so the caller can add a background pill.
 */
export function placeLabel(
  point: PxPoint,
  plot: PlotRect,
  text: string,
  options: PlaceLabelOptions = {}
): LabelPlacement {
  const fontSize = options.fontSize ?? 9;
  const clearance = options.clearance ?? 3;
  const avoidSegments = options.avoidSegments ?? [];
  const avoidPoints = options.avoidPoints ?? [];
  const lineCount = Math.max(1, options.lineCount ?? 1);
  const lineHeight = fontSize + 2;
  const width = estimateTextWidth(text, fontSize);
  const height = lineHeight * lineCount;

  let best: { candidate: Candidate; score: number } | null = null;

  for (const candidate of CANDIDATES) {
    const tx = point.x + candidate.dx;
    // Above-the-point spots lift by the extra lines so the block, not just
    // the first line, clears the point.
    const ty =
      point.y +
      (candidate.dy < 0 ? candidate.dy - (lineCount - 1) * lineHeight : candidate.dy);
    // Box spans from the first line's top to the last line's baseline.
    const box = labelBox(tx, ty + (lineCount - 1) * lineHeight, candidate.anchor, width, height);
    const inflated: LabelBox = {
      x0: box.x0 - clearance,
      x1: box.x1 + clearance,
      y0: box.y0 - clearance,
      y1: box.y1 + clearance,
    };

    const insidePlot =
      box.x0 >= plot.left && box.x1 <= plot.right && box.y0 >= plot.top && box.y1 <= plot.bottom;

    let collisions = 0;
    for (const seg of avoidSegments) {
      if (
        rectIntersectsSegment(inflated, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 })
      ) {
        collisions++;
      }
    }
    for (const p of avoidPoints) {
      if (rectIntersectsCircle(inflated, p, p.r + 1)) collisions++;
    }

    if (insidePlot && collisions === 0) {
      return { x: tx, y: ty, anchor: candidate.anchor, side: candidate.side, clear: true };
    }

    // Fallback scoring: staying inside the plot matters more than collision
    // count (an off-plot label is clipped invisible).
    const score = (insidePlot ? 1000 : 0) - collisions;
    if (!best || score > best.score) best = { candidate, score };
  }

  const fallback = best?.candidate ?? CANDIDATES[0];
  return {
    x: point.x + fallback.dx,
    y:
      point.y +
      (fallback.dy < 0 ? fallback.dy - (lineCount - 1) * lineHeight : fallback.dy),
    anchor: fallback.anchor,
    side: fallback.side,
    clear: false,
  };
}
