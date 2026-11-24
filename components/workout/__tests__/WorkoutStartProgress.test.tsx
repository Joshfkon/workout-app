import { render, screen } from '@testing-library/react';
import {
  WorkoutStartProgress,
  WORKOUT_START_STEPS,
  prefetchWorkoutRoute,
  workoutStartLabel,
  workoutStartPercent,
} from '../WorkoutStartProgress';

describe('workout start progress (UX round 20)', () => {
  it('labels every stage with its step number', () => {
    expect(WORKOUT_START_STEPS.map((s) => workoutStartLabel(s.stage))).toEqual([
      'Checking your plan… (1 of 4)',
      'Picking weights… (2 of 4)',
      'Saving exercises… (3 of 4)',
      'Opening workout… (4 of 4)',
    ]);
  });

  it('moves the bar from the first stage and never reaches 100 before the screen opens', () => {
    const pcts = WORKOUT_START_STEPS.map((s) => workoutStartPercent(s.stage));
    expect(pcts[0]).toBeGreaterThan(0);
    expect(pcts[pcts.length - 1]).toBeLessThan(100);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
  });

  it('ticks finished steps and spins the current one', () => {
    render(<WorkoutStartProgress stage="saving" />);
    expect(screen.getAllByText('(done)')).toHaveLength(2);
    expect(screen.getByText('Saving your exercises…')).toBeInTheDocument();
    expect(screen.getByText('Opening the workout screen')).toBeInTheDocument();
  });

  it('prefetches the workout route and swallows prefetch errors', () => {
    const prefetch = jest.fn();
    prefetchWorkoutRoute({ prefetch }, 'abc');
    expect(prefetch).toHaveBeenCalledWith('/dashboard/workout/abc');
    expect(() =>
      prefetchWorkoutRoute(
        {
          prefetch: () => {
            throw new Error('x');
          },
        },
        'abc'
      )
    ).not.toThrow();
  });
});
