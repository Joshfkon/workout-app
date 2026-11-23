import { deriveWorkoutLabel } from '@/lib/utils';

describe('deriveWorkoutLabel', () => {
  it('keeps the named splits', () => {
    expect(deriveWorkoutLabel([])).toBe('Workout');
    expect(deriveWorkoutLabel(['chest', 'back'])).toBe('Upper Body');
    expect(deriveWorkoutLabel(['back', 'biceps'])).toBe('Pull');
    expect(deriveWorkoutLabel(['quads', 'hamstrings'])).toBe('Lower Body');
  });

  it('one or two muscles are named', () => {
    expect(deriveWorkoutLabel(['lats'])).toBe('Lats');
    expect(deriveWorkoutLabel(['lateral_delts', 'biceps'])).toBe('Lateral Delts & Biceps');
  });

  it('three or more name the region, not a list that truncates into an exercise-like title', () => {
    expect(deriveWorkoutLabel(['lateral_delts', 'biceps', 'traps', 'rear_delts'])).toBe('Upper Body');
    expect(deriveWorkoutLabel(['glutes', 'calves', 'adductors'])).toBe('Lower Body');
    expect(deriveWorkoutLabel(['lats', 'glutes', 'abs'])).toBe('Full Body');
    expect(deriveWorkoutLabel(['triceps', 'biceps', 'abs'])).toBe('Upper Body');
  });
});
