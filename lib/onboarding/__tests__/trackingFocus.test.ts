import { resolveFoodOnly } from '../trackingFocus';

describe('resolveFoodOnly', () => {
  const food = { statedFocus: 'food' as const, alsoLifts: undefined, hasCompletedWorkout: false };

  it('is food-only for a stated food tracker with no workouts', () => {
    expect(resolveFoodOnly(food)).toBe(true);
  });

  it('never applies to anyone who did not answer "food tracking"', () => {
    expect(resolveFoodOnly({ ...food, statedFocus: null })).toBe(false);
    expect(resolveFoodOnly({ ...food, statedFocus: undefined })).toBe(false);
  });

  it('"I also lift weights" turns lifting back on', () => {
    expect(resolveFoodOnly({ ...food, alsoLifts: true })).toBe(false);
    expect(resolveFoodOnly({ ...food, alsoLifts: false })).toBe(true);
  });

  it('a completed workout turns lifting back on', () => {
    expect(resolveFoodOnly({ ...food, hasCompletedWorkout: true })).toBe(false);
  });

  it('treats an unknown workout history as lifting', () => {
    expect(resolveFoodOnly({ ...food, hasCompletedWorkout: undefined })).toBe(false);
  });
});
