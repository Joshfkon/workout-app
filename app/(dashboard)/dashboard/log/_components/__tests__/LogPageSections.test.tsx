import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LogHeroCard,
  TodaySoFarStrip,
  UnfinishedWorkoutBanner,
  formatRelativeDay,
  type TodaySoFar,
} from '../LogPageSections';

describe('UnfinishedWorkoutBanner', () => {
  it('shows start time and "no sets logged" for an empty session', () => {
    render(
      <UnfinishedWorkoutBanner
        startedAtLabel="4:03 PM"
        setsDone={0}
        onResume={jest.fn()}
        onDiscard={jest.fn()}
      />
    );

    expect(screen.getByText('Unfinished workout')).toBeInTheDocument();
    expect(screen.getByText(/Started 4:03 PM · no sets logged/)).toBeInTheDocument();
  });

  it('pluralizes logged sets and omits the started prefix without a time', () => {
    render(
      <UnfinishedWorkoutBanner
        startedAtLabel={null}
        setsDone={1}
        onResume={jest.fn()}
        onDiscard={jest.fn()}
      />
    );

    expect(screen.getByText('1 set logged')).toBeInTheDocument();
    expect(screen.queryByText(/Started/)).not.toBeInTheDocument();
  });

  it('wires Resume and the discard X to their handlers', async () => {
    const user = userEvent.setup();
    const onResume = jest.fn();
    const onDiscard = jest.fn();
    render(
      <UnfinishedWorkoutBanner
        startedAtLabel="4:03 PM"
        setsDone={3}
        onResume={onResume}
        onDiscard={onDiscard}
      />
    );

    await user.click(screen.getByText('Resume'));
    expect(onResume).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Discard unfinished workout' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe('LogHeroCard', () => {
  const baseProps = {
    variant: 'primary' as const,
    eyebrow: 'Today · Mesocycle wk 3',
    title: 'Chest & Back',
    meta: '7 exercises · est. 65 min · last done Thu',
    ctaLabel: 'Start workout',
    onCtaTap: jest.fn(),
    onSparkleTap: jest.fn(),
    footnote: "adjusts today's volume from recovery data",
  };

  it('renders eyebrow, title, meta, and footnote', () => {
    render(<LogHeroCard {...baseProps} />);

    expect(screen.getByText('Today · Mesocycle wk 3')).toBeInTheDocument();
    expect(screen.getByText('Chest & Back')).toBeInTheDocument();
    expect(screen.getByText('7 exercises · est. 65 min · last done Thu')).toBeInTheDocument();
    expect(screen.getByText("adjusts today's volume from recovery data")).toBeInTheDocument();
  });

  it('fires the CTA and sparkle handlers independently', async () => {
    const user = userEvent.setup();
    const onCtaTap = jest.fn();
    const onSparkleTap = jest.fn();
    render(<LogHeroCard {...baseProps} onCtaTap={onCtaTap} onSparkleTap={onSparkleTap} />);

    await user.click(screen.getByText('Start workout'));
    expect(onCtaTap).toHaveBeenCalledTimes(1);
    expect(onSparkleTap).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'AI suggested workout' }));
    expect(onSparkleTap).toHaveBeenCalledTimes(1);
  });

  it('disables the CTA when ctaDisabled is set', () => {
    render(<LogHeroCard {...baseProps} ctaLabel="Starting..." ctaDisabled />);

    expect(screen.getByText('Starting...')).toBeDisabled();
  });
});

describe('TodaySoFarStrip', () => {
  const baseData: TodaySoFar = {
    calories: 1840,
    protein: 142,
    caloriesTarget: 3100,
    proteinTarget: 210,
    steps: 6204,
  };

  it('renders all three tiles with values and targets', () => {
    render(<TodaySoFarStrip data={baseData} onNutritionTap={jest.fn()} />);

    expect(screen.getByText('1,840')).toBeInTheDocument();
    expect(screen.getByText('of 3,100')).toBeInTheDocument();
    expect(screen.getByText('142g')).toBeInTheDocument();
    expect(screen.getByText('of 210g')).toBeInTheDocument();
    expect(screen.getByText('6,204')).toBeInTheDocument();
    expect(screen.getByText('of 10k')).toBeInTheDocument();
  });

  it('hides the steps tile when there is no activity data', () => {
    render(<TodaySoFarStrip data={{ ...baseData, steps: null }} onNutritionTap={jest.fn()} />);

    expect(screen.queryByText('Steps')).not.toBeInTheDocument();
  });

  it('omits targets that are not set', () => {
    render(
      <TodaySoFarStrip
        data={{ ...baseData, caloriesTarget: null, proteinTarget: null, steps: null }}
        onNutritionTap={jest.fn()}
      />
    );

    expect(screen.queryByText(/^of /)).not.toBeInTheDocument();
  });

  it('opens nutrition from the calorie and protein tiles', async () => {
    const user = userEvent.setup();
    const onNutritionTap = jest.fn();
    render(<TodaySoFarStrip data={baseData} onNutritionTap={onNutritionTap} />);

    await user.click(screen.getByText('Calories'));
    await user.click(screen.getByText('Protein'));
    expect(onNutritionTap).toHaveBeenCalledTimes(2);
  });
});

describe('formatRelativeDay', () => {
  it('maps dates to today / yesterday / weekday / short date', () => {
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d;
    };

    expect(formatRelativeDay(daysAgo(0))).toBe('today');
    expect(formatRelativeDay(daysAgo(1))).toBe('yesterday');
    expect(formatRelativeDay(daysAgo(3))).toBe(
      daysAgo(3).toLocaleDateString('en-US', { weekday: 'short' })
    );
    expect(formatRelativeDay(daysAgo(10))).toBe(
      daysAgo(10).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );
  });
});
