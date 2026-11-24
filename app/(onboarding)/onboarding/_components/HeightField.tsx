'use client';

import { useRef } from 'react';
import { SegmentedControl } from '@/components/ui';
import type { LengthUnit } from '@/types/schema';

/** Whole feet + inches for a height in cm (inches never round up to 12). Pure. */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / 2.54);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

/** cm for feet + inches (either may be blank → 0). 0 when both are empty. Pure. */
export function feetInchesToCm(feetText: string, inchesText: string): number {
  const feet = parseFloat(feetText) || 0;
  const inches = parseFloat(inchesText) || 0;
  if (feet === 0 && inches === 0) return 0;
  return (feet * 12 + inches) * 2.54;
}

export interface HeightFieldProps {
  unit: LengthUnit;
  onUnitChange: (unit: LengthUnit) => void;
  cm: string;
  onCmChange: (value: string) => void;
  feet: string;
  onFeetChange: (value: string) => void;
  inches: string;
  onInchesChange: (value: string) => void;
}

const boxInput =
  'min-w-0 bg-transparent text-body text-ink tabular-nums placeholder:text-ink-3 focus:outline-none';

/**
 * Height as ONE field with a unit toggle (UX panel round 21: separate feet
 * and inches boxes were awkward). In ft/in the two numbers sit inside one
 * box, and typing the feet digit moves straight on to inches.
 */
export function HeightField({
  unit,
  onUnitChange,
  cm,
  onCmChange,
  feet,
  onFeetChange,
  inches,
  onInchesChange,
}: HeightFieldProps) {
  const inchesRef = useRef<HTMLInputElement>(null);
  return (
    <div data-testid="height-field">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label
          htmlFor={unit === 'cm' ? 'height-cm' : 'height-feet'}
          className="text-body font-medium text-ink"
        >
          Height
        </label>
        <SegmentedControl<LengthUnit>
          label="Height unit"
          value={unit}
          onChange={onUnitChange}
          options={[
            { value: 'cm', label: 'cm' },
            { value: 'in', label: 'ft & in' },
          ]}
          className="w-36"
        />
      </div>
      <div className="flex min-h-[44px] items-center gap-2 rounded-input border border-sep bg-fill/50 px-3 focus-within:border-action">
        {unit === 'cm' ? (
          <>
            <input
              id="height-cm"
              aria-label="Height (cm)"
              type="number"
              inputMode="decimal"
              value={cm}
              onChange={(e) => onCmChange(e.target.value)}
              placeholder="175"
              min={100}
              max={250}
              className={`${boxInput} flex-1`}
            />
            <span className="text-body text-ink-2">cm</span>
          </>
        ) : (
          <>
            <input
              id="height-feet"
              aria-label="Height, feet"
              type="number"
              inputMode="numeric"
              value={feet}
              onChange={(e) => {
                const next = e.target.value;
                onFeetChange(next);
                // One digit is a whole answer (3–8 ft): go straight to inches.
                if (/^[3-8]$/.test(next)) inchesRef.current?.focus();
              }}
              placeholder="5"
              min={3}
              max={8}
              className={`${boxInput} w-12 flex-none text-center`}
            />
            <span className="text-body text-ink-2">ft</span>
            <input
              ref={inchesRef}
              aria-label="Height, inches"
              type="number"
              inputMode="numeric"
              value={inches}
              onChange={(e) => onInchesChange(e.target.value)}
              placeholder="9"
              min={0}
              max={11}
              className={`${boxInput} w-12 flex-none text-center`}
            />
            <span className="text-body text-ink-2">in</span>
          </>
        )}
      </div>
    </div>
  );
}
