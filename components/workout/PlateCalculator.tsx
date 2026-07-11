'use client';

import { memo, useState, useMemo } from 'react';
import {
  calculatePlates,
  getPlateColor,
  BARBELL_WEIGHTS,
  type BarbellType,
  type PlateCalculationResult,
  formatWeightValue,
} from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';
import {
  BAR_MID_Y,
  COLLAR_OFFSET,
  computePlateLayout,
  plateLabelColor,
  showPlateLabel,
  type PlateLayoutItem,
} from './plateGeometry';

interface PlateCalculatorProps {
  /** Initial target weight in kg (will be converted based on unit) */
  initialWeightKg?: number;
  /** Weight unit preference */
  unit?: WeightUnit;
  /** Callback when calculation changes */
  onCalculate?: (result: PlateCalculationResult) => void;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Starting weight in kg (e.g., machine base weight) */
  startingWeightKg?: number;
  /** Callback when starting weight changes */
  onStartingWeightChange?: (weightKg: number | undefined) => void;
}

/**
 * Visual plate calculator showing which plates to load on a barbell.
 *
 * Presentation is theme-aware: every surface/text color uses the semantic
 * `surface-*` token ramp (which flips with `data-theme`), never a fixed
 * `gray-*` value, so the modal renders correctly in both light and dark.
 */
