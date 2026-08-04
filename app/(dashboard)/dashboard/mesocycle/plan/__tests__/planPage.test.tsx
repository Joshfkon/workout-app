import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MesocyclePlanPage from '../page';
import { useMesocyclePlan } from '@/hooks/useMesocyclePlan';
import type { FullProgramRecommendation } from '@/types/schema';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

jest.mock('@/hooks/useMesocyclePlan', () => ({
  useMesocyclePlan: jest.fn(),
}));

const mockUseMesocyclePlan = useMesocyclePlan as unknown as jest.Mock;

function exercise(name: string, primaryMuscle: string, sets: number) {
  return {
    exercise: { id: `${name}-id`, name, primaryMuscle, secondaryMuscles: [] },
    sets,
    reps: { min: 8, max: 12, targetRIR: 2, tempoRecommendation: '2-0-1-0', notes: '' },
    restSeconds: 120,
    loadGuidance: '',
    notes: '',
    fatigueProfile: { systemicCost: 1, localCost: {}, sfr: 1, efficiency: 'high' },
  };
}

function week(weekNumber: number, isDeload: boolean) {
  const sessions = [
    {
      day: 'Push',
      focus: 'Accumulation',
      exercises: [exercise('Bench Press', 'chest', 4), exercise('Overhead Press', 'shoulders', 3)],
      totalSets: 7,
      estimatedMinutes: 52,
      warmup: ['5 min bike'],
      fatigueSummary: {
        systemicFatigueGenerated: 0,
        systemicCapacityUsed: 0,
        averageSFR: 0,
        localFatigueByMuscle: {},
      },
    },
    {
      day: 'Pull',
      focus: 'Accumulation',
      exercises: [exercise('Barbell Row', 'back', 4)],
      totalSets: 4,
      estimatedMinutes: 45,
      warmup: [],
      fatigueSummary: {
        systemicFatigueGenerated: 0,
        systemicCapacityUsed: 0,
        averageSFR: 0,
        localFatigueByMuscle: {},
      },
    },
  ];
  return {
    weekNumber,
    focus: isDeload ? 'Deload' : 'Accumulation',
    intensityModifier: 1,
    volumeModifier: isDeload ? 0.5 : 1,
    rpeTarget: { min: 7, max: 9 },
    sessions,
    isDeload,
  };
}

const PROGRAM = {
  mesocycleWeeks: [week(1, false), week(2, false), week(3, true)],
} as unknown as FullProgramRecommendation;

const MESOCYCLE = {
  id: 'meso-1',
  name: 'Summer Push/Pull',
  state: 'active',
  split_type: 'PPL',
  total_weeks: 3,
  current_week: 1,
  days_per_week: 2,
  deload_week: 3,
  session_duration_minutes: 60,
  start_date: '2026-08-03',
  preferred_workout_days: ['Monday', 'Thursday'] as const,
  program_data: PROGRAM,
  exercise_overrides: [],
};

function mockPlan(overrides: Record<string, unknown> = {}) {
  mockUseMesocyclePlan.mockReturnValue({
    data: { mesocycle: MESOCYCLE, completedSessions: 1 },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    ...overrides,
  });
}

describe('MesocyclePlanPage', () => {
  beforeEach(() => mockUseMesocyclePlan.mockReset());

  it('shows the block header and progress through the plan', () => {
    mockPlan();
    render(<MesocyclePlanPage />);

    expect(screen.getByRole('heading', { name: 'Summer Push/Pull' })).toBeInTheDocument();
    expect(screen.getByText(/PPL · 2×\/week · 3 weeks · 60 min target/)).toBeInTheDocument();
    expect(screen.getByText('1 of 6 sessions done')).toBeInTheDocument();
  });

  it('opens on the current week with the next session expanded', () => {
    mockPlan();
    render(<MesocyclePlanPage />);

    expect(screen.getByRole('heading', { name: /Week 1/ })).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    // 1 session done → the week's second session is next up, and its
    // exercises are visible without pressing Start anywhere.
    expect(screen.getByText('Next up')).toBeInTheDocument();
    expect(screen.getByText('Barbell Row')).toBeInTheDocument();
    expect(screen.getByText('4 sets × 8–12 · 2 RIR · 2:00 rest')).toBeInTheDocument();
    // The completed session stays collapsed.
    expect(screen.queryByText('Bench Press')).not.toBeInTheDocument();
  });

  it('expands a collapsed session on tap', async () => {
    const user = userEvent.setup();
    mockPlan();
    render(<MesocyclePlanPage />);

    await user.click(screen.getByRole('button', { name: /Push/ }));

    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText(/Warm-up:/)).toBeInTheDocument();
  });

  it('switches weeks and flags the deload week', async () => {
    const user = userEvent.setup();
    mockPlan();
    render(<MesocyclePlanPage />);

    await user.click(screen.getByRole('button', { name: /W3/ }));

    expect(screen.getByRole('heading', { name: /Week 3/ })).toBeInTheDocument();
    expect(screen.getByText('Deload')).toBeInTheDocument();
    expect(screen.getByText(/Volume 50%/)).toBeInTheDocument();
    expect(screen.queryByText('Next up')).not.toBeInTheDocument();
  });

  it('rolls weekly sets up per muscle and labels sessions with training days', () => {
    mockPlan();
    render(<MesocyclePlanPage />);

    expect(screen.getByText(/Accumulation · 2 sessions · 11 sets/)).toBeInTheDocument();
    expect(screen.getByText('Chest').parentElement).toHaveTextContent('Chest 4');
    expect(screen.getByRole('button', { name: /Push/ })).toHaveTextContent('Mon');
    expect(screen.getByRole('button', { name: /Pull/ })).toHaveTextContent('Thu');
  });

  it('expands every session with Expand all', async () => {
    const user = userEvent.setup();
    mockPlan();
    render(<MesocyclePlanPage />);

    await user.click(screen.getByRole('button', { name: 'Expand all' }));

    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Barbell Row')).toBeInTheDocument();
  });

  it('renders a skeleton before the first load resolves', () => {
    mockPlan({ data: undefined, isLoading: true });
    render(<MesocyclePlanPage />);

    expect(screen.getByTestId('mesocycle-plan-loading')).toBeInTheDocument();
  });

  it('prompts to plan a mesocycle when there is none', () => {
    mockPlan({ data: { mesocycle: null, completedSessions: 0 } });
    render(<MesocyclePlanPage />);

    expect(screen.getByRole('heading', { name: 'No plan to preview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan a mesocycle' })).toHaveAttribute(
      'href',
      '/dashboard/mesocycle/new'
    );
  });

  it('explains legacy blocks that have no stored program', () => {
    mockPlan({
      data: {
        mesocycle: { ...MESOCYCLE, program_data: null },
        completedSessions: 0,
      },
    });
    render(<MesocyclePlanPage />);

    expect(screen.getByText('This block has no stored program')).toBeInTheDocument();
  });

  it('offers a retry when the plan fails to load', async () => {
    const user = userEvent.setup();
    const refetch = jest.fn();
    mockPlan({ data: undefined, isError: true, refetch });
    render(<MesocyclePlanPage />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('lists the week strip with per-week set totals', () => {
    mockPlan();
    render(<MesocyclePlanPage />);

    const strip = screen.getByRole('button', { name: /W2/ });
    expect(within(strip).getByText('11 sets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /W3/ })).toHaveTextContent('deload');
  });
});
