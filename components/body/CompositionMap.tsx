'use client';

/**
 * Composition Map — body composition as a path through (FMI, FFMI) space.
 *
 *   x = Fat Mass Index (fat kg / height m²)
 *   y = FFMI (fat-free mass kg / height m², RAW — same computeFFM definition
 *       as the FFMI trend chart and gauge)
 *
 * FMI + FFMI = BMI, so iso-BMI diagonals are exact decomposition lines. DEXA
 * scans are the signal (emphasized points connected in date order); the
 * anchored daily estimate renders as a faint context trail STRICTLY between
 * the first and last scan — the map never extrapolates past the last scan
 * from interpolated data.
 *
 * All geometry (points, goal vector, p-ratio, noise gating, domains,
 * iso-BMI clipping) lives in services/compositionSpace — this file only
 * renders.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Customized,
} from 'recharts';
import {
  arrowAt,
  placeLabel,
  estimateTextWidth,
  type AvoidLine,
  type AvoidPoint,
  type LabelPlacement,
  type PlotRect,
} from '@/components/body/compositionMapGeometry';
import type { AnchoredTrendPoint } from '@/services/bodyCompAnchor';
import {
  buildCompositionPath,
  computeGoalVectorProgress,
  computeScanPairPRatios,
  classifyPartitioning,
  normalizeTargetPoint,
  selectStartPoint,
  visibleIsoBmiSegments,
  computeMapDomain,
  COMPOSITION_MAP_FFMI_THRESHOLDS,
  type CompositionObservation,
  type CompositionPoint,
  type CompositionCoords,
  type CompositionTargetInput,
  type ScanPairPRatio,
  type MapDomain,
} from '@/services/compositionSpace';
import { kgToLbs } from '@/lib/utils';
import type { Goal } from '@/types/schema';

interface CompositionMapProps {
  /** Anchored trend from useBodyCompTrend (dexa points + daily estimates). */
  trend: AnchoredTrendPoint[];
  heightCm: number;
  units: 'lb' | 'kg';
  /** Current training phase for p-ratio framing; null = no verdicts. */
  phase: Goal | null;
  /** Active composition target (normalized internally to an FMI/FFMI point). */
  target: CompositionTargetInput | null;
  /** Start of the current phase (e.g. active target's createdAt); enables
   * the phase / all-time start toggle for the progress scalar. */
  phaseStartDate: string | null;
}

const SCAN_COLOR = '#22d3ee';
const TRAIL_COLOR = '#818cf8';
/** Goal artifacts (marker, vector, labels) — green: "where you're heading". */
const GOAL_COLOR = '#4ade80';

/** Full-contrast Now label — never de-emphasized, whatever it lands on. */
export const NOW_LABEL_COLOR = '#f3f4f6';
export const START_LABEL_COLOR = '#d1d5db';
/** Pill behind key labels: chart background tone, slightly translucent so
 * geometry reads through around (not under) the text. */
export const LABEL_PILL_COLOR = '#111827';
export const LABEL_PILL_OPACITY = 0.88;

/**
 * Chart label with an optional background pill. The pill guarantees
 * legibility over any geometry the label lands on — used always for the
 * Start/Now/Target labels, and as the fallback for intermediate labels
 * whose 8 placement candidates all collided.
 */
