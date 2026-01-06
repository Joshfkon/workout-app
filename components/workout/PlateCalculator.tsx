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
 * Visual plate calculator showing which plates to load on a barbell
 * Similar to Hevy and Strong apps
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

  const calculation = useMemo(() => {
    const weight = parseFloat(targetWeight) || 0;
    // For machines, use 0 as barbell weight since starting weight is the base
    const effectiveBarbellWeight = isMachine ? 0 : barbellWeight;
    const result = calculatePlates(weight, effectiveBarbellWeight, unit, undefined, startingWeightKg);
    onCalculate?.(result);
    return result;
  }, [targetWeight, barbellWeight, unit, startingWeightKg, isMachine, onCalculate]);

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

  return (
    <div className="space-y-4">
      {/* Starting Weight Input (Optional) */}
      {onStartingWeightChange && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            Starting Weight <span className="text-xs text-gray-500">(optional, e.g., machine base)</span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={startingWeight}
              onChange={handleStartingWeightChange}
              className="w-full px-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-center focus:outline-none focus:border-primary-500"
              placeholder={`Enter starting weight in ${unit}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
              {unit}
            </span>
          </div>
        </div>
      )}

      {/* Weight Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">Target Weight</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuickAdjust(-5)}
            className="px-3 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-gray-300 font-medium transition-colors"
          >
            -5
          </button>
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="decimal"
              value={targetWeight}
              onChange={handleWeightChange}
              className="w-full px-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-center text-lg font-semibold focus:outline-none focus:border-primary-500"
              placeholder={`Enter weight in ${unit}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
              {unit}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleQuickAdjust(5)}
            className="px-3 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-gray-300 font-medium transition-colors"
          >
            +5
          </button>
        </div>
      </div>

      {/* Barbell Type Selector - only show if not a machine */}
      {!isMachine && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Barbell Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BARBELL_WEIGHTS[unit]) as BarbellType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setBarbellType(type)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  barbellType === type
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-700 text-gray-300 hover:bg-surface-600'
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
        <label className="text-sm font-medium text-gray-300">Plates per Side</label>
        <BarbellVisualization calculation={calculation} unit={unit} />
      </div>

      {/* Plate Breakdown */}
      {calculation.platesPerSide.length > 0 && (
        <PlateBreakdown calculation={calculation} unit={unit} />
      )}

      {/* Error Message */}
      {!calculation.isValid && calculation.error && (
        <div className="p-3 bg-danger-500/10 border border-danger-500/30 rounded-lg">
          <p className="text-sm text-danger-400">{calculation.error}</p>
        </div>
      )}
    </div>
  );
});

/**
 * Visual barbell with colored plates
 */
