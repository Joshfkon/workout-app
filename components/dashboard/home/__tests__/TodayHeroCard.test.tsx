import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TodayHeroCard,
  TodaysWorkout,
  MealHeroSuggestion,
  heroOffersWorkoutStart,
  todayHeroVariant,
} from '../TodayHeroCard';

const mockStart = jest.fn();
jest.mock('@/hooks/useStartEmptyWorkout', () => ({
  useStartEmptyWorkout: () => ({ start: mockStart, isStarting: false, error: null }),
}));

const baseWorkout: TodaysWorkout = {
  id: 'sess-1',
  name: 'Hypertrophy Block',
  state: 'planned',
  exercises: 5,
  completedSets: 0,
  totalSets: 15,
};

const meal: MealHeroSuggestion = {
  title: 'Log dinner',
  timeLabel: '6:58 PM',
  meta: "1,888 kcal and 135g protein still to go — you're behind pace",
};

describe('TodayHeroCard — planned-session copy (audit note 4)', () => {
  it('shows exercise/set counts when the session has blocks', () => {
    render(
      <TodayHeroCard
        workout={baseWorkout}
        scheduled={null}
        hasPlan
        mesocycleName="Block 1"
      />
    );

    expect(screen.getByText('5 exercises · 0/15 sets')).toBeInTheDocument();
  });

  it('shows the scheduled day instead of "0 exercises · 0/0 sets" for a block-less session', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, exercises: 0, totalSets: 0 }}
        scheduled={{ dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] }}
        hasPlan
        mesocycleName="Block 1"
      />
    );

    expect(screen.getByText('Push')).toBeInTheDocument();
    expect(screen.queryByText(/0 exercises/)).not.toBeInTheDocument();
    // Still the primary session CTA, linking to the session
    expect(screen.getByText('Start workout')).toBeInTheDocument();
  });

  it('falls back to explanatory copy when no scheduled-day summary exists', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, exercises: 0, totalSets: 0 }}
        scheduled={null}
        hasPlan
        mesocycleName="Block 1"
      />
    );

    expect(screen.getByText('Exercises are planned when you start')).toBeInTheDocument();
    expect(screen.queryByText(/0 exercises/)).not.toBeInTheDocument();
  });

  it('keeps counts for an in-progress session with logged work', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, state: 'in_progress', completedSets: 6 }}
        scheduled={null}
        hasPlan
        mesocycleName="Block 1"
      />
    );

    expect(screen.getByText('5 exercises · 6/15 sets')).toBeInTheDocument();
    expect(screen.getByText('Continue workout')).toBeInTheDocument();
  });
});

