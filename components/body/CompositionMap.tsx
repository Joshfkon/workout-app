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
const TARGET_COLOR = '#f59e0b';

function formatDateShort(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDeltaWeight(deltaKg: number, units: 'lb' | 'kg'): string {
  const value = units === 'lb' ? kgToLbs(deltaKg) : deltaKg;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} ${units}`;
}

/** "Mar 3 → Jul 1: +2.2 lb, 68% lean" fraction part, phase-framed. */
function fractionText(pair: ScanPairPRatio): string {
  if (pair.suppressed) return 'Δ weight under 3 lb — p-ratio suppressed';
  if (pair.withinNoise) return 'within measurement noise';
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

interface DecorationsData {
  domain: MapDomain;
  scanPoints: CompositionPoint[];
  trailPoints: CompositionPoint[];
  startPoint: CompositionCoords | null;
  targetPoint: CompositionCoords | null;
  showGoalVector: boolean;
}

/**
 * Everything drawn under the scan points: iso-BMI diagonals, FFMI threshold
 * lines, the faint estimate trail, the gradient scan path, and the goal
 * vector. Rendered via Recharts <Customized> so we can use raw SVG with the
 * chart's own scales.
 */
function buildDecorations(data: DecorationsData) {
  // Recharts passes its internal chart state (axis maps with scales) to
  // Customized components; there's no public type for it.
  return function Decorations(props: Record<string, unknown>) {
    const xMap = props.xAxisMap as Record<string, { scale?: (v: number) => number }> | undefined;
    const yMap = props.yAxisMap as Record<string, { scale?: (v: number) => number }> | undefined;
    const xScale = xMap?.[Object.keys(xMap)[0]]?.scale;
    const yScale = yMap?.[Object.keys(yMap)[0]]?.scale;
    if (!xScale || !yScale) return null;

    const { domain, scanPoints, trailPoints, startPoint, targetPoint, showGoalVector } = data;
    const [x0, x1] = domain.x;
    const isoSegments = visibleIsoBmiSegments(domain);

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
        {COMPOSITION_MAP_FFMI_THRESHOLDS.filter(
          (t) => t > domain.y[0] && t < domain.y[1]
        ).map((threshold) => (
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

        {/* Goal vector: start → target, dashed, with a diamond at the target. */}
        {showGoalVector && startPoint && targetPoint && (
          <g>
            <line
              x1={xScale(startPoint.fmi)}
              y1={yScale(startPoint.ffmi)}
              x2={xScale(targetPoint.fmi)}
              y2={yScale(targetPoint.ffmi)}
              stroke={TARGET_COLOR}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              strokeOpacity={0.55}
            />
            <path
              d={`M ${xScale(targetPoint.fmi)} ${yScale(targetPoint.ffmi) - 6}
                  L ${xScale(targetPoint.fmi) + 6} ${yScale(targetPoint.ffmi)}
                  L ${xScale(targetPoint.fmi)} ${yScale(targetPoint.ffmi) + 6}
                  L ${xScale(targetPoint.fmi) - 6} ${yScale(targetPoint.ffmi)} Z`}
              fill={TARGET_COLOR}
              fillOpacity={0.9}
            />
            <text
              x={xScale(targetPoint.fmi) + 9}
              y={yScale(targetPoint.ffmi) + 3}
              fill={TARGET_COLOR}
              fontSize={9}
            >
              target
            </text>
          </g>
        )}

        {/* Scan path: connected in date order, old → recent gradient. */}
        {scanPoints.slice(1).map((p, i) => {
          const prev = scanPoints[i];
          const t = scanPoints.length > 2 ? (i + 1) / (scanPoints.length - 1) : 1;
          return (
            <line
              key={`seg-${p.date}`}
              x1={xScale(prev.fmi)}
              y1={yScale(prev.ffmi)}
              x2={xScale(p.fmi)}
              y2={yScale(p.ffmi)}
              stroke={SCAN_COLOR}
              strokeWidth={2}
              strokeOpacity={0.3 + 0.65 * t}
            />
          );
        })}
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
  const showGoalVector = !!goalProgress && goalProgress.status !== 'degenerate';
  // No verdict language below 2 scan pairs — same confidence gating as
  // everywhere else.
  const verdictsAllowed = pRatioPairs.length >= 2;
  const visiblePairs = pRatioPairs.slice(-6);

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
                startPoint,
                targetPoint,
                showGoalVector,
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
                const isLast = idx === scanPoints.length - 1;
                const t = scanPoints.length > 1 && idx >= 0 ? idx / (scanPoints.length - 1) : 1;
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={isLast ? 6 : 4}
                    fill={SCAN_COLOR}
                    fillOpacity={0.35 + 0.65 * t}
                    stroke={isLast ? '#f3f4f6' : '#0e7490'}
                    strokeWidth={isLast ? 2 : 1}
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

      {/* Latest position readout */}
      <p className="text-[11px] text-surface-500 mt-2">
        Latest ({formatDateShort(lastScan.date)}): FFMI {lastScan.ffmi.toFixed(1)} ·
        FMI {lastScan.fmi.toFixed(1)} · BF {lastScan.bodyFatPercent.toFixed(1)}%
      </p>
    </div>
  );
}
