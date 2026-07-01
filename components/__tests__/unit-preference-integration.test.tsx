import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SetLoggerRow } from '../workout/SetLoggerRow';
import { formatWeight, formatWeightValue, inputWeightToKg, convertWeight } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';

// Mock InfoTooltip to prevent rendering issues
jest.mock('@/components/ui', () => ({
  ...jest.requireActual('@/components/ui'),
  InfoTooltip: () => null,
}));

/**
 * Controlled harness matching how ExerciseCard drives SetLoggerRow:
 * weight/reps live in parent state (display units) and flow down as strings.
 */
function LoggerHarness({
  unit,
  initialWeight,
  initialReps = '10',
  onLog,
  minIncrementKg = 2.5,
}: {
  unit: WeightUnit;
  initialWeight: string;
  initialReps?: string;
  onLog: jest.Mock;
  minIncrementKg?: number;
}) {
  const [weight, setWeight] = React.useState(initialWeight);
  const [reps, setReps] = React.useState(initialReps);
  return (
    <SetLoggerRow
      setNumber={1}
      weight={weight}
      reps={reps}
      onWeightChange={setWeight}
      onRepsChange={setReps}
      targetRir={2}
      unit={unit}
      minIncrementKg={minIncrementKg}
      onLog={onLog}
    />
  );
}