function MapLabel({
  placement,
  lines,
  fill,
  fontSize = 9,
  fontWeight,
  pill,
  testid,
}: {
  placement: LabelPlacement;
  /** One entry per text line; placement.y is the first line's baseline. */
  lines: string[];
  fill: string;
  fontSize?: number;
  fontWeight?: number;
  pill: boolean;
  testid: string;
}) {
  const lineHeight = fontSize + 2;
  const width = Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)));
  const boxX =
    placement.anchor === 'start'
      ? placement.x
      : placement.anchor === 'end'
        ? placement.x - width
        : placement.x - width / 2;
  return (
    <g>
      {pill && (
        <rect
          data-testid={`${testid}-pill`}
          x={boxX - 4}
          y={placement.y - fontSize - 3}
          width={width + 8}
          height={lineHeight * lines.length + 4}
          rx={3}
          fill={LABEL_PILL_COLOR}
          fillOpacity={LABEL_PILL_OPACITY}
        />
      )}
      <text
        data-testid={testid}
        x={placement.x}
        y={placement.y}
        textAnchor={placement.anchor}
        fill={fill}
        fontSize={fontSize}
        fontWeight={fontWeight}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={placement.x} dy={i === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function formatDateShort(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** "Mar '25" for the Start endpoint label. */
export function formatMonthYear(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} '${String(
    d.getFullYear() % 100
  ).padStart(2, '0')}`;
}


function formatDeltaWeight(deltaKg: number, units: 'lb' | 'kg'): string {
  const value = units === 'lb' ? kgToLbs(deltaKg) : deltaKg;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} ${units}`;
}

/**
 * "Mar 3 → Jul 1: +2.2 lb, 68% lean" fraction part, phase-framed.
 *
 * Noise gating is per-component: the blanket "within measurement noise"
 * only applies when BOTH the lean and fat deltas sit inside DEXA
 * repeatability. One flat component with a clear weight change is itself
 * the finding — a −7.5 lb loss with lean unchanged is "essentially all
 * fat", not noise.
 */
function fractionText(pair: ScanPairPRatio): string {
  if (pair.suppressed) return 'Δ weight under 3 lb — p-ratio suppressed';
  if (pair.withinNoise) return 'within measurement noise';
  if (pair.leanWithinNoise) return 'essentially all fat';
  if (pair.fatWithinNoise) return 'essentially all lean';
  if (pair.deltaWeightKg > 0) {
    return `${Math.round((pair.leanFraction ?? 0) * 100)}% of gain was lean`;
  }
  return `${Math.round((pair.fatFraction ?? 0) * 100)}% of loss was fat`;
}

const VERDICT_STYLES: Record<string, string> = {
  excellent: 'text-success-400',
  good: 'text-primary-400',
  poor: 'text-warning-400',
};

