import { homeFocus, type HomeFocusInput } from '../homeFocus';

const foodOnly: HomeFocusInput = {
  completedWorkoutsCount: 0,
  recentCompletedWorkouts: 0,
  hasPlan: false,
  hasTodaysWorkout: false,
  hasRecentWeighIn: false,
  hasFoodToday: true,
  hasLoggedBodyOrFood: true,
};

describe('homeFocus', () => {
  it('leads with food for a user who logs food and has never lifted', () => {
    expect(homeFocus(foodOnly)).toBe('food');
  });

  it('leads with food for a lapsed lifter (none in 12 weeks) who weighs in', () => {
    expect(
      homeFocus({
        ...foodOnly,
        completedWorkoutsCount: 40,
        recentCompletedWorkouts: 0,
        hasFoodToday: false,
        hasLoggedBodyOrFood: undefined,
        hasRecentWeighIn: true,
      })
    ).toBe('food');
  });

  it('keeps the training layout for anyone with recent workouts', () => {
    expect(homeFocus({ ...foodOnly, completedWorkoutsCount: 12, recentCompletedWorkouts: 4 })).toBe(
      'training'
    );
  });

  it('keeps the training layout with an active plan or a workout today', () => {
    expect(homeFocus({ ...foodOnly, hasPlan: true })).toBe('training');
    expect(homeFocus({ ...foodOnly, hasTodaysWorkout: true })).toBe('training');
  });

  it('keeps the training layout for a brand-new user with nothing logged', () => {
    expect(
      homeFocus({
        ...foodOnly,
        hasFoodToday: false,
        hasRecentWeighIn: false,
        hasLoggedBodyOrFood: false,
      })
    ).toBe('training');
  });

  it('treats an unknown workout history as a lifter', () => {
    expect(
      homeFocus({ ...foodOnly, completedWorkoutsCount: undefined, recentCompletedWorkouts: undefined })
    ).toBe('training');
  });

  it('keeps a lapsed lifter on training unless their food or weight logs are recent', () => {
    const lapsed = { completedWorkoutsCount: 40, recentCompletedWorkouts: 0, hasPlan: false, hasTodaysWorkout: false };
    expect(homeFocus({ ...lapsed, hasRecentWeighIn: false, hasFoodToday: false, hasLoggedBodyOrFood: true })).toBe('training');
    expect(homeFocus({ ...lapsed, hasRecentWeighIn: true, hasFoodToday: false, hasLoggedBodyOrFood: true })).toBe('food');
  });
});
