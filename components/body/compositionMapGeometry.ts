/**
 * compositionMapGeometry — pixel-space helpers for the Composition Map's
 * direction cues (arrowheads, endpoint/target labels). Pure math, no React,
 * no Recharts — unit-testable without a chart.
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

/** A line segment labels must keep clear of (iso-BMI diagonals, FFMI
 * threshold lines), in pixels. */
export interface AvoidLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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

export interface LabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  /** Which candidate won — 'right-above' | 'right-below' | 'left-above' | 'left-below'. */
  side: string;
}

export interface PlaceLabelOptions {
  /** Lines the label must keep ~8px clear of. */
  avoidLines?: AvoidLine[];
  fontSize?: number;
  /** Minimum clearance between the label box and an avoid line. */
  clearance?: number;
}

/** Rough text width for the chart's small labels (no canvas in SSR/jsdom). */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

interface Candidate {
  side: string;
  dx: number;
  dy: number;
  anchor: 'start' | 'end';
}

// Preference order: right-above reads most naturally next to a point; flip
// below / to the left only when the preferred spot would leave the plot or
// sit on a reference line.
const CANDIDATES: Candidate[] = [
  { side: 'right-above', dx: 10, dy: -8, anchor: 'start' },
  { side: 'right-below', dx: 10, dy: 14, anchor: 'start' },
  { side: 'left-above', dx: -10, dy: -8, anchor: 'end' },
  { side: 'left-below', dx: -10, dy: 14, anchor: 'end' },
];

/**
 * Choose a label position next to `point` that stays inside the plot area
 * and clear of the given reference lines: try right-above first, then flip
 * to the other side of the point. Falls back to the least-bad candidate
 * when nothing fully clears (never returns nothing — a slightly overlapped
 * label beats a missing one).
 */
export function placeLabel(
  point: PxPoint,
  plot: PlotRect,
  text: string,
  options: PlaceLabelOptions = {}
): LabelPlacement {
  const fontSize = options.fontSize ?? 9;
  const clearance = options.clearance ?? 8;
  const avoidLines = options.avoidLines ?? [];
  const width = estimateTextWidth(text, fontSize);
  const height = fontSize + 2;

  let best: { candidate: Candidate; score: number } | null = null;

  for (const candidate of CANDIDATES) {
    const tx = point.x + candidate.dx;
    const ty = point.y + candidate.dy;
    const x0 = candidate.anchor === 'start' ? tx : tx - width;
    const x1 = x0 + width;
    const y1 = ty; // text baseline
    const y0 = ty - height;

    const insidePlot =
      x0 >= plot.left && x1 <= plot.right && y0 >= plot.top && y1 <= plot.bottom;

    // Clearance from reference lines, measured at the label box center.
    const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const minLineDistance = avoidLines.reduce(
      (min, line) =>
        Math.min(
          min,
          pointToSegmentDistance(center, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 })
        ),
      Infinity
    );
    const clearOfLines = minLineDistance >= clearance;

    if (insidePlot && clearOfLines) {
      return { x: tx, y: ty, anchor: candidate.anchor, side: candidate.side };
    }

    // Score fallbacks: staying inside the plot matters more than line
    // clearance (an off-plot label is clipped invisible).
    const score = (insidePlot ? 1000 : 0) + Math.min(minLineDistance, 100);
    if (!best || score > best.score) best = { candidate, score };
  }

  const fallback = best?.candidate ?? CANDIDATES[0];
  return {
    x: point.x + fallback.dx,
    y: point.y + fallback.dy,
    anchor: fallback.anchor,
    side: fallback.side,
  };
}
