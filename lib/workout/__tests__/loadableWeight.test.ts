import { inputWeightToKg, lbsToKg } from '@/lib/utils';
import {
  loadGridForDisplay,
  loadStepForDisplay,
  snapSuggestedLoad,
  stepLoad,
  suggestedLoadForDisplay,
  typedLoadInUnit,
} from '@/lib/workout/loadableWeight';

/** What DECIMAL(6,2) storage does to a typed lb value. */
const storedFromLb = (lb: number) => Math.round(inputWeightToKg(lb, 'lb') * 100) / 100;

describe('loadStepForDisplay', () => {
  it('defaults lb steps by equipment when the exercise records no increment', () => {
    expect(loadStepForDisplay('lb', { equipmentClass: 'barbell' })).toBe(5);
    expect(loadStepForDisplay('lb', { equipmentClass: 'dumbbell' })).toBe(5);
    expect(loadStepForDisplay('lb', { equipmentClass: 'machine_pin_loaded' })).toBe(2.5);
    expect(loadStepForDisplay('lb', { equipmentClass: 'cable' })).toBe(2.5);
    expect(loadStepForDisplay('lb', {})).toBe(2.5);
  });

  it('converts the lb-native kg increments to clean lb steps', () => {
    expect(loadStepForDisplay('lb', { minIncrementKg: 2.27 })).toBe(5);
    expect(loadStepForDisplay('lb', { minIncrementKg: 1.13 })).toBe(2.5);
    expect(loadStepForDisplay('lb', { minIncrementKg: 4.54 })).toBe(10);
  });

  it('prefers the recorded increment set, then the plate choice, then the legacy increment', () => {
    // Stack machine with 2.5 lb add-ons: the smallest increment wins.
    expect(
      loadStepForDisplay('lb', { equipmentClass: 'machine_pin_loaded', availableIncrementsKg: [4.54, 1.13], minIncrementKg: 4.54 })
    ).toBe(2.5);
    // Owning 1.25 lb plates makes a barbell move in 2.5 lb steps.
    expect(loadStepForDisplay('lb', { equipmentClass: 'barbell', minIncrementKg: 2.27, smallestPlate: 1.25 })).toBe(2.5);
    // ...but a plate choice says nothing about a dumbbell rack.
    expect(loadStepForDisplay('lb', { equipmentClass: 'dumbbell', minIncrementKg: 2.27, smallestPlate: 1.25 })).toBe(5);
  });

  it('maps kg increments onto real kg steps (an lb-native 2.27 is not a kg step)', () => {
    expect(loadStepForDisplay('kg', { minIncrementKg: 2.27 })).toBe(2.5);
    expect(loadStepForDisplay('kg', { minIncrementKg: 1.13 })).toBe(1.25);
    expect(loadStepForDisplay('kg', { minIncrementKg: 4.54 })).toBe(5);
    expect(loadStepForDisplay('kg', { minIncrementKg: 2 })).toBe(2);
    expect(loadStepForDisplay('kg', { equipmentClass: 'barbell', smallestPlate: 1.25 })).toBe(2.5);
    expect(loadStepForDisplay('kg', {})).toBe(2.5);
  });
});

describe('snapSuggestedLoad — lb barbell (5 lb)', () => {
  it.each([
    [70, 155], // 154.3 lb
    [72.26, 160], // 159.3 lb
    [74.52, 165], // 164.3 lb
    [100, 220], // 220.5 lb
    [61.23, 135],
  ])('%p kg → %p lb', (kg, lb) => {
    expect(snapSuggestedLoad(kg, 'lb', 5)).toBe(lb);
  });
});

describe('snapSuggestedLoad — lb dumbbell / machine', () => {
  it('snaps a dumbbell to 5 lb', () => {
    expect(snapSuggestedLoad(27.5, 'lb', 5)).toBe(60); // 60.6 lb
    expect(snapSuggestedLoad(lbsToKg(47.6), 'lb', 5)).toBe(50);
  });

  it('snaps a machine to 2.5 lb', () => {
    expect(snapSuggestedLoad(27.5, 'lb', 2.5)).toBe(60);
    expect(snapSuggestedLoad(lbsToKg(63.4), 'lb', 2.5)).toBe(62.5);
  });

  it('never snaps a positive load to zero', () => {
    expect(snapSuggestedLoad(lbsToKg(2), 'lb', 5)).toBe(5);
    expect(snapSuggestedLoad(0, 'lb', 5)).toBe(0);
  });

  it('every snapped lb value is a whole number of steps', () => {
    for (let kg = 5; kg <= 250; kg += 0.37) {
      for (const step of [2.5, 5, 10]) {
        const lb = snapSuggestedLoad(kg, 'lb', step);
        expect(Number.isInteger(lb / step)).toBe(true);
      }
    }
  });
});

describe('snapSuggestedLoad — kg users', () => {
  it('lands on 2.5 kg steps (whole kg under 20 kg)', () => {
    expect(snapSuggestedLoad(72.64, 'kg', 2.5)).toBe(72.5); // an lb-native 160 lb prescription
    expect(snapSuggestedLoad(70.31, 'kg', 2.5)).toBe(70);
    expect(snapSuggestedLoad(81.4, 'kg', 2.5)).toBe(82.5);
    expect(snapSuggestedLoad(13.6, 'kg', 2.5)).toBe(14);
  });

  it('every snapped kg value at or above 20 kg is a multiple of 2.5', () => {
    for (let kg = 20; kg <= 250; kg += 0.37) {
      expect(Number.isInteger(snapSuggestedLoad(kg, 'kg', 2.5) / 2.5)).toBe(true);
    }
  });
});