function BarbellVisualization({
  calculation,
  unit,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
}) {
  const { platesPerSide, barbellWeight } = calculation;

  // Get unique plates for legend
  const uniquePlates = Array.from(new Set(platesPerSide)).sort((a, b) => b - a);

  return (
    <div className="bg-surface-800 rounded-lg p-4">
      {/* Barbell SVG */}
      <div className="relative flex items-center justify-center min-h-[100px] overflow-x-auto">
        <svg
          viewBox="0 0 400 80"
          className="w-full max-w-md h-20"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Barbell bar */}
          <rect
            x="20"
            y="35"
            width="360"
            height="10"
            rx="2"
            fill="#71717A"
          />

          {/* Left sleeve */}
          <rect
            x="30"
            y="32"
            width="60"
            height="16"
            rx="2"
            fill="#52525B"
          />

          {/* Right sleeve */}
          <rect
            x="310"
            y="32"
            width="60"
            height="16"
            rx="2"
            fill="#52525B"
          />

          {/* Left plates (reversed for correct visual order - largest closest to center) */}
          {[...platesPerSide].reverse().map((plate, index) => {
            const plateWidth = getPlateWidth(plate, unit);
            const plateHeight = getPlateHeight(plate, unit);
            const x = 85 - (index + 1) * (plateWidth + 2);
            const y = 40 - plateHeight / 2;
            const color = getPlateColor(plate, unit);

            return (
              <g key={`left-${index}`}>
                <rect
                  x={x}
                  y={y}
                  width={plateWidth}
                  height={plateHeight}
                  rx="2"
                  fill={color}
                  stroke="#27272A"
                  strokeWidth="1"
                />
                {/* Plate weight text */}
                <text
                  x={x + plateWidth / 2}
                  y={40}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={color === '#FFFFFF' || color === '#FDD835' ? '#000' : '#fff'}
                  fontSize={plateWidth > 12 ? '8' : '6'}
                  fontWeight="bold"
                >
                  {plate}
                </text>
              </g>
            );
          })}

          {/* Right plates (normal order - largest closest to center) */}
          {platesPerSide.map((plate, index) => {
            const plateWidth = getPlateWidth(plate, unit);
            const plateHeight = getPlateHeight(plate, unit);
            const x = 315 + index * (plateWidth + 2);
            const y = 40 - plateHeight / 2;
            const color = getPlateColor(plate, unit);

            return (
              <g key={`right-${index}`}>
                <rect
                  x={x}
                  y={y}
                  width={plateWidth}
                  height={plateHeight}
                  rx="2"
                  fill={color}
                  stroke="#27272A"
                  strokeWidth="1"
                />
                {/* Plate weight text */}
                <text
                  x={x + plateWidth / 2}
                  y={40}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={color === '#FFFFFF' || color === '#FDD835' ? '#000' : '#fff'}
                  fontSize={plateWidth > 12 ? '8' : '6'}
                  fontWeight="bold"
                >
                  {plate}
                </text>
              </g>
            );
          })}

          {/* Collar indicators */}
          <circle cx="95" cy="40" r="4" fill="#3F3F46" />
          <circle cx="305" cy="40" r="4" fill="#3F3F46" />
        </svg>
      </div>

      {/* Weight summary */}
      <div className="mt-3 text-center">
        <p className="text-lg font-bold text-white">
          {calculation.actualTotal} {unit}
        </p>
        <p className="text-xs text-gray-400">
          Bar: {barbellWeight}{unit} + Plates: {calculation.weightPerSide}{unit} × 2
        </p>
      </div>

      {/* Plate legend */}
      {uniquePlates.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {uniquePlates.map((plate) => {
            const count = platesPerSide.filter((p) => p === plate).length;
            const color = getPlateColor(plate, unit);
            return (
              <div
                key={plate}
                className="flex items-center gap-1 px-2 py-1 bg-surface-700 rounded"
              >
                <div
                  className="w-3 h-3 rounded-sm border border-surface-500"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs text-gray-300">
                  {plate}{unit} × {count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Text-based plate breakdown
 */
function PlateBreakdown({
  calculation,
  unit,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
}) {
  const { platesPerSide, barbellWeight } = calculation;

  // Group plates by weight
  const plateGroups = platesPerSide.reduce((acc, plate) => {
    acc[plate] = (acc[plate] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const sortedPlates = Object.entries(plateGroups)
    .map(([weight, count]) => ({ weight: parseFloat(weight), count }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="bg-surface-800 rounded-lg p-4">
      <h4 className="text-sm font-medium text-gray-300 mb-2">Loading Instructions</h4>
      <div className="space-y-1">
        <p className="text-sm text-gray-400">
          Start with the {BARBELL_WEIGHTS[unit].olympic.label}
        </p>
        <p className="text-sm text-white font-medium">
          Load each side:{' '}
          {sortedPlates.map((p, i) => (
            <span key={p.weight}>
              {i > 0 && ' + '}
              <span className="text-primary-400">
                {p.weight}{unit}
                {p.count > 1 && ` × ${p.count}`}
              </span>
            </span>
          ))}
        </p>
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
    <div className="flex items-center gap-1 text-xs text-gray-400">
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

/**
 * Get plate width for SVG based on weight
 */
function getPlateWidth(weight: number, unit: 'kg' | 'lb'): number {
  const kgWeight = unit === 'lb' ? weight / 2.20462 : weight;
  if (kgWeight >= 20) return 18;
  if (kgWeight >= 15) return 16;
  if (kgWeight >= 10) return 14;
  if (kgWeight >= 5) return 12;
  return 10;
}

/**
 * Get plate height for SVG based on weight
 */
function getPlateHeight(weight: number, unit: 'kg' | 'lb'): number {
  const kgWeight = unit === 'lb' ? weight / 2.20462 : weight;
  if (kgWeight >= 20) return 60;
  if (kgWeight >= 15) return 55;
  if (kgWeight >= 10) return 50;
  if (kgWeight >= 5) return 40;
  if (kgWeight >= 2) return 35;
  return 30;
}

export default PlateCalculator;
