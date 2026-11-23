/**
 * Home redesign: the Today card, the one-nudge picker and the quick-log chips.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodayCard, type TodayCardProps } from '../TodayCard';
import { NudgeCard, pickHomeNudge } from '../NudgeCard';
import { QuickLogRow } from '../QuickLogRow';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

const lifts: LiftTrendsSummary = {
  lifts: [],
  rising: 3,
  flat: 1,
  down: 1,
  rebuilding: 0,
  insufficientData: 0,
  stalled: null,
  windowDays: 84,
};

function props(over: Partial<TodayCardProps> = {}): TodayCardProps {
  return {
    nutritionTotals: { calories: 1210, protein: 85, carbs: 140, fat: 38 },
    nutritionTargets: { calories: 2450, protein: 180 },
    kcalPace: 'on pace',
    lastNight: { localDay: '2026-11-20', hours: 7.5, quality: 'good', source: 'manual' } as TodayCardProps['lastNight'],
    stepsToday: 8412,
    hrvDeltaPct: -12,
    readiness: null,
    liftTrends: lifts,
    volume: { totalSets: 40, totalEffectiveSets: 36, totalTarget: 60, lowCount: 2 },
    latestWeight: { weight: 182.4, unit: 'lb' },
    weightRate: { perWeek: -0.6, target: -0.5 },
    weightUnit: 'lb',
    onOpenDetails: jest.fn(),
    ...over,
  };
}

describe('TodayCard', () => {
  it('summarises Eat, Recovery and This week in one line each', () => {
    render(<TodayCard {...props()} />);
    expect(screen.getByRole('link', { name: /Eat/ })).toHaveAttribute('href', '/dashboard/nutrition');
    expect(screen.getByText('1,240 left')).toBeInTheDocument();
    expect(screen.getByText('95 g protein to go · on pace')).toBeInTheDocument();
    expect(screen.getByText('7.5h sleep')).toBeInTheDocument();
    expect(screen.getByText('8,412 steps · HRV 12% below usual')).toBeInTheDocument();
    expect(screen.getByText('2 behind')).toBeInTheDocument();
    expect(screen.getByText('3 lifts rising · 182.4 lb, −0.6 lb/wk')).toBeInTheDocument();
  });

  it('opens the details sheet from Recovery and This week', () => {
    const onOpenDetails = jest.fn();
    render(<TodayCard {...props({ onOpenDetails })} />);
    fireEvent.click(screen.getByRole('button', { name: /Recovery/ }));
    fireEvent.click(screen.getByRole('button', { name: /This week/ }));
    expect(onOpenDetails).toHaveBeenCalledTimes(2);
  });

  it('shows "over" past the calorie target and invites targets when none are set', () => {
    const { rerender } = render(
      <TodayCard {...props({ nutritionTotals: { calories: 2600, protein: 190, carbs: 0, fat: 0 } })} />
    );
    expect(screen.getByText('150 over')).toBeInTheDocument();
    expect(screen.getByText('Protein target hit · on pace')).toBeInTheDocument();
    rerender(<TodayCard {...props({ nutritionTargets: null })} />);
    expect(screen.getByText('Set calorie and protein targets')).toBeInTheDocument();
  });

  it('falls back to quiet copy with no wearable, sleep or history', () => {
    render(
      <TodayCard
        {...props({ lastNight: null, stepsToday: null, hrvDeltaPct: null, liftTrends: null, latestWeight: null, volume: null })}
      />
    );
    expect(screen.getByText('Sleep, steps and HRV')).toBeInTheDocument();
    expect(screen.getByText('Lifts, weekly sets, weight')).toBeInTheDocument();
  });

  it('food-only: no lifts or weekly sets, even when the data is there', () => {
    render(<TodayCard {...props({ foodOnly: true })} />);
    expect(screen.queryByText(/lifts? rising/)).not.toBeInTheDocument();
    expect(screen.queryByText('2 behind')).not.toBeInTheDocument();
    expect(screen.getByText('182.4 lb, −0.6 lb/wk')).toBeInTheDocument();
  });

  it('food-only with no weigh-ins: the fallback copy is about weight only', () => {
    render(<TodayCard {...props({ foodOnly: true, latestWeight: null })} />);
    expect(screen.getByText('Your weight trend')).toBeInTheDocument();
    expect(screen.queryByText(/Lifts/)).not.toBeInTheDocument();
  });
});

describe('pickHomeNudge', () => {
  it('prefers deload, then check-in, then volume, then waist', () => {
    expect(pickHomeNudge({ deload: true, checkin: true, volume: true, waist: true })).toBe('deload');
    expect(pickHomeNudge({ checkin: true, volume: true, waist: true })).toBe('checkin');
    expect(pickHomeNudge({ volume: true, waist: true })).toBe('volume');
    expect(pickHomeNudge({ waist: true })).toBe('waist');
    expect(pickHomeNudge({})).toBeNull();
  });
});

describe('NudgeCard', () => {
  it('renders title, body and one action', () => {
    render(<NudgeCard title="2 muscles under your weekly minimum" body="Add sets" action={<button>See</button>} />);
    expect(screen.getByTestId('home-nudge')).toHaveTextContent('2 muscles under your weekly minimum');
    expect(screen.getByRole('button', { name: 'See' })).toBeInTheDocument();
  });
});

describe('QuickLogRow', () => {
  it('shows only the chips that have a handler, including Sleep and Cardio', () => {
    const onLogSleep = jest.fn();
    render(<QuickLogRow onLogWeight={jest.fn()} onLogFood={jest.fn()} onLogSleep={onLogSleep} onLogCardio={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Sleep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cardio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Water' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sleep' }));
    expect(onLogSleep).toHaveBeenCalled();
  });
});