function MapTooltip({
  active,
  payload,
  units,
}: {
  active?: boolean;
  payload?: Array<{ payload: CompositionPoint }>;
  units: 'lb' | 'kg';
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  if (!p?.date) return null;
  const weight = units === 'lb' ? `${kgToLbs(p.weightKg).toFixed(1)} lb` : `${p.weightKg.toFixed(1)} kg`;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f3f4f6' }}
    >
      <p className="font-medium">
        {new Date(`${p.date}T00:00:00`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </p>
      <p className="text-surface-300 mt-0.5">
        FFMI {p.ffmi.toFixed(1)} · FMI {p.fmi.toFixed(1)} · BMI {p.bmi.toFixed(1)}
      </p>
      <p className="text-surface-400">
        {p.bodyFatPercent.toFixed(1)}% BF · {weight}
      </p>
    </div>
  );
}

export interface DecorationsData {
  domain: MapDomain;
  scanPoints: CompositionPoint[];
  trailPoints: CompositionPoint[];
  targetPoint: CompositionCoords | null;
  /** Goal block lines, e.g. ["GOAL", "FFMI 21.0", "BF 13%", "FMI 3.6"];
   * null hides the goal label. */
  targetLabelLines: string[] | null;
  /** Rotated caption along the dashed vector, e.g. "Goal vector · 62%". */
  vectorLabel: string | null;
  showGoalVector: boolean;
  /** "Start · Mar '25" on the first scan. */
  startLabel: string;
  /** "Latest · Jun 2" on the latest scan. */
  nowLabel: string;
  /** Date labels on intermediate scans (only when ≤5 scans total). */
  showIntermediateLabels: boolean;
}

/**
 * Everything drawn under the scan points: iso-BMI diagonals, FFMI threshold
 * lines, the faint estimate trail, the gradient scan path with per-segment
 * arrowheads (travel direction), the Start/Now endpoint labels, and the
 * goal vector (latest → target). Rendered via Recharts <Customized> so we
 * can use raw SVG with the chart's own scales.
 *
 * Exported for tests: render the returned component inside an <svg> with
 * fake xAxisMap/yAxisMap scales.
 */
export function buildDecorations(data: DecorationsData) {
  // Recharts passes its internal chart state (axis maps with scales) to
  // Customized components; there's no public type for it.
  return function Decorations(props: Record<string, unknown>) {
    const xMap = props.xAxisMap as Record<string, { scale?: (v: number) => number }> | undefined;
    const yMap = props.yAxisMap as Record<string, { scale?: (v: number) => number }> | undefined;
    const xScale = xMap?.[Object.keys(xMap)[0]]?.scale;
    const yScale = yMap?.[Object.keys(yMap)[0]]?.scale;
    if (!xScale || !yScale) return null;

    const {
      domain,
      scanPoints,
      trailPoints,
      targetPoint,
      targetLabelLines,
      vectorLabel,
      showGoalVector,
      startLabel,
      nowLabel,
      showIntermediateLabels,
    } = data;
    const [x0, x1] = domain.x;
    const isoSegments = visibleIsoBmiSegments(domain);
    const px = (p: { fmi: number; ffmi: number }) => ({ x: xScale(p.fmi), y: yScale(p.ffmi) });

    // Plot rectangle + reference lines in pixels, for label collision
    // avoidance (labels must not sit on the BMI diagonals or FFMI lines,
    // nor leave the plot into the axis text).
    const plot: PlotRect = {
      left: Math.min(xScale(x0), xScale(x1)),
      right: Math.max(xScale(x0), xScale(x1)),
      top: Math.min(yScale(domain.y[0]), yScale(domain.y[1])),
      bottom: Math.max(yScale(domain.y[0]), yScale(domain.y[1])),
    };
    const visibleThresholds = COMPOSITION_MAP_FFMI_THRESHOLDS.filter(
      (t) => t > domain.y[0] && t < domain.y[1]
    );
    const toSegment = (a: { x: number; y: number }, b: { x: number; y: number }): AvoidLine => ({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
    // Labels avoid ALL chart geometry, not just reference lines: the scan
    // path, the estimate trail, and the point markers themselves.
    const avoidSegments: AvoidLine[] = [
      ...isoSegments.map((seg) =>
        toSegment({ x: xScale(seg.x1), y: yScale(seg.y1) }, { x: xScale(seg.x2), y: yScale(seg.y2) })
      ),
      ...visibleThresholds.map((t) => ({
        x1: plot.left,
        y1: yScale(t),
        x2: plot.right,
        y2: yScale(t),
      })),
      ...scanPoints.slice(1).map((p, i) => toSegment(px(scanPoints[i]), px(p))),
      ...trailPoints.slice(1).map((p, i) => toSegment(px(trailPoints[i]), px(p))),
    ];
    const avoidPoints: AvoidPoint[] = scanPoints.map((p, i) => ({
      ...px(p),
      r: i === scanPoints.length - 1 ? 9 : i === 0 ? 4.5 : 4,
    }));
    const avoidOptions = { avoidSegments, avoidPoints };

    const startPx = px(scanPoints[0]);
    const nowPx = px(scanPoints[scanPoints.length - 1]);
    const startPlacement = placeLabel(startPx, plot, startLabel, avoidOptions);
    const nowPlacement = placeLabel(nowPx, plot, nowLabel, avoidOptions);

    return (
      <g>
        {/* Iso-BMI diagonals: fmi + ffmi = const — lightly styled. */}
        {isoSegments.map((seg) => (
          <g key={`iso-${seg.bmi}`}>
            <line
              x1={xScale(seg.x1)}
              y1={yScale(seg.y1)}
              x2={xScale(seg.x2)}
              y2={yScale(seg.y2)}
              stroke="#6b7280"
              strokeDasharray="4 4"
              strokeOpacity={0.3}
            />
            <text
              x={xScale(seg.x1) + 4}
              y={yScale(seg.y1) + 10}
              fill="#6b7280"
              fontSize={9}
              opacity={0.8}
            >
              BMI {seg.bmi}
            </text>
          </g>
        ))}

        {/* FFMI reference thresholds — same values as the trend chart. */}
        {visibleThresholds.map((threshold) => (
          <g key={`ffmi-${threshold}`}>
            <line
              x1={xScale(x0)}
              y1={yScale(threshold)}
              x2={xScale(x1)}
              y2={yScale(threshold)}
              stroke="#6b7280"
              strokeDasharray="2 4"
              strokeOpacity={0.25}
            />
            <text
              x={xScale(x1) - 30}
              y={yScale(threshold) - 3}
              fill="#6b7280"
              fontSize={9}
              opacity={0.7}
            >
              FFMI {threshold}
            </text>
          </g>
        ))}

        {/* Anchored daily estimate — faint context trail, scans-range only. */}
        {trailPoints.length >= 2 && (
          <polyline
            points={trailPoints.map((p) => `${xScale(p.fmi)},${yScale(p.ffmi)}`).join(' ')}
            fill="none"
            stroke={TRAIL_COLOR}
            strokeWidth={1.5}
            strokeOpacity={0.18}
          />
        )}

        {/* Target marker: rendered whenever a target composition is set —
            NOT gated on the goal vector, so a degenerate/suppressed vector
            never hides where the target sits. */}
        {targetPoint && (() => {
          const targetPx = px(targetPoint);
          const widest = targetLabelLines
            ? targetLabelLines.reduce((a, b) => (a.length >= b.length ? a : b))
            : '';
          return (
            <g>
              <circle
                data-testid="map-target"
                cx={targetPx.x}
                cy={targetPx.y}
                r={8}
                fill="none"
                stroke={GOAL_COLOR}
                strokeWidth={2}
                strokeOpacity={0.6}
              />
              <circle cx={targetPx.x} cy={targetPx.y} r={4} fill={GOAL_COLOR} />
              {targetLabelLines && (
                <MapLabel
                  placement={placeLabel(targetPx, plot, widest, {
                    ...avoidOptions,
                    lineCount: targetLabelLines.length,
                  })}
                  lines={targetLabelLines}
                  fill={GOAL_COLOR}
                  fontWeight={600}
                  pill
                  testid="map-target-label"
                />
              )}
            </g>
          );
        })()}

        {/* Goal vector: latest scan → goal, dashed, arrowhead at the goal
            end, with a caption rotated along the line. */}
        {showGoalVector && targetPoint && (() => {
          const targetPx = px(targetPoint);
          const arrow = arrowAt(nowPx, targetPx);
          // Arrowhead just short of the goal marker, on the line.
          const len = Math.hypot(targetPx.x - nowPx.x, targetPx.y - nowPx.y);
          const ux = len > 0 ? (targetPx.x - nowPx.x) / len : 0;
          const uy = len > 0 ? (targetPx.y - nowPx.y) / len : 0;
          const tipX = targetPx.x - ux * 14;
          const tipY = targetPx.y - uy * 14;
          // Keep the rotated caption readable: never upside down.
          const textAngle =
            arrow && (arrow.angleDeg > 90 || arrow.angleDeg < -90)
              ? arrow.angleDeg + 180
              : (arrow?.angleDeg ?? 0);
          return (
            <g>
              <line
                x1={nowPx.x}
                y1={nowPx.y}
                x2={targetPx.x}
                y2={targetPx.y}
                stroke={GOAL_COLOR}
                strokeWidth={1.5}
                strokeDasharray="6 4"
                strokeOpacity={0.6}
              />
              {arrow && (
                <path
                  data-testid="map-goal-arrowhead"
                  d="M 5 0 L -3.5 -3 L -3.5 3 Z"
                  transform={`translate(${tipX}, ${tipY}) rotate(${arrow.angleDeg})`}
                  fill={GOAL_COLOR}
                  fillOpacity={0.85}
                />
              )}
              {/* Caption along the vector it names, offset perpendicular. */}
              {vectorLabel && arrow && (
                <text
                  data-testid="map-vector-label"
                  x={arrow.x}
                  y={arrow.y - 6}
                  textAnchor="middle"
                  fill={GOAL_COLOR}
                  fontSize={9}
                  opacity={0.9}
                  transform={`rotate(${textAngle}, ${arrow.x}, ${arrow.y})`}
                >
                  {vectorLabel}
                </text>
              )}
            </g>
          );
        })()}

        {/* Scan path: connected in date order, old → recent gradient, with
            a small arrowhead at each segment midpoint showing travel
            direction. Filled triangles (not strokes) so they stay visible
            at mobile stroke widths. */}
        {scanPoints.slice(1).map((p, i) => {
          const prev = scanPoints[i];
          const t = scanPoints.length > 2 ? (i + 1) / (scanPoints.length - 1) : 1;
          const opacity = 0.3 + 0.65 * t;
          const arrow = arrowAt(px(prev), px(p));
          return (
            <g key={`seg-${p.date}`}>
              <line
                x1={px(prev).x}
                y1={px(prev).y}
                x2={px(p).x}
                y2={px(p).y}
                stroke={SCAN_COLOR}
                strokeWidth={2}
                strokeOpacity={opacity}
              />
              {arrow && (
                <path
                  data-testid="map-arrowhead"
                  d="M 4.5 0 L -3 -2.8 L -3 2.8 Z"
                  transform={`translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angleDeg})`}
                  fill={SCAN_COLOR}
                  fillOpacity={opacity}
                />
              )}
            </g>
          );
        })}

        {/* Intermediate scan month labels — only when the map is sparse
            enough to stay legible (≤5 scans); tap covers the rest. Labels
            dodge the path/trail/points; a background pill is the fallback
            when all 8 candidate spots collide. */}
        {showIntermediateLabels &&
          scanPoints.slice(1, -1).map((p) => {
            const text = formatDateShort(p.date);
            const placement = placeLabel(px(p), plot, text, {
              ...avoidOptions,
              fontSize: 8,
            });
            return (
              <MapLabel
                key={`mid-${p.date}`}
                placement={placement}
                lines={[text]}
                fill="#9ca3af"
                fontSize={8}
                pill={!placement.clear}
                testid="map-month-label"
              />
            );
          })}

        {/* Labeled endpoints: where the journey starts and where it is now.
            Both always sit on a background pill — the Now label especially
            must stay full-contrast over the trail or any other geometry. */}
        <MapLabel
          placement={startPlacement}
          lines={[startLabel]}
          fill={START_LABEL_COLOR}
          fontWeight={500}
          pill
          testid="map-start-label"
        />
        <MapLabel
          placement={nowPlacement}
          lines={[nowLabel]}
          fill={NOW_LABEL_COLOR}
          fontWeight={600}
          pill
          testid="map-now-label"
        />
      </g>
    );
  };
}

export function CompositionMap({
  trend,
  heightCm,
  units,
  phase,
  target,
  phaseStartDate,
}: CompositionMapProps) {
  const [startMode, setStartMode] = useState<'phase' | 'all-time'>(
    phaseStartDate ? 'phase' : 'all-time'
  );

  const scanObservations = useMemo<CompositionObservation[]>(
    () =>
      trend
        .filter((p) => p.kind === 'dexa')
        .map((p) => ({
          date: p.date,
          leanMassKg: p.leanMassKg,
          fatMassKg: p.fatMassKg,
          weightKg: p.weightKg,
          boneMassKg: p.boneMassKg,
          bodyFatPercent: p.bodyFatPercent,
        })),
    [trend]
  );

  const scanPoints = useMemo(
    () => buildCompositionPath(scanObservations, heightCm),
    [scanObservations, heightCm]
  );

  // Daily estimate trail: context only, never past the last scan.
  const trailPoints = useMemo(() => {
    if (scanPoints.length < 2) return [];
    const first = scanPoints[0].date;
    const last = scanPoints[scanPoints.length - 1].date;
    return buildCompositionPath(
      trend
        .filter((p) => p.kind === 'estimated' && p.date > first && p.date < last)
        .map((p) => ({
          date: p.date,
          leanMassKg: p.leanMassKg,
          fatMassKg: p.fatMassKg,
          weightKg: p.weightKg,
          boneMassKg: p.boneMassKg,
          bodyFatPercent: p.bodyFatPercent,
        })),
      heightCm
    );
  }, [trend, scanPoints, heightCm]);

  const targetPoint = useMemo(
    () => (target ? normalizeTargetPoint(target, heightCm) : null),
    [target, heightCm]
  );

  const startPoint = useMemo(
    () => selectStartPoint(scanPoints, startMode, phaseStartDate),
    [scanPoints, startMode, phaseStartDate]
  );

  const goalProgress = useMemo(() => {
    if (!targetPoint || !startPoint || scanPoints.length < 2) return null;
    return computeGoalVectorProgress(
      startPoint,
      scanPoints[scanPoints.length - 1],
      targetPoint
    );
  }, [targetPoint, startPoint, scanPoints]);

  const pRatioPairs = useMemo(
    () => computeScanPairPRatios(scanObservations, heightCm),
    [scanObservations, heightCm]
  );

  const domain = useMemo(
    () => computeMapDomain([...scanPoints, ...trailPoints], targetPoint),
    [scanPoints, trailPoints, targetPoint]
  );

  if (scanPoints.length < 2) {
    return (
      <p className="text-sm text-surface-500 py-8 text-center">
        Log at least two DEXA scans to unlock the Composition Map.
      </p>
    );
  }

  const lastScan = scanPoints[scanPoints.length - 1];
  const firstScan = scanPoints[0];
  const showGoalVector = !!goalProgress && goalProgress.status !== 'degenerate';
  // No verdict language below 2 scan pairs — same confidence gating as
  // everywhere else.
  const verdictsAllowed = pRatioPairs.length >= 2;
  const visiblePairs = pRatioPairs.slice(-6);

  // Direction-cue labels for the decorations layer.
  const startLabel = `Start · ${formatMonthYear(firstScan.date)}`;
  const nowLabel = `Latest · ${formatDateShort(lastScan.date)}`;
  const targetBfPercent = targetPoint
    ? (targetPoint.fmi / (targetPoint.fmi + targetPoint.ffmi)) * 100
    : null;
  const targetLabelLines = targetPoint
    ? [
        'GOAL',
        `FFMI ${targetPoint.ffmi.toFixed(1)}`,
        `BF ${targetBfPercent!.toFixed(0)}%`,
        `FMI ${targetPoint.fmi.toFixed(1)}`,
      ]
    : null;
  const vectorLabel = showGoalVector
    ? goalProgress?.displayPercent != null
      ? `Goal vector · ${goalProgress.displayPercent}%`
      : 'Goal vector'
    : null;
  // Weight the goal point implies: (FMI + FFMI) · height². Shown in the
  // footer so the goal reads in familiar units too.
  const heightM2 = (heightCm / 100) ** 2;
  const targetWeightKg = targetPoint ? (targetPoint.fmi + targetPoint.ffmi) * heightM2 : null;
  const formatWeightDisplay = (kg: number) =>
    units === 'lb' ? `${kgToLbs(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;

  return (
    <div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.5} />
            <XAxis
              type="number"
              dataKey="fmi"
              name="FMI"
              domain={domain.x}
              stroke="#9ca3af"
              fontSize={11}
              tickCount={7}
              label={{
                value: 'Fat Mass Index (kg/m²)',
                position: 'insideBottom',
                offset: -6,
                fontSize: 10,
                fill: '#9ca3af',
              }}
            />
            <YAxis
              type="number"
              dataKey="ffmi"
              name="FFMI"
              domain={domain.y}
              stroke="#9ca3af"
              fontSize={11}
              width={40}
              label={{
                value: 'FFMI (kg/m²)',
                angle: -90,
                position: 'insideLeft',
                fontSize: 10,
                fill: '#9ca3af',
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={<MapTooltip units={units} />}
            />
            <Customized
              component={buildDecorations({
                domain,
                scanPoints,
                trailPoints,
                targetPoint,
                targetLabelLines,
                vectorLabel,
                showGoalVector,
                startLabel,
                nowLabel,
                showIntermediateLabels: scanPoints.length > 2 && scanPoints.length <= 5,
              })}
            />
            {/* Scan points — the emphasis; tap for date + values. */}
            <Scatter
              data={scanPoints}
              isAnimationActive={false}
              shape={(props: {
                cx?: number;
                cy?: number;
                payload?: CompositionPoint;
              }) => {
                if (props.cx == null || props.cy == null) return <g />;
                // Recency from the payload's date (shape props aren't
                // guaranteed to carry an index across recharts versions).
                const idx = scanPoints.findIndex((sp) => sp.date === props.payload?.date);
                const isFirst = idx === 0;
                const isLast = idx === scanPoints.length - 1;
                const t = scanPoints.length > 1 && idx >= 0 ? idx / (scanPoints.length - 1) : 1;
                if (isFirst && !isLast) {
                  // Start: hollow gray marker — visibly "where it began".
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={4.5}
                      fill="#111827"
                      stroke="#9ca3af"
                      strokeWidth={1.5}
                    />
                  );
                }
                if (isLast) {
                  // Now: larger marker with a ring highlight.
                  return (
                    <g>
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={9}
                        fill="none"
                        stroke={SCAN_COLOR}
                        strokeWidth={1.5}
                        strokeOpacity={0.35}
                      />
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={6}
                        fill={SCAN_COLOR}
                        stroke="#f3f4f6"
                        strokeWidth={2}
                      />
                    </g>
                  );
                }
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill={SCAN_COLOR}
                    fillOpacity={0.35 + 0.65 * t}
                    stroke="#0e7490"
                    strokeWidth={1}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Direction legend + decomposition caption */}
      <p className="text-[11px] text-surface-400 mt-2">
        ↑ muscle gained · ← fat lost · ↖ recomp
      </p>
      <p className="text-[11px] text-surface-500 mt-1">
        FMI + FFMI = BMI — this map decomposes BMI into fat (x) and fat-free
        (y) parts; diagonals are constant BMI. Scan points are the signal;
        the faint trail is the day-to-day estimate, shown for context only
        and never extended past your last scan.
      </p>

      {/* No target yet: the goal vector needs an anchor. */}
      {!targetPoint && (
        <p className="text-[11px] text-surface-500 mt-2">
          <Link
            href="/dashboard/analytics?tab=goals"
            className="text-primary-400 hover:text-primary-300 font-medium"
          >
            Set a target
          </Link>{' '}
          to see your goal vector on the map.
        </p>
      )}

      {/* Goal-vector progress scalar */}
      {goalProgress && goalProgress.status !== 'degenerate' && (
        <div className="mt-3 p-3 rounded-lg bg-surface-800/60 border border-surface-700">
          <div className="flex items-center justify-between gap-2">
            {goalProgress.status === 'target_reached' ? (
              <p className="text-sm font-medium text-success-400">
                Target reached — composition at or beyond your goal
              </p>
            ) : (
              <p
                className={`text-sm font-medium ${
                  (goalProgress.progressPercent ?? 0) < 0
                    ? 'text-warning-400'
                    : 'text-surface-100'
                }`}
              >
                Composition progress: {goalProgress.displayPercent}% toward target
              </p>
            )}
            {phaseStartDate && (
              <div className="inline-flex bg-surface-800 rounded-lg p-0.5 shrink-0">
                {(
                  [
                    { value: 'phase', label: 'This phase' },
                    { value: 'all-time', label: 'All time' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStartMode(option.value)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all ${
                      startMode === option.value
                        ? 'bg-surface-600 text-surface-100'
                        : 'text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {goalProgress.status !== 'target_reached' &&
            (goalProgress.progressPercent ?? 0) < 0 && (
              <p className="text-[11px] text-warning-400/80 mt-1">
                Moving away from the target along the goal direction.
              </p>
            )}
          {goalProgress.offAxisNote && (
            <p className="text-[11px] text-surface-400 mt-1">
              {goalProgress.offAxisNote}
            </p>
          )}
        </div>
      )}

      {/* P-ratio between consecutive scans */}
      {visiblePairs.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-surface-300 mb-1.5">
            Partitioning between scans (p-ratio)
          </p>
          <div className="space-y-1">
            {visiblePairs.map((pair) => {
              const verdict = verdictsAllowed
                ? classifyPartitioning(pair, phase, pRatioPairs.length)
                : null;
              return (
                <div
                  key={`${pair.fromDate}-${pair.toDate}`}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="text-surface-400 shrink-0">
                    {formatDateShort(pair.fromDate)} → {formatDateShort(pair.toDate)}
                  </span>
                  <span className="text-surface-300 text-right">
                    {formatDeltaWeight(pair.deltaWeightKg, units)}
                    {', '}
                    <span
                      className={
                        pair.suppressed || pair.withinNoise ? 'text-surface-500' : undefined
                      }
                    >
                      {fractionText(pair)}
                    </span>
                    {verdict && (
                      <span className={`ml-1.5 ${VERDICT_STYLES[verdict]}`}>
                        {verdict}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-surface-600 mt-1.5">
            DEXA precision is ~±1–2% BF and ±1–2 lb lean (hydration-sensitive)
            — deltas inside that range are labeled as measurement noise.
          </p>
        </div>
      )}

      {/* Latest vs Goal summary footer */}
      <div
        className="mt-3 grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-800/60 border border-surface-700"
        data-testid="map-summary-footer"
      >
        <div>
          <p className="text-xs font-medium text-cyan-300">
            Latest ({formatDateShort(lastScan.date)})
          </p>
          <p className="text-xs text-surface-300 mt-1">
            FFMI {lastScan.ffmi.toFixed(1)} · FMI {lastScan.fmi.toFixed(1)} · BF{' '}
            {lastScan.bodyFatPercent.toFixed(1)}%
          </p>
          <p className="text-[11px] text-surface-400 mt-0.5">
            Weight {formatWeightDisplay(lastScan.weightKg)}
          </p>
        </div>
        {targetPoint && targetWeightKg != null ? (
          <div className="border-l border-surface-700 pl-3">
            <p className="text-xs font-medium text-success-400">Goal</p>
            <p className="text-xs text-surface-300 mt-1">
              FFMI {targetPoint.ffmi.toFixed(1)} · FMI {targetPoint.fmi.toFixed(1)} · BF{' '}
              {targetBfPercent!.toFixed(1)}%
            </p>
            <p className="text-[11px] text-surface-400 mt-0.5">
              Implied weight ~{formatWeightDisplay(targetWeightKg)}
            </p>
          </div>
        ) : (
          <div className="border-l border-surface-700 pl-3">
            <p className="text-xs font-medium text-surface-500">Goal</p>
            <p className="text-[11px] text-surface-500 mt-1">
              No target set — add one in Goals to plot it here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
