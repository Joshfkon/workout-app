import { isActiveWorkoutRoute } from '../isActiveWorkoutRoute';

describe('isActiveWorkoutRoute', () => {
  it('returns true for active workout routes', () => {
    expect(isActiveWorkoutRoute('/dashboard/workout/abc-123')).toBe(true);
    expect(isActiveWorkoutRoute('/dashboard/workout/test-id')).toBe(true);
    expect(isActiveWorkoutRoute('/dashboard/workout/12345')).toBe(true);
  });

  it('returns false for non-workout routes', () => {
    expect(isActiveWorkoutRoute('/dashboard')).toBe(false);
    expect(isActiveWorkoutRoute('/dashboard/history')).toBe(false);
    expect(isActiveWorkoutRoute('/dashboard/analytics')).toBe(false);
    expect(isActiveWorkoutRoute('/dashboard/nutrition')).toBe(false);
    expect(isActiveWorkoutRoute('/dashboard/settings')).toBe(false);
  });

  it('returns false for null pathname', () => {
    expect(isActiveWorkoutRoute(null)).toBe(false);
  });

  it('returns false for undefined pathname', () => {
    expect(isActiveWorkoutRoute(undefined as any)).toBe(false);
  });
});
