'use client';

import { useMemo } from 'react';
import { getPlateColor, type PlateCalculationResult } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';
import {
  BAR_MID_Y,
  COLLAR_OFFSET,
  computePlateLayout,
  plateLabelColor,
  showPlateLabel,
  type PlateLayoutItem,
} from './plateGeometry';

/**
 * Renders the collar + sleeve + plates for a single side of the bar.
 * `direction` is +1 for the right side and -1 for the left; x positions are
 * computed as `center + direction * offset` so both sides share one code path.
 */
function BarbellSide({
  center,
  direction,
  items,
  sleeveEnd,
  unit,
}: {
  center: number;
  direction: 1 | -1;
  items: PlateLayoutItem[];
  sleeveEnd: number;
  unit: WeightUnit;
}) {
  const sleeveInnerX = center + direction * COLLAR_OFFSET;
  const sleeveOuterX = center + direction * sleeveEnd;
  const sleeveX = Math.min(sleeveInnerX, sleeveOuterX);
  const sleeveW = Math.abs(sleeveOuterX - sleeveInnerX);
  const collarX = center + direction * COLLAR_OFFSET;

  return (
    <g>
      {/* Sleeve the plates load onto */}
      <rect
        x={sleeveX}
        y={BAR_MID_Y - 7}
        width={sleeveW}
        height={14}
        rx={3}
        className="fill-surface-500"
      />
      {/* End cap at the sleeve tip */}
      <rect
        x={direction === 1 ? sleeveOuterX - 3 : sleeveOuterX}
        y={BAR_MID_Y - 9}
        width={3}
        height={18}
        rx={1.5}
        className="fill-surface-400"
      />
      {/* Collar / shoulder the plates butt up against */}
      <rect
        x={direction === 1 ? collarX : collarX - 5}
        y={BAR_MID_Y - 16}
        width={5}
        height={32}
        rx={1.5}
        className="fill-surface-400"
      />

      {/* Plates */}
      {items.map((item, index) => {
        const cx = center + direction * item.centerOffset;
        const x = cx - item.width / 2;
        const y = BAR_MID_Y - item.height / 2;
        const color = getPlateColor(item.plate, unit);
        return (
          <g key={`${direction === 1 ? 'r' : 'l'}-${index}`}>
            <rect
              x={x}
              y={y}
              width={item.width}
              height={item.height}
              rx={2.5}
              fill={color}
              className="stroke-surface-950"
              strokeWidth={1}
            />
            {showPlateLabel(item.plate, unit) && (
              <text
                x={cx}
                y={BAR_MID_Y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={plateLabelColor(color)}
                fontSize={7.5}
                fontWeight="bold"
              >
                {item.plate}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Visual barbell with colored plates.
 */
export function BarbellVisualization({
  calculation,
  unit,
  isMachine,
  machineBaseWeight,
  barbellWeight,
  baseWeight,
  belowBase,
  isClosestMatch,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
  isMachine: boolean;
  machineBaseWeight: number | undefined;
  barbellWeight: number;
  baseWeight: number;
  belowBase: boolean;
  isClosestMatch: boolean;
}) {
  const { platesPerSide } = calculation;

  const { items, sleeveEnd } = useMemo(
    () => computePlateLayout(platesPerSide, unit),
    [platesPerSide, unit]
  );

  // Dynamic viewBox so any number of plates fits without clipping the container.
  const vbHalf = sleeveEnd + 14;
  const vbWidth = vbHalf * 2;
  const center = vbHalf;

  // Unique plates for the legend, largest first.
  const uniquePlates = Array.from(new Set(platesPerSide)).sort((a, b) => b - a);

  return (
    <div className="bg-surface-800 rounded-lg p-4">
      {belowBase ? (
        <div
          data-testid="plate-calc-below-base"
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-surface-600 bg-surface-900/40 py-8 text-center"
        >
          <p className="text-sm font-semibold text-surface-100">
            Target is below the {isMachine ? 'starting' : 'bar'} weight
          </p>
          <p className="text-xs text-surface-300">
            The {isMachine ? 'machine starts' : 'empty bar weighs'} {baseWeight}
            {unit}. Enter {baseWeight}
            {unit} or more to load plates.
          </p>
        </div>
      ) : (
        <>
          {/* Barbell SVG — both sides drawn by the same mirrored component. */}
          <div className="relative flex items-center justify-center min-h-[120px]">
            <svg
              viewBox={`0 0 ${vbWidth} 120`}
              className="w-full h-28"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`${isMachine ? 'Machine' : 'Barbell'} loaded with ${platesPerSide.join(', ')} ${unit} per side`}
            >
              {/* Center knurled grip / shaft spanning both collars */}
              <rect
                x={center - COLLAR_OFFSET}
                y={BAR_MID_Y - 4}
                width={COLLAR_OFFSET * 2}
                height={8}
                rx={2}
                className="fill-surface-500"
              />

              <BarbellSide
                center={center}
                direction={-1}
                items={items}
                sleeveEnd={sleeveEnd}
                unit={unit}
              />
              <BarbellSide
                center={center}
                direction={1}
                items={items}
                sleeveEnd={sleeveEnd}
                unit={unit}
              />
            </svg>
          </div>

          {/* Weight summary */}
          <div className="mt-3 text-center">
            <p className="text-lg font-bold text-surface-100">
              {calculation.actualTotal} {unit}
            </p>
            <p className="text-xs text-surface-300">
              {isMachine ? (
                (machineBaseWeight ?? 0) > 0 ? (
                  <>Machine base: {machineBaseWeight}{unit} + Plates: {calculation.weightPerSide}{unit} × 2</>
                ) : (
                  <>Plates only (no bar): {calculation.weightPerSide}{unit} × 2</>
                )
              ) : (
                <>Bar: {barbellWeight}{unit} + Plates: {calculation.weightPerSide}{unit} × 2</>
              )}
            </p>
            {isClosestMatch && (
              <p
                data-testid="plate-calc-closest"
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-warning-500 bg-surface-700 px-2 py-1 text-xs font-medium text-surface-100"
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-warning-500" />
                Can&apos;t match exactly — closest is {calculation.actualTotal}{unit}
              </p>
            )}
          </div>

          {/* Plate legend */}
          {uniquePlates.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {uniquePlates.map((plate) => {
                const count = platesPerSide.filter((p) => p === plate).length;
                return (
                  <PlateChip key={plate} plate={plate} unit={unit} count={count} />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A single plate reference chip (swatch + label). Shared by the legend and the
 * loading instructions so the color coding is identical in all three places
 * (bar graphic, legend, instructions).
 */
export function PlateChip({
  plate,
  unit,
  count,
}: {
  plate: number;
  unit: WeightUnit;
  count?: number;
}) {
  const color = getPlateColor(plate, unit);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-surface-600 bg-surface-700 px-2 py-1">
      <span
        className="h-3 w-3 rounded-sm border border-surface-500"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs font-medium text-surface-200">
        {plate}{unit}
        {count && count > 1 ? ` × ${count}` : ''}
      </span>
    </span>
  );
}
