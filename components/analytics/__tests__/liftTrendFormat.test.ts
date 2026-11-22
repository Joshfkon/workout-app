import {
  earlyLiftChange,
  estMaxLabel,
  moreWorkouts,
  nextTrendHint,
  setLabel,
  workoutsUntilTrend,
} from '../liftTrendFormat';

describe('liftTrendFormat', () => {
  it('labels a lifted set exactly (no plate rounding) and a no-load set by reps', () => {
    expect(setLabel(62, 8, 'kg')).toBe('62 kg × 8');
    expect(setLabel(83.9146, 8, 'lb')).toBe('185 lbs × 8');
    expect(setLabel(0, 6, 'kg')).toBe('6 reps');
  });

  it('labels an estimated max as an estimate, with the set it came from', () => {
    expect(estMaxLabel(102, { weightKg: 83.9146, reps: 8 }, 'lb')).toBe('Est. max 225.0 lbs (from 185 lbs × 8)');
    // Older persisted points carry no top set: the estimate alone, still labelled.
    expect(estMaxLabel(100, { weightKg: undefined, reps: undefined }, 'kg')).toBe('Est. max 100.0 kg');
    expect(estMaxLabel(100, null, 'kg')).toBe('Est. max 100.0 kg');
  });

  it('counts the workouts still needed for a trend', () => {
    expect(workoutsUntilTrend(1)).toBe(2);
    expect(workoutsUntilTrend(2)).toBe(1);
    expect(workoutsUntilTrend(5)).toBe(0);
    expect(moreWorkouts(1)).toBe('1 more workout');
    expect(moreWorkouts(2)).toBe('2 more workouts');
  });

  it('names the lift closest to a trend', () => {
    expect(
      nextTrendHint([
        { name: 'Lat Pulldown', sessions: 1, bestWeightKg: 55, bestReps: 10 },
        { name: 'Barbell Row', sessions: 2, bestWeightKg: 60, bestReps: 10 },
      ])
    ).toBe('Log Barbell Row in 1 more workout to see its trend.');
    expect(nextTrendHint([])).toBeNull();
    expect(nextTrendHint(undefined)).toBeNull();
  });

  it('shows first vs latest top set once a lift has two workouts', () => {
    const lift = {
      name: 'Bench',
      sessions: 2,
      bestWeightKg: 62.5,
      bestReps: 8,
      firstWeightKg: 60,
      firstReps: 8,
      latestWeightKg: 62.5,
      latestReps: 8,
    };
    expect(earlyLiftChange(lift, 'kg')).toBe('First 60 kg × 8 → latest 62.5 kg × 8');
    expect(earlyLiftChange({ ...lift, sessions: 1 }, 'kg')).toBeNull();
    // Summary persisted before first/latest were recorded.
    expect(earlyLiftChange({ name: 'Bench', sessions: 2, bestWeightKg: 60, bestReps: 8 }, 'kg')).toBeNull();
  });
});
