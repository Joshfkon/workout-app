'use client';

import { memo, useState, useMemo } from 'react';
import {
  calculatePlates,
  getAvailablePlates,
  getPlateColor,
  BARBELL_WEIGHTS,
  DEFAULT_SMALLEST_PLATE,
  SMALLEST_PLATE_OPTIONS,
  type BarbellType,
  type PlateCalculationResult,
  formatWeightValue,
} from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';
import { BarbellVisualization, PlateChip } from './PlateVisualization';

/**
 * The smallest-plate choice is a per-unit device setting (plate inventory is
 * a property of the gym, not the account), persisted in localStorage like the
 * rest timer and theme.
 */
const smallestPlateStorageKey = (unit: WeightUnit) => `plate_calculator_smallest_plate_${unit}`;

function readStoredSmallestPlate(unit: WeightUnit): number {
  if (typeof window === 'undefined') return DEFAULT_SMALLEST_PLATE[unit];
  try {
    const stored = parseFloat(window.localStorage.getItem(smallestPlateStorageKey(unit)) ?? '');
    const options: readonly number[] = SMALLEST_PLATE_OPTIONS[unit];
    if (options.includes(stored)) return stored;
  } catch {
    // Storage unavailable (e.g. private browsing) — fall through to default.
  }
  return DEFAULT_SMALLEST_PLATE[unit];
}

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
  // Explicit equipment mode so a plate-loaded machine works even with a 0
  // (or empty) base weight — machine mode is never inferred from the input.
  // A saved per-exercise starting weight opens the calculator in machine mode.
  const [equipmentMode, setEquipmentMode] = useState<'barbell' | 'machine'>(
    initialStartingWeightKg !== undefined ? 'machine' : 'barbell'
  );
  const [startingWeight, setStartingWeight] = useState<string>(
    initialStartingWeightKg !== undefined
      ? String(unit === 'lb' ? formatWeightValue(initialStartingWeightKg, 'lb') : initialStartingWeightKg)
      : ''
  );

  // Smallest plate pair the user owns (per side). Drives both the ± stepper
  // increment (2 × plate) and which plates the solver may load.
  const [storedSmallestPlate, setStoredSmallestPlate] = useState<number>(() =>
    readStoredSmallestPlate(unit)
  );
  const smallestPlateOptions: readonly number[] = SMALLEST_PLATE_OPTIONS[unit];
  const smallestPlate = smallestPlateOptions.includes(storedSmallestPlate)
    ? storedSmallestPlate
    : DEFAULT_SMALLEST_PLATE[unit];
  const increment = smallestPlate * 2;

  const handleSmallestPlateChange = (plate: number) => {
    setStoredSmallestPlate(plate);
    try {
      window.localStorage.setItem(smallestPlateStorageKey(unit), String(plate));
    } catch {
      // Storage unavailable — the choice still applies for this session.
    }
  };

  const barbellWeights = BARBELL_WEIGHTS[unit];
  const barbellWeight = barbellWeights[barbellType].weight;

  const isMachine = equipmentMode === 'machine';

  // Starting weight in display units; empty input means a 0 base (plates only).
  const parsedStartingWeight = startingWeight !== '' ? parseFloat(startingWeight) : NaN;
  const startingWeightNum = Number.isFinite(parsedStartingWeight) ? parsedStartingWeight : undefined;
  const machineBaseWeight = isMachine ? (startingWeightNum ?? 0) : undefined;

  // The floor the target is measured against: machine base or bar weight.
  const baseWeight = isMachine ? (machineBaseWeight ?? 0) : barbellWeight;
  const targetNum = parseFloat(targetWeight) || 0;
  const belowBase = targetNum < baseWeight;

  const availablePlates = useMemo(
    () => getAvailablePlates(unit, smallestPlate),
    [unit, smallestPlate]
  );

  const calculation = useMemo(() => {
    const weight = parseFloat(targetWeight) || 0;
    // For machines, use 0 as barbell weight since the base weight is the floor.
    const effectiveBarbellWeight = isMachine ? 0 : barbellWeight;
    // Pass starting weight in display units (not kg) since calculatePlates expects all weights in same unit
    const result = calculatePlates(weight, effectiveBarbellWeight, unit, availablePlates, machineBaseWeight);
    onCalculate?.(result);
    return result;
  }, [targetWeight, barbellWeight, unit, availablePlates, machineBaseWeight, isMachine, onCalculate]);

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setTargetWeight(value);
    }
  };

  const handleQuickAdjust = (amount: number) => {
    const current = parseFloat(targetWeight) || 0;
    // Round to 2dp so fractional increments never accumulate float noise.
    const newWeight = Math.max(baseWeight, Math.round((current + amount) * 100) / 100);
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
      {/* Equipment Mode Toggle */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-surface-300">Equipment</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setEquipmentMode('barbell')}
            aria-pressed={!isMachine}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              !isMachine
                ? 'bg-primary-700 text-white'
                : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
            }`}
          >
            Barbell
          </button>
          <button
            type="button"
            onClick={() => setEquipmentMode('machine')}
            aria-pressed={isMachine}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isMachine
                ? 'bg-primary-700 text-white'
                : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
            }`}
          >
            Machine (no bar)
          </button>
        </div>
      </div>

      {/* Starting Weight Input — machine mode only */}
      {isMachine && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-surface-300">
            Starting Weight <span className="text-xs text-surface-300">(machine base, 0 if plates only)</span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={startingWeight}
              onChange={handleStartingWeightChange}
              className="w-full px-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-surface-100 text-center focus:outline-none focus:border-primary-500"
              placeholder="0"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-300 font-medium">
              {unit}
            </span>
          </div>
        </div>
      )}

      {/* Weight Input with labeled ± steppers (step by the smallest plate pair) */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-surface-300">Target Weight</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuickAdjust(-increment)}
            aria-label={`Decrease target weight by ${increment}`}
            title={`−${increment}`}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-surface-700 text-base font-semibold text-surface-100 transition-colors hover:bg-surface-600 active:bg-surface-800"
          >
            −{increment}
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
            onClick={() => handleQuickAdjust(increment)}
            aria-label={`Increase target weight by ${increment}`}
            title={`+${increment}`}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-surface-700 text-base font-semibold text-surface-100 transition-colors hover:bg-surface-600 active:bg-surface-800"
          >
            +{increment}
          </button>
        </div>
      </div>

      {/* Weight Increment — which smallest plate pair the user owns */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-medium text-surface-300">Weight Increment</label>
          <span className="text-xs text-surface-300">smallest plates you have</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {smallestPlateOptions.map((plate) => (
            <button
              key={plate}
              type="button"
              onClick={() => handleSmallestPlateChange(plate)}
              aria-pressed={smallestPlate === plate}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                smallestPlate === plate
                  ? 'bg-primary-700 text-white'
                  : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
              }`}
            >
              <span className="block">±{plate * 2}{unit}</span>
              <span className={`block text-xs ${smallestPlate === plate ? 'text-white/75' : 'text-surface-300'}`}>
                {plate}{unit} plates
              </span>
            </button>
          ))}
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
          machineBaseWeight={machineBaseWeight}
          barbellWeight={barbellWeight}
          baseWeight={baseWeight}
          belowBase={belowBase}
          isClosestMatch={isClosestMatch}
        />
      </div>

      {/* Plate Breakdown */}
      {calculation.platesPerSide.length > 0 && (
        <PlateBreakdown
          calculation={calculation}
          unit={unit}
          isMachine={isMachine}
          barbellLabel={barbellWeights[barbellType].label}
        />
      )}
    </div>
  );
});

/**
 * Text-based plate breakdown / loading instructions.
 */
function PlateBreakdown({
  calculation,
  unit,
  isMachine,
  barbellLabel,
}: {
  calculation: PlateCalculationResult;
  unit: WeightUnit;
  isMachine: boolean;
  barbellLabel: string;
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
          Start with the {barbellLabel}
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