describe('suggestedLoadForDisplay — repeating a logged set verbatim', () => {
  it('keeps the number an lb lifter typed, through the kg storage round-trip', () => {
    for (const typed of [155, 157, 152.5, 151.25, 60, 45, 315]) {
      const kg = storedFromLb(typed);
      expect(suggestedLoadForDisplay(kg, 'lb', 5, kg)).toBe(typed);
    }
  });

  it('round-trips every quarter-lb value a lifter could type, 1–700 lb', () => {
    for (let q = 4; q <= 2800; q++) {
      const typed = q / 4;
      const kg = storedFromLb(typed);
      expect(suggestedLoadForDisplay(kg, 'lb', 5, kg)).toBe(typed);
    }
  });

  it('snaps kg-native history shown to an lb lifter (the panel defect)', () => {
    expect(suggestedLoadForDisplay(27.5, 'lb', 5, 27.5)).toBe(60); // was 60.6
    expect(suggestedLoadForDisplay(70, 'lb', 5, 70)).toBe(155); // was 154.3
  });

  it('keeps a kg lifter’s typed number and snaps lb-native history', () => {
    expect(suggestedLoadForDisplay(72.5, 'kg', 2.5, 72.5)).toBe(72.5);
    expect(suggestedLoadForDisplay(71.25, 'kg', 2.5, 71.25)).toBe(71.25);
    expect(suggestedLoadForDisplay(70.31, 'kg', 2.5, 70.31)).toBe(70); // 155 lb logged earlier
  });

  it('snaps when the suggestion is not the logged value', () => {
    expect(suggestedLoadForDisplay(72.26, 'lb', 5, 70)).toBe(160);
    expect(suggestedLoadForDisplay(72.26, 'lb', 5)).toBe(160);
  });
});

describe('typedLoadInUnit', () => {
  it('recognises quarter-unit values within storage precision only', () => {
    expect(typedLoadInUnit(storedFromLb(135), 'lb')).toBe(135);
    expect(typedLoadInUnit(27.5, 'lb')).toBeNull();
    expect(typedLoadInUnit(70, 'kg')).toBe(70);
    expect(typedLoadInUnit(0, 'kg')).toBeNull();
  });
});

describe('stepLoad', () => {
  it('moves a full step from a grid value', () => {
    expect(stepLoad(155, 1, 5)).toBe(160);
    expect(stepLoad(155, -1, 5)).toBe(150);
    expect(stepLoad(72.5, 1, 2.5)).toBe(75);
  });

  it('steps an off-grid value onto the grid instead of carrying the decimal', () => {
    expect(stepLoad(154.3, 1, 5)).toBe(155);
    expect(stepLoad(154.3, -1, 5)).toBe(150);
    expect(stepLoad(60.6, 1, 2.5)).toBe(62.5);
  });

  it('never goes below zero and starts an empty field at one step', () => {
    expect(stepLoad(0, -1, 5)).toBe(0);
    expect(stepLoad(NaN, 1, 5)).toBe(5);
  });
});

describe('barbell grid is anchored at the bar (Codex review)', () => {
  // 45 lb bar + 5 lb smallest plates → 10 lb step: loadable loads are
  // 145 / 155 / 165, never 150.
  const grid = loadGridForDisplay('lb', { equipmentClass: 'barbell', minIncrementKg: 2.27, smallestPlate: 5 });

  it('offsets a 10 lb barbell step by the 45 lb bar', () => {
    expect(grid).toEqual({ step: 10, offset: 5 });
  });

  it('steps 145 → 155 and 155 → 145', () => {
    expect(stepLoad(145, 1, grid)).toBe(155);
    expect(stepLoad(155, -1, grid)).toBe(145);
    expect(stepLoad(150, 1, grid)).toBe(155); // off-grid → next loadable
    expect(stepLoad(150, -1, grid)).toBe(145);
  });

  it('snaps suggestions onto bar + plate pairs', () => {
    expect(snapSuggestedLoad(lbsToKg(150), 'lb', grid)).toBe(155); // tie rounds up
    expect(snapSuggestedLoad(lbsToKg(148), 'lb', grid)).toBe(145);
    expect(snapSuggestedLoad(lbsToKg(28), 'lb', grid)).toBe(25);
  });

  it('needs no offset when the bar is on the step grid, or for non-barbells', () => {
    expect(loadGridForDisplay('lb', { equipmentClass: 'barbell', minIncrementKg: 2.27 })).toEqual({ step: 5, offset: 0 });
    expect(loadGridForDisplay('kg', { equipmentClass: 'barbell', minIncrementKg: 2.27 })).toEqual({ step: 2.5, offset: 0 });
    expect(loadGridForDisplay('lb', { equipmentClass: 'dumbbell', minIncrementKg: 4.54 })).toEqual({ step: 10, offset: 0 });
  });

  it('every snapped barbell load is bar + whole plate pairs', () => {
    for (let kg = 25; kg <= 250; kg += 0.37) {
      const lb = snapSuggestedLoad(kg, 'lb', grid);
      expect(Number.isInteger((lb - 45) / 10)).toBe(true);
    }
  });
});