describe('Unit Preference Integration', () => {
  describe('SetLoggerRow Component', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('displays weight with kg unit label for metric users', () => {
      render(<LoggerHarness unit="kg" initialWeight="100" onLog={jest.fn()} />);
      expect(screen.getByRole('button', { name: /Weight: 100 kg/ })).toBeInTheDocument();
    });

    test('displays weight with lbs unit label for imperial users', () => {
      render(<LoggerHarness unit="lb" initialWeight="220" onLog={jest.fn()} />);
      expect(screen.getByRole('button', { name: /Weight: 220 lbs/ })).toBeInTheDocument();
    });

    test('submits weight in kg regardless of display unit (metric)', () => {
      const onLog = jest.fn();
      render(<LoggerHarness unit="kg" initialWeight="100" onLog={onLog} />);

      // One tap: prefilled weight/reps + pre-selected RIR chip
      fireEvent.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onLog).toHaveBeenCalledTimes(1);
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 100,
          reps: 10,
          rpe: 7.5, // default RIR 2 converts to RPE 7.5
          feedback: expect.objectContaining({
            repsInTank: 2,
            form: 'clean',
          }),
        })
      );

      const submittedData = onLog.mock.calls[0][0];
      expect(typeof submittedData.weightKg).toBe('number');
      expect(typeof submittedData.reps).toBe('number');
      expect(typeof submittedData.rpe).toBe('number');
    });

    test('submits weight in kg regardless of display unit (imperial)', () => {
      const onLog = jest.fn();
      render(<LoggerHarness unit="lb" initialWeight="225" onLog={onLog} />);

      fireEvent.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onLog).toHaveBeenCalledTimes(1);
      const submittedData = onLog.mock.calls[0][0];
      // 225 lbs ~= 102.06 kg
      expect(submittedData.weightKg).toBeCloseTo(102.06, 0);
      expect(submittedData.reps).toBe(10);
      expect(submittedData.rpe).toBe(7.5);
    });

    test('stepper moves by the exercise increment converted to display units', () => {
      render(
        <LoggerHarness unit="lb" initialWeight="220" onLog={jest.fn()} minIncrementKg={2.5} />
      );

      // 2.5 kg = 5.51 lb, snapped to real 2.5 lb plate math -> 5 lb step
      fireEvent.click(screen.getByRole('button', { name: 'Increase weight' }));
      expect(screen.getByRole('button', { name: /Weight: 225 lbs/ })).toBeInTheDocument();
    });

    test('tapping the value swaps to a direct-entry input', () => {
      render(<LoggerHarness unit="kg" initialWeight="100" onLog={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Weight: 100 kg/ }));
      const input = screen.getByRole('spinbutton', { name: 'Weight' });
      fireEvent.change(input, { target: { value: '105' } });
      fireEvent.blur(input);

      expect(screen.getByRole('button', { name: /Weight: 105 kg/ })).toBeInTheDocument();
    });
  });

  describe('Weight Display Formatting', () => {
    test('formatWeight shows correct unit suffix for metric', () => {
      expect(formatWeight(100, 'kg')).toContain('kg');
      expect(formatWeight(100, 'kg')).not.toContain('lbs');
    });

    test('formatWeight shows correct unit suffix for imperial', () => {
      expect(formatWeight(100, 'lb')).toContain('lbs');
      expect(formatWeight(100, 'lb')).not.toContain('kg');
    });

    test('formatWeight converts and displays correctly for imperial', () => {
      const result = formatWeight(100, 'lb');
      // 100kg = 220.46 lbs, rounded to 220
      expect(result).toMatch(/220(\.\d)? lbs/);
    });

    test('formatWeightValue rounds suggestions to plate increments', () => {
      // 100kg = 220.46 lbs -> 220 (2.5 lb increments)
      expect(formatWeightValue(100, 'lb')).toBeCloseTo(220, 0);
      expect(formatWeightValue(100, 'kg')).toBe(100);
    });
  });

  describe('Weight Input Storage', () => {
    test('metric input stores directly in kg', () => {
      const storedKg = inputWeightToKg(100, 'kg');
      expect(storedKg).toBe(100);
    });

    test('imperial input converts to kg for storage', () => {
      const storedKg = inputWeightToKg(225, 'lb');
      // 225 lbs = 102.06 kg
      expect(storedKg).toBeCloseTo(102.06, 1);
    });

    test('round trip preserves weight accuracy (metric)', () => {
      const input = 100;
      const stored = inputWeightToKg(input, 'kg');
      const displayed = convertWeight(stored, 'kg', 'kg');
      expect(displayed).toBe(input);
    });

    test('round trip preserves weight accuracy (imperial)', () => {
      const input = 225;
      const stored = inputWeightToKg(input, 'lb');
      const displayed = convertWeight(stored, 'kg', 'lb');
      expect(displayed).toBeCloseTo(input, 1);
    });
  });

  describe('Common Workout Weights', () => {
    const COMMON_IMPERIAL_WEIGHTS = [45, 95, 135, 185, 225, 275, 315, 365, 405, 455, 495, 545];
    const COMMON_METRIC_WEIGHTS = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240];

    test('common imperial weights display correctly', () => {
      COMMON_IMPERIAL_WEIGHTS.forEach(lbs => {
        const storedKg = inputWeightToKg(lbs, 'lb');
        const displayed = convertWeight(storedKg, 'kg', 'lb');
        // Should be close to original
        expect(displayed).toBeCloseTo(lbs, 0);
      });
    });

    test('common metric weights display correctly', () => {
      COMMON_METRIC_WEIGHTS.forEach(kg => {
        const stored = inputWeightToKg(kg, 'kg');
        const displayed = convertWeight(stored, 'kg', 'kg');
        expect(displayed).toBe(kg);
      });
    });
  });

  describe('Body Weight Display', () => {
    test('displays body weight in user preferred unit (metric)', () => {
      const bodyWeightKg = 80;
      const displayedWeight = formatWeight(bodyWeightKg, 'kg');
      expect(displayedWeight).toContain('kg');
      expect(displayedWeight).toMatch(/80(\.\d)? kg/);
    });

    test('displays body weight in user preferred unit (imperial)', () => {
      const bodyWeightKg = 80;
      const displayedWeight = formatWeight(bodyWeightKg, 'lb');
      // 80kg = 176.37 lbs
      expect(displayedWeight).toContain('lbs');
      expect(displayedWeight).toMatch(/177(\.\d)? lbs|175(\.\d)? lbs/);
    });
  });

  describe('PR Display', () => {
    test('shows PRs in user preferred unit (metric)', () => {
      const prWeightKg = 140; // 3 plate bench in kg
      const displayed = formatWeight(prWeightKg, 'kg');
      expect(displayed).toContain('kg');
      expect(displayed).toMatch(/140(\.\d)? kg/);
    });

    test('shows PRs in user preferred unit (imperial)', () => {
      const prWeightKg = 140;
      const displayed = formatWeight(prWeightKg, 'lb');
      // 140kg = 308.65 lbs, rounded
      expect(displayed).toContain('lbs');
      const value = parseFloat(displayed);
      expect(value).toBeCloseTo(308.65, -1); // Within 10 lbs due to rounding
    });
  });
});

describe('Height Conversion Integration', () => {
  // These functions exist in BodyMeasurements component locally
  const cmToIn = (cm: number) => Math.round(cm / 2.54 * 10) / 10;
  const inToCm = (inches: number) => Math.round(inches * 2.54 * 10) / 10;

  test('converts cm to inches correctly', () => {
    expect(cmToIn(180)).toBeCloseTo(70.9, 1);
    expect(cmToIn(152.4)).toBeCloseTo(60, 1);
    expect(cmToIn(167.64)).toBeCloseTo(66, 1);
  });

  test('converts inches to cm correctly', () => {
    expect(inToCm(72)).toBeCloseTo(182.9, 0);
    expect(inToCm(66)).toBeCloseTo(167.6, 0);
  });

  test('round trip conversion preserves value', () => {
    const originalCm = 180;
    const inches = cmToIn(originalCm);
    const backToCm = inToCm(inches);
    expect(backToCm).toBeCloseTo(originalCm, 0);
  });
});