export const PlateCalculator = memo(function PlateCalculator({
  initialWeightKg = 60,
  unit = 'kg',
  onCalculate,
  compact = false,
  startingWeightKg: initialStartingWeightKg,
  onStartingWeightChange,
}: PlateCalculatorProps) {
  const initialDisplayWeight = unit === 'lb'
    ? formatWeightValue(initialWeightKg, 'lb')
    : initialWeightKg;

  const [targetWeight, setTargetWeight] = useState<string>(String(initialDisplayWeight));
  const [barbellType, setBarbellType] = useState<BarbellType>('olympic');
  const [startingWeight, setStartingWeight] = useState<string>(
    initialStartingWeightKg !== undefined
      ? String(unit === 'lb' ? formatWeightValue(initialStartingWeightKg, 'lb') : initialStartingWeightKg)
      : ''
  );

  const barbellWeights = BARBELL_WEIGHTS[unit];
  const barbellWeight = barbellWeights[barbellType].weight;

  // Convert starting weight to display unit
  const startingWeightNum = startingWeight ? parseFloat(startingWeight) : undefined;
  const startingWeightKg = startingWeightNum
    ? (unit === 'lb' ? startingWeightNum / 2.20462 : startingWeightNum)
    : undefined;

  // If starting weight is set, it's a machine (no barbell)
  const isMachine = startingWeightKg !== undefined;

  // The floor the target is measured against: machine base or bar weight.
  const baseWeight = isMachine ? (startingWeightNum ?? 0) : barbellWeight;
  const targetNum = parseFloat(targetWeight) || 0;
  const belowBase = targetNum < baseWeight;

  const calculation = useMemo(() => {
    const weight = parseFloat(targetWeight) || 0;
    // For machines, use 0 as barbell weight since starting weight is the base
    const effectiveBarbellWeight = isMachine ? 0 : barbellWeight;
    // Pass starting weight in display units (not kg) since calculatePlates expects all weights in same unit
    const result = calculatePlates(weight, effectiveBarbellWeight, unit, undefined, startingWeightNum);
    onCalculate?.(result);
    return result;
  }, [targetWeight, barbellWeight, unit, startingWeightNum, isMachine, onCalculate]);

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setTargetWeight(value);
    }
  };

  const handleQuickAdjust = (amount: number) => {
    const current = parseFloat(targetWeight) || 0;
    const minWeight = startingWeightKg
      ? (unit === 'lb' ? formatWeightValue(startingWeightKg, 'lb') : startingWeightKg)
      : barbellWeight;
    const newWeight = Math.max(minWeight, current + amount);
    setTargetWeight(String(newWeight));
  };

  const handleStartingWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setStartingWeight(value);
      // Convert to kg and notify parent
      if (value === '') {
        onStartingWeightChange?.(undefined);
      } else {
        const num = parseFloat(value);
        const kg = unit === 'lb' ? num / 2.20462 : num;
        onStartingWeightChange?.(kg);
      }
    }
  };

  if (compact) {
    return (
      <CompactPlateDisplay
        calculation={calculation}
        unit={unit}
      />
    );
  }

  // A miss the solver couldn't hit exactly (target is at/above the base, but
  // the available plates can't land on it — e.g. 47.5lb rounds down to a bare
  // 45lb bar). Surfaced as the solver's closest match, never hidden.
  const isClosestMatch = !calculation.isValid && !belowBase;

  return (
    <div className="space-y-4">
      {/* Starting Weight Input (Optional) */}
      {onStartingWeightChange && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-surface-300">
            Starting Weight <span className="text-xs text-surface-300">(optional, e.g., machine base)</span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={startingWeight}
              onChange={handleStartingWeightChange}
              className="w-full px-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-surface-100 text-center focus:outline-none focus:border-primary-500"
              placeholder={`Enter starting weight in ${unit}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-300 font-medium">
              {unit}
            </span>
          </div>
        </div>
      )}

      {/* Weight Input with labeled ± steppers (step by 5 = 2.5 plate per side) */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-surface-300">Target Weight</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuickAdjust(-5)}
            aria-label="Decrease target weight by 5"
            title="−5"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-surface-700 text-lg font-semibold text-surface-100 transition-colors hover:bg-surface-600 active:bg-surface-800"
          >
            −5
          </button>
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="decimal"
              value={targetWeight}
              onChange={handleWeightChange}
              className="w-full px-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-surface-100 text-center text-lg font-semibold focus:outline-none focus:border-primary-500"
              placeholder={`Enter weight in ${unit}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-300 font-medium">
              {unit}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleQuickAdjust(5)}
            aria-label="Increase target weight by 5"
            title="+5"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-surface-700 text-lg font-semibold text-surface-100 transition-colors hover:bg-surface-600 active:bg-surface-800"
          >
            +5
          </button>
        </div>
      </div>

      {/* Barbell Type Selector - only show if not a machine */}
      {!isMachine && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-surface-300">Barbell Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BARBELL_WEIGHTS[unit]) as BarbellType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setBarbellType(type)}
                aria-pressed={barbellType === type}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  barbellType === type
                    ? 'bg-primary-700 text-white'
                    : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
                }`}
              >
                {BARBELL_WEIGHTS[unit][type].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Visual Barbell Display */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-surface-300">Plates per Side</label>
        <BarbellVisualization
          calculation={calculation}
          unit={unit}
          isMachine={isMachine}
          startingWeightNum={startingWeightNum}
          barbellWeight={barbellWeight}
          baseWeight={baseWeight}
          belowBase={belowBase}
          isClosestMatch={isClosestMatch}
        />
      </div>

      {/* Plate Breakdown */}
      {calculation.platesPerSide.length > 0 && (
        <PlateBreakdown calculation={calculation} unit={unit} isMachine={isMachine} />
      )}
    </div>
  );
});

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
function BarbellVisualization({
  calculation,
  unit,
  isMachine,
  startingWeightNum,
  barbellWeight,
  baseWeight,
  belowBase,
  isClosestMatch,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
  isMachine: boolean;
  startingWeightNum: number | undefined;
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
              aria-label={`Barbell loaded with ${platesPerSide.join(', ')} ${unit} per side`}
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
                <>Starting: {startingWeightNum}{unit} + Plates: {calculation.weightPerSide}{unit} × 2</>
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
function PlateChip({
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

/**
 * Text-based plate breakdown / loading instructions.
 */
function PlateBreakdown({
  calculation,
  unit,
  isMachine,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
  isMachine: boolean;
}) {
  const { platesPerSide } = calculation;

  // Group plates by weight, largest first.
  const plateGroups = platesPerSide.reduce((acc, plate) => {
    acc[plate] = (acc[plate] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const sortedPlates = Object.entries(plateGroups)
    .map(([weight, count]) => ({ weight: parseFloat(weight), count }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="bg-surface-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-surface-200 mb-2">Loading Instructions</h4>
      {!isMachine && (
        <p className="text-sm text-surface-300 mb-2">
          Start with the {BARBELL_WEIGHTS[unit].olympic.label}
        </p>
      )}
      <p className="text-sm text-surface-300 mb-2">Load each side, from the center out:</p>
      <div className="flex flex-wrap items-center gap-2">
        {sortedPlates.map((p) => (
          <PlateChip key={p.weight} plate={p.weight} unit={unit} count={p.count} />
        ))}
      </div>
    </div>
  );
}

/**
 * Compact display for inline use (e.g., in SetInputRow)
 */
function CompactPlateDisplay({
  calculation,
  unit,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
}) {
  const { platesPerSide, isValid } = calculation;

  if (!isValid || platesPerSide.length === 0) {
    return null;
  }

  // Group plates for compact display
  const plateGroups = platesPerSide.reduce((acc, plate) => {
    acc[plate] = (acc[plate] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const sortedPlates = Object.entries(plateGroups)
    .map(([weight, count]) => ({ weight: parseFloat(weight), count }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="flex items-center gap-1 text-xs text-surface-300">
      <span>Load:</span>
      {sortedPlates.map((p, i) => (
        <span key={p.weight} className="flex items-center gap-0.5">
          {i > 0 && <span>+</span>}
          <span
            className="px-1 py-0.5 rounded text-white font-medium"
            style={{ backgroundColor: getPlateColor(p.weight, unit) + '40' }}
          >
            {p.weight}{p.count > 1 ? `×${p.count}` : ''}
          </span>
        </span>
      ))}
      <span>/side</span>
    </div>
  );
}

export default PlateCalculator;
