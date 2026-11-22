/** The macro calculator's workouts field: a typed or saved 0 stays 0. */
import { workoutsCount } from '../MacroCalculatorModal';

describe('workoutsCount', () => {
  it('keeps 0 (a food-only tracker) instead of reading it as unset', () => {
    expect(workoutsCount('0')).toBe(0);
  });
  it('passes real counts through', () => {
    expect(workoutsCount('3')).toBe(3);
  });
  it('falls back to 4 for blank or junk input', () => {
    expect(workoutsCount('')).toBe(4);
    expect(workoutsCount('abc')).toBe(4);
    expect(workoutsCount('-2')).toBe(4);
  });
});
