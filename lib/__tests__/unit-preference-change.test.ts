import {
  convertWeight,
  formatWeight,
  formatWeightValue,
  inputWeightToKg,
  kgToLbs,
  lbsToKg,
} from '../utils';

describe('Unit Preference Changes', () => {
  describe('changing preference updates displayed values correctly', () => {
    // Simulate a user who logs workouts and then changes their unit preference

    const workoutData = {
      // All weights stored in kg (canonical storage unit)
      benchPress: 100, // kg
      squat: 140, // kg
      deadlift: 180, // kg
      overheadPress: 60, // kg
    };

    test('metric to imperial: all weights convert correctly', () => {
      // User originally in metric, switches to imperial
      const originalPreference = 'kg' as const;
      const newPreference = 'lb' as const;

      // Before: displayed in kg
      const benchBefore = formatWeight(workoutData.benchPress, originalPreference);
      expect(benchBefore).toBe('100.0 kg');

      // After: displayed in lbs
      const benchAfter = formatWeight(workoutData.benchPress, newPreference);
      expect(benchAfter).toMatch(/220(\.\d)? lbs/);

      // Verify all weights
      const squatAfter = formatWeight(workoutData.squat, newPreference);
      expect(squatAfter).toMatch(/307|310(\.\d)? lbs/); // 140kg = ~308 lbs

      const deadliftAfter = formatWeight(workoutData.deadlift, newPreference);
      expect(deadliftAfter).toMatch(/395|397|400(\.\d)? lbs/); // 180kg = ~396 lbs

      const ohpAfter = formatWeight(workoutData.overheadPress, newPreference);
      expect(ohpAfter).toMatch(/132|135(\.\d)? lbs/); // 60kg = ~132 lbs
    });

    test('imperial to metric: all weights convert correctly', () => {
      // Simulate data originally entered in imperial, stored as kg
      const imperialInputs = {
        benchPress: 225, // lbs entered
        squat: 315, // lbs entered
        deadlift: 405, // lbs entered
        overheadPress: 135, // lbs entered
      };

      // Convert to storage (kg)
      const storedData = {
        benchPress: inputWeightToKg(imperialInputs.benchPress, 'lb'),
        squat: inputWeightToKg(imperialInputs.squat, 'lb'),
        deadlift: inputWeightToKg(imperialInputs.deadlift, 'lb'),
        overheadPress: inputWeightToKg(imperialInputs.overheadPress, 'lb'),
      };

      // Display in imperial (original preference)
      expect(formatWeight(storedData.benchPress, 'lb')).toMatch(/225(\.\d)? lbs/);

      // Switch to metric
      const benchMetric = formatWeight(storedData.benchPress, 'kg');
      expect(benchMetric).toMatch(/102|100(\.\d)? kg/); // 225lbs = ~102kg

      const squatMetric = formatWeight(storedData.squat, 'kg');
      expect(squatMetric).toMatch(/142|143|145(\.\d)? kg/); // 315lbs = ~143kg
    });

    test('historical data remains accurate after preference change', () => {
      // Simulate workout history
      const workoutHistory = [
        { date: '2024-01-01', weightKg: 100, reps: 10 },
        { date: '2024-01-08', weightKg: 102.5, reps: 10 },
        { date: '2024-01-15', weightKg: 105, reps: 10 },
      ];

      // User was in metric, switches to imperial
      const displayedInMetric = workoutHistory.map(w => ({
        ...w,
        displayedWeight: formatWeightValue(w.weightKg, 'kg'),
      }));

      const displayedInImperial = workoutHistory.map(w => ({
        ...w,
        displayedWeight: formatWeightValue(w.weightKg, 'lb'),
      }));

      // Metric values should be the original values (with rounding)
      expect(displayedInMetric[0].displayedWeight).toBe(100);
      expect(displayedInMetric[1].displayedWeight).toBe(102.5);
      expect(displayedInMetric[2].displayedWeight).toBe(105);

      // Imperial values should be converted (accounting for 2.5lb rounding)
      // formatWeightValue uses roundToIncrement with 2.5 increments
      // 100kg = 220.46lbs -> rounds to 220
      expect(displayedInImperial[0].displayedWeight).toBeCloseTo(220, 0);
      // 102.5kg = 226.0lbs -> rounds to 225 (226/2.5 = 90.4 -> 90 * 2.5 = 225)
      expect(displayedInImperial[1].displayedWeight).toBeCloseTo(225, 0);
      // 105kg = 231.5lbs -> rounds to 232.5 (231.5/2.5 = 92.6 -> 93 * 2.5 = 232.5)
      expect(displayedInImperial[2].displayedWeight).toBeCloseTo(232.5, 0);

      // Verify progression is still visible in both units
      const progressionKg = displayedInMetric[2].displayedWeight - displayedInMetric[0].displayedWeight;
      const progressionLb = displayedInImperial[2].displayedWeight - displayedInImperial[0].displayedWeight;

      expect(progressionKg).toBe(5); // 5kg increase
      // 232.5 - 220 = 12.5 lbs (due to rounding, 5kg increase shows as ~12.5lb)
      expect(progressionLb).toBeCloseTo(12.5, 0);
    });

    test('PR values remain accurate after preference change', () => {
      // User's PR stored in kg
      const prWeightKg = 140; // 3 plate bench

      // Displayed in metric
      const prMetric = formatWeight(prWeightKg, 'kg');
      expect(prMetric).toMatch(/140(\.\d)? kg/);

      // After switching to imperial
      const prImperial = formatWeight(prWeightKg, 'lb');
      // 140kg = 308.65 lbs
      const valueMatch = prImperial.match(/(\d+\.?\d*)/);
      expect(valueMatch).not.toBeNull();
      const prInLbs = parseFloat(valueMatch![1]);
      expect(prInLbs).toBeCloseTo(307.5, 0); // Rounded to 2.5 increment
    });
  });

  describe('data integrity during preference changes', () => {
    test('switching units multiple times preserves data', () => {
      const originalKg = 100;

      // kg -> lb -> kg
      const toLb = convertWeight(originalKg, 'kg', 'lb');
      const backToKg = convertWeight(toLb, 'lb', 'kg');
      expect(backToKg).toBeCloseTo(originalKg, 5);

      // kg -> lb -> kg -> lb -> kg
      const chain1 = convertWeight(originalKg, 'kg', 'lb');
      const chain2 = convertWeight(chain1, 'lb', 'kg');
      const chain3 = convertWeight(chain2, 'kg', 'lb');
      const chain4 = convertWeight(chain3, 'lb', 'kg');
      expect(chain4).toBeCloseTo(originalKg, 5);
    });

    test('stored values are independent of display preference', () => {
      // User logs workout in imperial
      const enteredLbs = 225;
      const storedKg = inputWeightToKg(enteredLbs, 'lb');

      // User can view in either unit
      const displayedLb = convertWeight(storedKg, 'kg', 'lb');
      const displayedKg = convertWeight(storedKg, 'kg', 'kg');

      expect(displayedLb).toBeCloseTo(225, 1);
      expect(displayedKg).toBeCloseTo(102.06, 1);

      // Stored value remains constant
      expect(storedKg).toBeCloseTo(102.06, 1);
    });
  });

  describe('edge cases during preference changes', () => {
    test('zero weight handles preference change', () => {
      expect(formatWeight(0, 'kg')).toBe('0.0 kg');
      expect(formatWeight(0, 'lb')).toBe('0.0 lbs');
    });

    test('very small weights handle preference change', () => {
      const smallKg = 0.5;
      const inLbs = formatWeight(smallKg, 'lb');
      // 0.5kg = 1.1 lbs, rounded to 0 or 2.5
      expect(inLbs).toMatch(/\d+\.?\d* lbs/);
    });

    test('very large weights handle preference change', () => {
      const largeKg = 500;
      const inLbs = formatWeight(largeKg, 'lb');
      // 500kg = 1102.3 lbs
      const valueMatch = inLbs.match(/(\d+\.?\d*)/);
      expect(valueMatch).not.toBeNull();
      expect(parseFloat(valueMatch![1])).toBeGreaterThan(1000);
    });
  });
});
