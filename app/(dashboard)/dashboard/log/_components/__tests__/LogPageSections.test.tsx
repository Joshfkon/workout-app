import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LogHeroCard,
  TodaySoFarStrip,
  UnfinishedWorkoutBanner,
  WeightQuickLogRow,
  formatRelativeDay,
  type TodaySoFar,
} from '../LogPageSections';
import { MetricTileGrid } from '@/components/dashboard/home/MetricTileGrid';

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
  // 14:00 = 50% through the default 07:00–21:00 window.
  const midday = new Date(2026, 6, 9, 14, 0, 0, 0);
  // Every macro exactly at its expected-by-now amount (half the target).
  const baseData: TodaySoFar = {
    calories: 1550,
    protein: 105,
    carbs: 144,
    fat: 42,
    caloriesTarget: 3100,
    proteinTarget: 210,
    carbsTarget: 288,
    fatTarget: 85,
    steps: 6204,
  };

  function renderStrip(
    data: TodaySoFar,
    {
      phase = 'maintenance' as const,
      now = midday,
      onNutritionTap = jest.fn(),
    }: {
      phase?: 'bulk' | 'cut' | 'maintenance';
      now?: Date;
      onNutritionTap?: () => void;
    } = {}
  ) {
    return render(
      <TodaySoFarStrip data={data} phase={phase} now={now} onNutritionTap={onNutritionTap} />
    );
  }

  it('renders all four macro tiles with consumed/target plus steps', () => {
    renderStrip(baseData);

    expect(screen.getByText('1,550')).toBeInTheDocument();
    expect(screen.getByText('of 3,100')).toBeInTheDocument();
    expect(screen.getByText('105g')).toBeInTheDocument();
    expect(screen.getByText('of 210g')).toBeInTheDocument();
    expect(screen.getByText('144g')).toBeInTheDocument();
    expect(screen.getByText('of 288g')).toBeInTheDocument();
    expect(screen.getByText('42g')).toBeInTheDocument();
    expect(screen.getByText('of 85g')).toBeInTheDocument();
    expect(screen.getByText('6,204')).toBeInTheDocument();
    expect(screen.getByText('of 10k')).toBeInTheDocument();
    // All macros exactly on their expected-by-now amounts.
    expect(screen.getAllByText('on pace')).toHaveLength(4);
  });

  it('marks tiles behind/ahead of the time-of-day expectation', () => {
    renderStrip(
      // At 14:00: calories 55% short → behind; protein 43% over → ahead;
      // carbs/fat untouched → on pace.
      { ...baseData, calories: 700, protein: 150 },
      { phase: 'maintenance' }
    );

    expect(screen.getByText('behind')).toBeInTheDocument();
    expect(screen.getByText('ahead')).toBeInTheDocument();
    expect(screen.getAllByText('on pace')).toHaveLength(2);
  });

  it('warns protein when behind on a cut but keeps calories neutral', () => {
    renderStrip(
      // Both 55%+ short at 14:00; a cut only warns the protein tile.
      { ...baseData, calories: 700, protein: 40 },
      { phase: 'cut' }
    );

    const behinds = screen.getAllByText('behind');
    expect(behinds).toHaveLength(2);
    const classNames = behinds.map((el) => el.className);
    expect(classNames.some((c) => c.includes('text-orange-400'))).toBe(true); // protein warns
    expect(classNames.some((c) => c.includes('text-surface-500'))).toBe(true); // calories neutral
  });

  it('suppresses pacing judgment before the eating window (05:30)', () => {
    renderStrip(
      { ...baseData, calories: 0, protein: 0, carbs: 0, fat: 0 },
      { now: new Date(2026, 6, 9, 5, 30) }
    );

    expect(screen.queryByText('behind')).not.toBeInTheDocument();
    expect(screen.queryByText('ahead')).not.toBeInTheDocument();
    expect(screen.queryByText('on pace')).not.toBeInTheDocument();
  });

  it('hides the steps tile when there is no activity data', () => {
    renderStrip({ ...baseData, steps: null });

    expect(screen.queryByText('Steps')).not.toBeInTheDocument();
  });

  it('omits targets, bars, and statuses when targets are not set', () => {
    renderStrip({
      ...baseData,
      caloriesTarget: null,
      proteinTarget: null,
      carbsTarget: null,
      fatTarget: null,
      steps: null,
    });

    expect(screen.queryByText(/^of /)).not.toBeInTheDocument();
    expect(screen.queryByText('on pace')).not.toBeInTheDocument();
  });

  it('opens nutrition from the macro tiles', async () => {
    const user = userEvent.setup();
    const onNutritionTap = jest.fn();
    renderStrip(baseData, { onNutritionTap });

    await user.click(screen.getByText('Calories'));
    await user.click(screen.getByText('Protein'));
    await user.click(screen.getByText('Carbs'));
    await user.click(screen.getByText('Fat'));
    expect(onNutritionTap).toHaveBeenCalledTimes(4);
  });
});

describe('Home tile and Log grid pacing consistency', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 9, 14, 0, 0, 0));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the same calorie verdict on both surfaces for the same state', () => {
    // 800 of 2000 kcal at 14:00 on a bulk: 20% short of pace → 'behind'.
    const logStrip = render(
      <TodaySoFarStrip
        data={{
          calories: 800,
          protein: 75,
          carbs: 125,
          fat: 33,
          caloriesTarget: 2000,
          proteinTarget: 150,
          carbsTarget: 250,
          fatTarget: 65,
          steps: null,
        }}
        phase="bulk"
        onNutritionTap={jest.fn()}
      />
    );
    const logCalorieStatuses = logStrip.getAllByText(/behind|ahead|on pace/);
    expect(logCalorieStatuses[0]).toHaveTextContent('behind');
    logStrip.unmount();

    render(
      <MetricTileGrid
        nutritionTotals={{ calories: 800, protein: 75, carbs: 125, fat: 33 }}
        nutritionTargets={{ calories: 2000, protein: 150 }}
        liftTrends={null}
        volume={null}
        latestWeight={null}
        weightUnit="lb"
        weightHistory={[]}
        weightRate={null}
        bodyComp={null}
        onLogWeight={() => {}}
        phase="bulk"
      />
    );
    expect(screen.getByText(/· behind/)).toBeInTheDocument();
  });
});

describe('WeightQuickLogRow', () => {
  it('prompts with the last weigh-in when nothing is logged today', () => {
    render(
      <WeightQuickLogRow
        todayLabel={null}
        lastLabel="Yesterday: 176.6 lb"
        onTap={jest.fn()}
      />
    );

    expect(screen.getByText('Log weight')).toBeInTheDocument();
    expect(screen.getByText('Yesterday: 176.6 lb · none today')).toBeInTheDocument();
  });

  it('shows the logged value with edit-on-tap once logged today', async () => {
    const user = userEvent.setup();
    const onTap = jest.fn();
    render(
      <WeightQuickLogRow todayLabel="177.2 lb" lastLabel={null} onTap={onTap} />
    );

    expect(screen.getByText('Weight logged · 177.2 lb')).toBeInTheDocument();
    expect(screen.getByText("Tap to edit today's entry")).toBeInTheDocument();

    await user.click(screen.getByText('Weight logged · 177.2 lb'));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('falls back to an explainer with no weight history', () => {
    render(<WeightQuickLogRow todayLabel={null} lastLabel={null} onTap={jest.fn()} />);

    expect(
      screen.getByText('Daily weigh-ins sharpen your body-comp trend')
    ).toBeInTheDocument();
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