describe('TodayHeroCard — next-up recommendation', () => {
  it('recommends the workout over the meal while a session is pending', () => {
    render(
      <TodayHeroCard
        workout={baseWorkout}
        scheduled={{ dayName: 'Chest & Back', muscles: ['chest', 'back'] }}
        hasPlan
        mesocycleName="Arnold"
        eyebrowContext="Arnold wk 1"
        workoutMeta="7 exercises · est. 65 min · all target muscles recovered"
        meal={meal}
      />
    );

    expect(screen.getByText('Chest & Back')).toBeInTheDocument();
    expect(screen.getByText('7 exercises · est. 65 min · all target muscles recovered')).toBeInTheDocument();
    expect(screen.getByText('Start workout')).toBeInTheDocument();
    expect(screen.queryByText('Log dinner')).not.toBeInTheDocument();
  });

  it('recommends the next meal once the workout is completed', async () => {
    const onLogFood = jest.fn();
    const user = userEvent.setup();
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, state: 'completed', completedSets: 15 }}
        scheduled={{ dayName: 'Chest & Back', muscles: ['chest', 'back'] }}
        hasPlan
        mesocycleName="Arnold"
        meal={meal}
        onLogFood={onLogFood}
      />
    );

    expect(screen.getByText('Log dinner')).toBeInTheDocument();
    expect(screen.getByText(/1,888 kcal and 135g protein still to go/)).toBeInTheDocument();
    expect(screen.queryByText('Start workout')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    expect(onLogFood).toHaveBeenCalled();
  });

  it('recommends the next meal on a rest day (no session, no scheduled day)', () => {
    render(
      <TodayHeroCard workout={null} scheduled={null} hasPlan mesocycleName="Arnold" meal={meal} />
    );

    expect(screen.getByText('Log dinner')).toBeInTheDocument();
    expect(screen.getByText(/Next up · 6:58 PM/i)).toBeInTheDocument();
  });

  it('keeps the plan CTA over the meal when there is no active mesocycle', () => {
    render(
      <TodayHeroCard
        workout={null}
        scheduled={null}
        hasPlan={false}
        mesocycleName={null}
        meal={meal}
      />
    );

    expect(screen.getByText('Ready to train?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeInTheDocument();
    expect(screen.getByText('Build a program')).toBeInTheDocument();
    expect(screen.queryByText('Log dinner')).not.toBeInTheDocument();
  });

  it('shows the done state for a completed quick workout without a plan', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, state: 'completed', completedSets: 15 }}
        scheduled={null}
        hasPlan={false}
        mesocycleName={null}
        meal={meal}
      />
    );

    expect(screen.getByText('View workout')).toBeInTheDocument();
    expect(screen.queryByText('Log dinner')).not.toBeInTheDocument();
  });

  it('shows a quiet "More options" link to the Train tab under the Start hero', () => {
    render(
      <TodayHeroCard
        workout={baseWorkout}
        scheduled={null}
        hasPlan
        mesocycleName="Block 1"
      />
    );

    const link = screen.getByRole('link', { name: 'More options' });
    expect(link).toHaveAttribute('href', '/dashboard/train');
  });

  it('shows the "More options" link in the no-plan state too', () => {
    render(
      <TodayHeroCard
        workout={null}
        scheduled={null}
        hasPlan={false}
        mesocycleName={null}
      />
    );

    expect(screen.getByRole('link', { name: 'More options' })).toHaveAttribute(
      'href',
      '/dashboard/train'
    );
  });

  it('does not add the link to the meal or done heroes', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, state: 'completed', completedSets: 15 }}
        scheduled={null}
        hasPlan
        mesocycleName="Arnold"
        meal={meal}
      />
    );

    expect(screen.queryByRole('link', { name: 'More options' })).not.toBeInTheDocument();
  });

  it('falls back to the done state when the workout is complete and no meal is suggested', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, state: 'completed', completedSets: 15 }}
        scheduled={{ dayName: 'Chest & Back', muscles: ['chest', 'back'] }}
        hasPlan
        mesocycleName="Arnold"
        meal={null}
      />
    );

    expect(screen.getByText('View workout')).toBeInTheDocument();
    expect(screen.getByText('Chest & Back')).toBeInTheDocument();
  });
});

describe('TodayHeroCard — start workout handler (bugfix)', () => {
  it('calls onStartWorkout when Start workout is clicked on a scheduled workout', async () => {
    const onStartWorkout = jest.fn();
    const user = userEvent.setup();
    
    render(
      <TodayHeroCard
        workout={null}
        scheduled={{ dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] }}
        hasPlan
        mesocycleName="Arnold"
        eyebrowContext="Arnold wk 5"
        onStartWorkout={onStartWorkout}
      />
    );

    const button = screen.getByRole('button', { name: 'Start workout' });
    await user.click(button);
    
    expect(onStartWorkout).toHaveBeenCalledTimes(1);
  });

  it('shows Starting... and disables button while starting', () => {
    const onStartWorkout = jest.fn();
    
    render(
      <TodayHeroCard
        workout={null}
        scheduled={{ dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] }}
        hasPlan
        mesocycleName="Arnold"
        onStartWorkout={onStartWorkout}
        isStarting
      />
    );

    const button = screen.getByRole('button', { name: 'Starting...' });
    expect(button).toBeDisabled();
  });

  it('disables button when no onStartWorkout handler is provided', () => {
    render(
      <TodayHeroCard
        workout={null}
        scheduled={{ dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] }}
        hasPlan
        mesocycleName="Arnold"
      />
    );

    const button = screen.getByRole('button', { name: 'Start workout' });
    expect(button).toBeDisabled();
  });
});

describe('TodayHeroCard — freestyle training style', () => {
  it('invites a workout instead of a mesocycle when nothing is logged today', () => {
    render(<TodayHeroCard workout={null} hasPlan={false} freestyle mesocycleName={null} />);

    expect(screen.getByText('Ready to train?')).toBeInTheDocument();
    // One tap into an empty workout; repeat / AI suggestion live on Train.
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Repeat or get a suggestion' })).toHaveAttribute(
      'href',
      '/dashboard/train'
    );
    expect(screen.queryByText(/no training plan yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plan a mesocycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/what's a mesocycle/i)).not.toBeInTheDocument();
  });

  it('renders the caller-supplied secondary starts in place of the Train link', () => {
    render(
      <TodayHeroCard
        workout={null}
        hasPlan={false}
        freestyle
        mesocycleName={null}
        freestyleActions={<button type="button">Repeat Pull</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'Start workout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repeat Pull' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Repeat or get a suggestion' })
    ).not.toBeInTheDocument();
  });

  it("shows today's freestyle workout while it is in progress", () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, name: "Today's workout", state: 'in_progress', completedSets: 4 }}
        hasPlan={false}
        freestyle
        mesocycleName={null}
      />
    );

    expect(screen.getByText('Continue workout')).toBeInTheDocument();
    expect(screen.queryByText('Ready to train?')).not.toBeInTheDocument();
  });

  it('suggests the next meal after training, as it does with a plan', () => {
    render(
      <TodayHeroCard
        workout={{ ...baseWorkout, state: 'completed' }}
        hasPlan={false}
        freestyle
        mesocycleName={null}
        meal={meal}
      />
    );

    expect(screen.getByText('Log dinner')).toBeInTheDocument();
  });
});


