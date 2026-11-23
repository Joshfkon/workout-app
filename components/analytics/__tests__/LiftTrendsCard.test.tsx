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
    expect(squat).toHaveTextContent('est. max 140.0 kg');
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
            {
              name: 'Bench Press', sessions: 2, bestWeightKg: 62.5, bestReps: 8,
              firstWeightKg: 60, firstReps: 8, latestWeightKg: 62.5, latestReps: 8,
            },
            { name: 'Pull-up', sessions: 1, bestWeightKg: 0, bestReps: 6 },
          ],
        }}
        units="kg"
      />,
    );
    const early = screen.getByTestId('lift-early-bests');
    const [bench, pullUp] = screen.getAllByTestId('early-lift-row');
    expect(bench).toHaveTextContent('Bench Press');
    expect(bench).toHaveTextContent('Best set 62.5 kg × 8');
    // Progress before a trend: first vs latest workout, weight actually lifted.
    expect(within(bench).getByTestId('early-lift-change')).toHaveTextContent('First 60 kg × 8 → latest 62.5 kg × 8');
    expect(bench).toHaveTextContent('Trend in 1 more workout');
    expect(pullUp).toHaveTextContent('6 reps');
    expect(pullUp).toHaveTextContent('Trend in 2 more workouts');
    expect(within(pullUp).queryByTestId('early-lift-change')).not.toBeInTheDocument();
    expect(screen.queryByText(/No lift has enough/)).not.toBeInTheDocument();
    // Says plainly, per lift, what unlocks a trend.
    const head = screen.getByTestId('lift-trends-summary');
    expect(head).toHaveTextContent('No strength trends yet');
    expect(screen.getByTestId('lift-first-trend-hint')).toHaveTextContent(
      'Log Bench Press in 1 more workout to see its trend. A trend needs the same lift in 3 workouts.'
    );
    expect(early).toHaveTextContent(/best set on each lift/);
  });

  it('leads a lift row with the real best set, then the labelled estimate', () => {
    const withSet = lift({
      history: [
        { date: '2026-10-01', e1rmKg: 95, topSetWeightKg: 75, topSetReps: 8 },
        { date: '2026-11-01', e1rmKg: 100, topSetWeightKg: 80, topSetReps: 7 },
      ],
    });
    render(<LiftTrendsCard summary={{ ...summary, lifts: [withSet] }} units="kg" />);
    expect(screen.getByTestId('lift-best-set')).toHaveTextContent('Latest best set 80 kg × 7');
    expect(screen.getByTestId('lift-row-bench')).toHaveTextContent('est. max 100.0 kg');
  });

  it('never ellipsizes a long lift name or its weekly change at phone width', () => {
    const long = lift({
      exerciseId: 'bbs',
      seriesKey: 'bbs',
      name: 'Barbell Back Squat (High Bar, Paused)',
      direction: 'rising',
      weeklyChangePct: 3,
    });
    render(<LiftTrendsCard summary={{ ...summary, lifts: [long] }} units="lb" />);
    const name = screen.getByTestId('lift-trend-name');
    const change = screen.getByTestId('lift-trend-change');
    expect(name).toHaveTextContent('Barbell Back Squat (High Bar, Paused)');
    expect(change).toHaveTextContent('+3.0%/wk');
    expect(name.className).not.toMatch(/\btruncate\b/);
    expect(change.className).not.toMatch(/\btruncate\b/);
    expect(change.parentElement?.className).not.toMatch(/\btruncate\b/);
    // "est. max" is explained in plain words where it first appears.
    expect(screen.getByTestId('est-max-explainer')).toHaveTextContent(/heaviest single rep/);    // …and so is how the %/wk rate is worked out, over the card's own window.
    expect(screen.getByTestId('rate-explainer')).toHaveTextContent(
      new RegExp(`straight line through the est. max of your best set in each workout over the last ${Math.round(summary.windowDays / 7)} weeks`)
    );
  });
});
