/**
 * Progress › Strength front door: summary card, lift rows with status, the
 * attention line → plateau ideas, and a row linking to that lift's screen.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiftTrendsCard } from '../LiftTrendsCard';
import type { LiftTrend, LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

function lift(over: Partial<LiftTrend>): LiftTrend {
  return {
    exerciseId: 'bench',
    seriesKey: 'bench',
    name: 'Bench press',
    locationId: null,
    locationLabel: null,
    direction: 'flat',
    weeklyChangePct: 0,
    currentE1RMKg: 100,
    sessionCount: 9,
    history: [
      { date: '2026-10-01', e1rmKg: 95 },
      { date: '2026-10-15', e1rmKg: 99 },
      { date: '2026-11-01', e1rmKg: 100 },
    ],
    lowConfidence: false,
    calibrationReason: null,
    excludedDates: [],
    ...over,
  } as LiftTrend;
}

const summary: LiftTrendsSummary = {
  lifts: [
    lift({ exerciseId: 'squat', seriesKey: 'squat', name: 'Squat', direction: 'rising', weeklyChangePct: 1.1, currentE1RMKg: 140 }),
    lift({}),
    lift({ exerciseId: 'row', seriesKey: 'row', name: 'Barbell row', direction: 'down', weeklyChangePct: -0.4 }),
  ],
  rising: 1,
  flat: 1,
  down: 1,
  rebuilding: 0,
  insufficientData: 0,
  stalled: { name: 'Bench press', weeks: 3 },
  windowDays: 84,
};

describe('LiftTrendsCard', () => {
  it('summarises the window and lists each lift with its status in plain words', () => {
    render(<LiftTrendsCard summary={summary} units="kg" />);
    const card = screen.getByTestId('lift-trends-summary');
    expect(card).toHaveTextContent('Last 12 weeks');
    expect(card).toHaveTextContent('1 of 3 lifts rising');
    expect(card).toHaveTextContent('Bench press has been flat for 3 weeks.');

    const squat = screen.getByTestId('lift-row-squat');
    expect(squat).toHaveTextContent('Squat');
    expect(squat).toHaveTextContent('est. max');
    expect(squat).toHaveTextContent('+1.1%/wk');
    expect(within(squat).getByText('Rising')).toBeInTheDocument();
    expect(within(screen.getByTestId('lift-row-row')).getByText('Down')).toBeInTheDocument();
    expect(screen.queryByText(/E1RM/)).not.toBeInTheDocument();
  });

  it('turns plateau alerts into an attention line that opens the ideas', async () => {
    const onSeeIdeas = jest.fn();
    render(
      <LiftTrendsCard summary={summary} units="kg" attentionNames={['Bench Press', 'Barbell Row']} onSeeIdeas={onSeeIdeas} />
    );
    expect(screen.getByTestId('lift-trends-summary')).toHaveTextContent(
      '2 lifts need attention: bench press and barbell row.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'See ideas' }));
    expect(onSeeIdeas).toHaveBeenCalled();
  });

  it("links each row to that lift's own screen, gym-split lifts included", () => {
    const split = lift({ seriesKey: 'bench@gym-1', locationId: 'gym-1', locationLabel: 'Home gym' });
    render(<LiftTrendsCard summary={{ ...summary, lifts: [...summary.lifts, split] }} units="kg" />);
    expect(screen.getByTestId('lift-row-bench')).toHaveAttribute('href', '/dashboard/analytics/lift/bench');
    expect(screen.getByTestId('lift-row-bench@gym-1')).toHaveAttribute(
      'href',
      '/dashboard/analytics/lift/bench%40gym-1'
    );
  });

  it('shows no rate for a calibrating lift', () => {
    render(
      <LiftTrendsCard
        summary={{ ...summary, lifts: [lift({ lowConfidence: true, calibrationReason: 'program_change', weeklyChangePct: 3.2 })] }}
        units="kg"
      />
    );
    const row = screen.getByTestId('lift-row-bench');
    expect(row).toHaveTextContent('new program — rebuilding');
    expect(row).not.toHaveTextContent('%/wk');
    expect(within(row).getByText('Calibrating')).toBeInTheDocument();
  });

  it('shows best recent sets with numbers when no lift has a trend yet', () => {
    render(
      <LiftTrendsCard
        summary={{
          ...summary,
          lifts: [],
          rising: 0,
          flat: 0,
          down: 0,
          stalled: null,
          insufficientData: 2,
          earlyLifts: [
            { name: 'Bench Press', sessions: 2, bestWeightKg: 60, bestReps: 8 },
            { name: 'Pull-up', sessions: 1, bestWeightKg: 0, bestReps: 6 },
          ],
        }}
        units="kg"
      />,
    );
    const early = screen.getByTestId('lift-early-bests');
    expect(early).toHaveTextContent('Bench Press');
    expect(early).toHaveTextContent('60.0 kg × 8');
    expect(early).toHaveTextContent('2 of 3 workouts');
    expect(early).toHaveTextContent('6 reps');
    expect(screen.queryByText(/No lift has enough history/)).not.toBeInTheDocument();
  });
});
