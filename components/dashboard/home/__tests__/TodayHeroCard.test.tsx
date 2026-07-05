import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayHeroCard, TodaysWorkout, MealHeroSuggestion } from '../TodayHeroCard';

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
