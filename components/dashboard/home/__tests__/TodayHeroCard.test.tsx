import { render, screen } from '@testing-library/react';
import { TodayHeroCard, TodaysWorkout } from '../TodayHeroCard';

const baseWorkout: TodaysWorkout = {
  id: 'sess-1',
  name: 'Hypertrophy Block',
  state: 'planned',
  exercises: 5,
  completedSets: 0,
  totalSets: 15,
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