describe('TodayHeroCard — no plan: one tap into a workout', () => {
  it('Start workout opens an empty workout directly (no confirm screen)', async () => {
    const user = userEvent.setup();
    render(
      <TodayHeroCard workout={null} scheduled={null} hasPlan={false} mesocycleName={null} meal={null} />
    );
    await user.click(screen.getByRole('button', { name: 'Start workout' }));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: /quick workout/i })).not.toBeInTheDocument();
  });
});

describe('todayHeroVariant / heroOffersWorkoutStart', () => {
  const scheduled = { dayName: 'Push', muscles: ['chest'] };

  it('a pending or in-progress workout offers a start', () => {
    for (const state of ['planned', 'in_progress'] as const) {
      const v = todayHeroVariant({ workout: { ...baseWorkout, state }, hasPlan: true, meal });
      expect(v).toBe('workout');
      expect(heroOffersWorkoutStart(v)).toBe(true);
    }
  });

  it('a scheduled day without a session offers a start', () => {
    const v = todayHeroVariant({ workout: null, scheduled, hasPlan: true, meal });
    expect(v).toBe('scheduled');
    expect(heroOffersWorkoutStart(v)).toBe(true);
  });

  it('meal, done and rest-day heroes do not offer a start', () => {
    const done = { ...baseWorkout, state: 'completed' as const };
    expect(todayHeroVariant({ workout: done, hasPlan: true, meal })).toBe('meal');
    expect(todayHeroVariant({ workout: done, hasPlan: true, meal: null })).toBe('done');
    expect(todayHeroVariant({ workout: null, hasPlan: true, meal: null })).toBe('none');
    for (const v of ['meal', 'done', 'none'] as const) expect(heroOffersWorkoutStart(v)).toBe(false);
  });

  it('freestyle and no-plan heroes offer a start', () => {
    expect(todayHeroVariant({ workout: null, hasPlan: false, freestyle: true, meal: null })).toBe('freestyle');
    expect(todayHeroVariant({ workout: null, hasPlan: false, meal })).toBe('no-plan');
    expect(heroOffersWorkoutStart('freestyle')).toBe(true);
    expect(heroOffersWorkoutStart('no-plan')).toBe(true);
  });
});

describe('TodayHeroCard — food-focused Home', () => {
  it('shows the meal hero without a plan instead of "Ready to train?"', () => {
    expect(todayHeroVariant({ workout: null, hasPlan: false, meal, foodFocus: true })).toBe('meal');
    render(<TodayHeroCard workout={null} hasPlan={false} mesocycleName={null} meal={meal} foodFocus />);
    expect(screen.getByText('Log dinner')).toBeInTheDocument();
    expect(screen.queryByText('Ready to train?')).not.toBeInTheDocument();
    expect(screen.queryByText('Want a program?')).not.toBeInTheDocument();
    expect(screen.queryByText('Build a program')).not.toBeInTheDocument();
  });

  it('renders no workout hero (and no program popup) when there is no meal to suggest', () => {
    expect(todayHeroVariant({ workout: null, hasPlan: false, meal: null, foodFocus: true })).toBe('none');
    const { container } = render(
      <TodayHeroCard workout={null} hasPlan={false} mesocycleName={null} meal={null} foodFocus />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lifters without a plan keep the "Ready to train?" hero', () => {
    expect(todayHeroVariant({ workout: null, hasPlan: false, meal })).toBe('no-plan');
    render(<TodayHeroCard workout={null} hasPlan={false} mesocycleName={null} meal={meal} />);
    expect(screen.getByText('Ready to train?')).toBeInTheDocument();
  });

  it('a pending workout still wins over food focus', () => {
    expect(
      todayHeroVariant({ workout: baseWorkout, hasPlan: false, meal, foodFocus: true })
    ).toBe('workout');
  });
});
