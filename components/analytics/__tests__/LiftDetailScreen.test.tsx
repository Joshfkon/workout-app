/**
 * A lift's own screen: estimated max, every session's best set (newest
 * first, strongest marked, outliers labelled), and the link to its workouts.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { LiftDetailScreen, bestPoint, plateauLine } from '../LiftDetailScreen';
import type { LiftTrend, LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { PlateauDetectionResult } from '@/services/plateauDetector';

jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: { units: 'kg' } }),
}));
let mockQuery: { data: LiftTrendsSummary | null | undefined; isPending: boolean };
jest.mock('@/hooks/useLiftTrends', () => ({ useLiftTrends: () => mockQuery }));
// Recharts needs a real layout (ResizeObserver); the chart's data shaping is
// tested in LiftMaxChart.test. Here: which points it is handed.
jest.mock('../LiftMaxChart', () => ({
  LiftMaxChart: ({ points }: { points: { date: string }[] }) => (
    <div data-testid="lift-max-chart">{points.map((p) => p.date).join(',')}</div>
  ),
}));

const bench: LiftTrend = {
  exerciseId: 'bench',
  seriesKey: 'bench',
  name: 'Bench press',
  locationId: null,
  locationLabel: null,
  direction: 'rising',
  weeklyChangePct: 0.8,
  currentE1RMKg: 112,
  sessionCount: 4,
  history: [
    { date: '2026-10-04', e1rmKg: 104, topSetWeightKg: 87.5, topSetReps: 6 },
    { date: '2026-10-11', e1rmKg: 140, topSetWeightKg: 120, topSetReps: 5 },
    { date: '2026-10-25', e1rmKg: 113.5, topSetWeightKg: 92.5, topSetReps: 7 },
    { date: '2026-11-01', e1rmKg: 112, topSetWeightKg: 90, topSetReps: 8 },
  ],
  lowConfidence: false,
  calibrationReason: null,
  excludedDates: ['2026-10-11'],
  plateau: null,
} as LiftTrend;

const plateau: PlateauDetectionResult = {
  isPlateaued: true,
  isCalibrating: false,
  calibrationReason: null,
  weeksSinceProgress: 4,
  lastProgressDate: '2026-10-04',
  currentE1RM: 107.5,
  recentPeakE1RM: 112.5,
  segmentBestE1RM: 112.5,
  peakE1RM: 112.5,
  discontinuityDate: null,
  suggestions: [],
};

const summary = {
  lifts: [bench],
  rising: 1,
  flat: 0,
  down: 0,
  rebuilding: 0,
  insufficientData: 0,
  stalled: null,
  windowDays: 84,
} as LiftTrendsSummary;

describe('bestPoint', () => {
  it('picks the highest estimated max, skipping trend outliers', () => {
    expect(bestPoint(bench)?.date).toBe('2026-10-25');
    expect(bestPoint({ history: bench.history, excludedDates: bench.history.map((p) => p.date) })).toBeNull();
  });
});

describe('LiftDetailScreen', () => {
  it('lists every session’s best set newest first, exact loads, best marked', () => {
    mockQuery = { data: summary, isPending: false };
    render(<LiftDetailScreen seriesKey="bench" />);

    expect(screen.getByRole('heading', { name: 'Bench press' })).toBeInTheDocument();
    expect(screen.getByTestId('lift-detail')).toHaveTextContent('Estimated max');
    // The estimate names the set actually lifted that it came from.
    expect(screen.getByTestId('lift-est-max-source')).toHaveTextContent(
      'Estimated from your last best set: 90 kg × 8'
    );

    const rows = screen.getAllByTestId(/^best-set-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'best-set-2026-11-01',
      'best-set-2026-10-25',
      'best-set-2026-10-11',
      'best-set-2026-10-04',
    ]);
    // Logged loads are exact, not rounded to a plate increment.
    expect(rows[1]).toHaveTextContent('92.5 kg × 7');
    expect(within(rows[1]).getByText('Best')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('left out of trend');
    expect(within(rows[2]).queryByText('Best')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'All Bench press workouts' })).toHaveAttribute(
      'href',
      '/dashboard/history?exercise=bench'
    );
  });

  it('charts estimated max over time, leaving out the trend outliers', () => {
    mockQuery = { data: summary, isPending: false };
    render(<LiftDetailScreen seriesKey="bench" />);
    expect(screen.getByText('Estimated max over time')).toBeInTheDocument();
    expect(screen.getByTestId('lift-max-chart')).toHaveTextContent('2026-10-04,2026-10-25,2026-11-01');
    expect(screen.getByTestId('lift-change-line')).toHaveTextContent('Change per week: +0.8% per week');
  });

  it('says why there is no weekly change yet instead of a 0.0%', () => {
    const early = {
      ...bench,
      excludedDates: [],
      weeklyChangePct: 0,
      direction: 'flat',
      sessionCount: 3,
      notEnoughData: { reason: 'short_span', workoutsNeeded: 1, spanDays: 0, readyOn: '2026-11-11' },
    } as LiftTrend;
    mockQuery = { data: { ...summary, lifts: [early] }, isPending: false };
    render(<LiftDetailScreen seriesKey="bench" />);
    const line = screen.getByTestId('lift-change-line');
    expect(line).toHaveTextContent('Change per week: not enough data yet');
    expect(line).not.toHaveTextContent('0.0%');
    const why = screen.getByTestId('lift-not-enough-why');
    expect(why).toHaveTextContent('Your 3 workouts with this lift were all on the same day');
    expect(why).toHaveTextContent('at least 3 workouts, spread over at least 10 days');
    expect(why).toHaveTextContent('All its sets in one workout count once.');
    expect(screen.queryByText('Too early')).toBeInTheDocument();
  });

  it('says so when the lift is no longer trended', () => {
    mockQuery = { data: summary, isPending: false };
    render(<LiftDetailScreen seriesKey="squat" />);
    expect(screen.getByTestId('lift-missing')).toHaveTextContent('This lift has no trend right now.');
  });

  it('shows a skeleton, not an empty state, while the summary loads', () => {
    mockQuery = { data: undefined, isPending: true };
    render(<LiftDetailScreen seriesKey="bench" />);
    expect(screen.queryByTestId('lift-missing')).not.toBeInTheDocument();
  });

  it('shows no plateau section for a lift that is progressing', () => {
    mockQuery = { data: summary, isPending: false };
    render(<LiftDetailScreen seriesKey="bench" />);
    expect(screen.queryByTestId('lift-plateau')).not.toBeInTheDocument();
  });

  it("shows a stalled lift's verdict and every idea, without a tap", () => {
    const stalled = {
      ...bench,
      direction: 'flat',
      plateau: { ...plateau, suggestions: ['Swap to a close-grip variation for 4 weeks.', 'Add a back-off set.'] },
    } as LiftTrend;
    mockQuery = { data: { ...summary, lifts: [stalled] }, isPending: false };
    render(<LiftDetailScreen seriesKey="bench" />);

    const section = screen.getByTestId('lift-plateau');
    expect(section).toHaveTextContent('This lift has stalled');
    expect(section).toHaveTextContent('Flat for 4 weeks · 5.0 kg below your recent best');
    expect(within(section).getByText('Swap to a close-grip variation for 4 weeks.')).toBeInTheDocument();
    expect(within(section).getByText('Add a back-off set.')).toBeInTheDocument();
  });

  it('hides a stall verdict while the lift is calibrating', () => {
    const calibrating = { ...bench, lowConfidence: true, plateau } as LiftTrend;
    mockQuery = { data: { ...summary, lifts: [calibrating] }, isPending: false };
    render(<LiftDetailScreen seriesKey="bench" />);
    expect(screen.queryByTestId('lift-plateau')).not.toBeInTheDocument();
  });
});

describe('plateauLine', () => {
  it('drops the gap when the lift sits at its recent best', () => {
    expect(plateauLine({ ...plateau, weeksSinceProgress: 1, currentE1RM: 110, recentPeakE1RM: 110 }, 'kg')).toBe(
      'Flat for 1 week'
    );
  });
});
