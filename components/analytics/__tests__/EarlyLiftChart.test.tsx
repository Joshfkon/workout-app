import { render, screen } from '@testing-library/react';
import { EarlyLiftChart, earlyLiftChartLabel } from '../EarlyLiftChart';
import { LiftTrendsCard } from '../LiftTrendsCard';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

const points = [
  { date: '2026-11-10', weightKg: 22.68, topSetReps: 10, e1rmKg: 30 },
  { date: '2026-11-17', weightKg: 22.68, topSetReps: 11, e1rmKg: 31 },
];

describe('EarlyLiftChart (UX panel r22, Maya: no chart before a trend)', () => {
  it('draws one dot per workout and an empty slot for the one that unlocks the trend', () => {
    render(<EarlyLiftChart points={points} units="lb" name="Barbell Back Squat" />);
    expect(screen.getAllByTestId('early-lift-chart-point')).toHaveLength(2);
    expect(screen.getByText('Trend after 3')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Barbell Back Squat, best set per workout. Nov 10: 50 lbs × 10; Nov 17: 50 lbs × 11. A trend line appears after 3 workouts (1 more).'
    );
  });

  it('still draws a single workout', () => {
    render(<EarlyLiftChart points={points.slice(0, 1)} units="lb" name="Bench" />);
    expect(screen.getAllByTestId('early-lift-chart-point')).toHaveLength(1);
    expect(earlyLiftChartLabel('Bench', points.slice(0, 1), 'lb')).toMatch(/\(2 more\)\.$/);
  });

  it('shows on each early lift row of the Strength card', () => {
    const summary: LiftTrendsSummary = {
      lifts: [],
      rising: 0,
      flat: 0,
      down: 0,
      rebuilding: 0,
      insufficientData: 1,
      stalled: null,
      windowDays: 84,
      earlyLifts: [
        {
          name: 'Barbell Back Squat',
          sessions: 2,
          bestWeightKg: 22.68,
          bestReps: 11,
          firstWeightKg: 22.68,
          firstReps: 10,
          latestWeightKg: 22.68,
          latestReps: 11,
          points,
        },
      ],
    };
    render(<LiftTrendsCard summary={summary} units="lb" />);
    expect(screen.getByTestId('early-lift-chart')).toBeInTheDocument();
  });
});
