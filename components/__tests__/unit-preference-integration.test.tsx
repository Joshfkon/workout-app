import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SetInputRow } from '../workout/SetInputRow';
import { formatWeight, formatWeightValue, inputWeightToKg, convertWeight } from '@/lib/utils';

// Mock the progressionEngine service
jest.mock('@/services/progressionEngine', () => ({
  calculateSetQuality: jest.fn(() => ({
    quality: 'effective',
    reason: 'Good set within target range',
  })),
}));

// Mock InfoTooltip to prevent rendering issues
jest.mock('@/components/ui', () => ({
  ...jest.requireActual('@/components/ui'),
  InfoTooltip: () => null,
}));

describe('Unit Preference Integration', () => {
  describe('SetInputRow Component', () => {
    const defaultProps = {
      setNumber: 1,
      targetWeight: 100, // 100kg
      targetRepRange: [8, 12] as [number, number],
      targetRir: 2,
      isLastSet: false,
      onSubmit: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('displays weight label in kg for metric users', () => {
      render(<SetInputRow {...defaultProps} unit="kg" />);
      expect(screen.getByText('Weight (kg)')).toBeInTheDocument();
    });

    test('displays weight label in lb for imperial users', () => {
      render(<SetInputRow {...defaultProps} unit="lb" />);
      expect(screen.getByText('Weight (lb)')).toBeInTheDocument();
    });

    test('converts target weight to display unit for initial value (kg)', () => {
      render(<SetInputRow {...defaultProps} unit="kg" />);

      // Use getAllByRole and find the first number input (weight)
      const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      const weightInput = inputs[0]; // First input is weight
      // 100kg stays as 100kg (rounded to plate increment)
      expect(parseFloat(weightInput.value)).toBe(100);
    });

    test('converts target weight to display unit for initial value (lb)', () => {
      render(<SetInputRow {...defaultProps} unit="lb" />);

      const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      const weightInput = inputs[0]; // First input is weight
      // 100kg = 220.46 lbs, rounded to 2.5lb = 220
      expect(parseFloat(weightInput.value)).toBeCloseTo(220, 0);
    });

    test('submits weight in kg regardless of display unit (metric)', async () => {
      const onSubmit = jest.fn();
      render(<SetInputRow {...defaultProps} unit="kg" onSubmit={onSubmit} />);

      const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      const [weightInput, repsInput] = inputs;
      const buttons = screen.getAllByRole('button');
      const proceedButton = buttons.find(btn => btn.querySelector('svg')); // Button with arrow icon

      fireEvent.change(weightInput, { target: { value: '100' } });
      fireEvent.change(repsInput, { target: { value: '10' } });

      // Click proceed to go to feedback phase
      expect(proceedButton).toBeTruthy();
      fireEvent.click(proceedButton!);

      // Wait for feedback phase to render - use waitFor for more reliable waiting
      await waitFor(() => {
        expect(screen.getByText('Reps left in tank?')).toBeInTheDocument();
      });

      // Now we're in feedback phase - find RIR selector buttons
      // RIRSelector shows buttons with labels like "2-3", "1", "4+", "Maxed"
      const allButtons = screen.getAllByRole('button');
      const rirButton = allButtons.find(btn =>
        btn.textContent?.includes('2-3') ||
        btn.textContent?.includes('Good')
      );

      expect(rirButton).toBeTruthy();
      if (rirButton) {
        fireEvent.click(rirButton);
      }

      // Find form selector button (Clean, Some Breakdown, Ugly)
      const formButton = allButtons.find(btn =>
        btn.textContent?.includes('Clean') &&
        !btn.textContent?.includes('Save')
      );

      expect(formButton).toBeTruthy();
      if (formButton) {
        fireEvent.click(formButton);
      }

      // Find and click Save Set button
      const saveButton = allButtons.find(btn =>
        btn.textContent?.includes('Save Set')
      );

      expect(saveButton).toBeTruthy();
      expect(saveButton).not.toBeDisabled();
      if (saveButton) {
        fireEvent.click(saveButton);
      }

      // Verify submission - weight should be stored in kg
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 100, // 100kg stored as 100kg
          reps: 10,
          rpe: 7.5, // RIR 2 converts to RPE 7.5
          feedback: expect.objectContaining({
            repsInTank: 2, // Selected "2-3" RIR
            form: 'clean', // Selected "Clean" form
          }),
        })
      );

      // Verify weightKg is a number, not a string
      const submittedData = onSubmit.mock.calls[0][0];
      expect(typeof submittedData.weightKg).toBe('number');
      expect(typeof submittedData.reps).toBe('number');
      expect(typeof submittedData.rpe).toBe('number');
    });

    test('submits weight in kg regardless of display unit (imperial)', async () => {
      const onSubmit = jest.fn();
      render(<SetInputRow {...defaultProps} unit="lb" onSubmit={onSubmit} />);

      const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      const [weightInput, repsInput] = inputs;
      const buttons = screen.getAllByRole('button');
      const proceedButton = buttons.find(btn => btn.querySelector('svg')); // Button with arrow icon

      fireEvent.change(weightInput, { target: { value: '225' } });
      fireEvent.change(repsInput, { target: { value: '10' } });

      // Click proceed to go to feedback phase
      expect(proceedButton).toBeTruthy();
      fireEvent.click(proceedButton!);

      // Wait for feedback phase to render - use waitFor for more reliable waiting
      await waitFor(() => {
        expect(screen.getByText('Reps left in tank?')).toBeInTheDocument();
      });

      // Now we're in feedback phase - find RIR and Form selectors
      const allButtons = screen.getAllByRole('button');

      // Find RIR selector button (shows "2-3" or "Good")
      const rirButton = allButtons.find(btn =>
        btn.textContent?.includes('2-3') ||
        btn.textContent?.includes('Good')
      );

      expect(rirButton).toBeTruthy();
      if (rirButton) {
        fireEvent.click(rirButton);
      }

      // Find form selector button (shows "Clean")
      const formButton = allButtons.find(btn =>
        btn.textContent?.includes('Clean') &&
        !btn.textContent?.includes('Save')
      );

      expect(formButton).toBeTruthy();
      if (formButton) {
        fireEvent.click(formButton);
      }

      // Find and click Save Set button
      const saveButton = allButtons.find(btn => 
        btn.textContent?.includes('Save Set')
      );
      
      expect(saveButton).toBeTruthy();
      expect(saveButton).not.toBeDisabled();
      if (saveButton) {
        fireEvent.click(saveButton);
      }

      // Verify the conversion is correct (225lbs ~= 102.06kg)
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: expect.any(Number), // 225lbs converted to kg
          reps: 10,
          rpe: 7.5, // RIR 2 converts to RPE 7.5
          feedback: expect.objectContaining({
            repsInTank: 2, // Selected "2-3" RIR
            form: 'clean', // Selected "Clean" form
          }),
        })
      );
      
      const submittedData = onSubmit.mock.calls[0][0];
      const submittedKg = submittedData.weightKg;
      expect(submittedKg).toBeCloseTo(102.06, 0);
      
      // Verify all values are numbers, not strings
      expect(typeof submittedData.weightKg).toBe('number');
      expect(typeof submittedData.reps).toBe('number');
      expect(typeof submittedData.rpe).toBe('number');
    });

    test('displays previous set weight in user preferred unit', () => {
      const previousSet = {
        id: 'prev-1',
        exerciseBlockId: 'block-1',
        setNumber: 1,
        weightKg: 100, // Stored in kg
        reps: 10,
        rpe: 8,
        restSeconds: null,
        isWarmup: false,
        setType: 'normal' as const,
        parentSetId: null,
        quality: 'effective' as const,
        qualityReason: 'Good set',
        note: null,
        loggedAt: new Date().toISOString(),
      };

      // Render with imperial preference
      render(
        <SetInputRow
          {...defaultProps}
          unit="lb"
          previousSet={previousSet}
        />
      );

      const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      const weightInput = inputs[0];
      // 100kg = 220.46 lbs, should show ~220lbs
      expect(parseFloat(weightInput.value)).toBeCloseTo(220, 0);
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
