/**
 * Tests for ExerciseHistorySparkline — the ~12-week per-session trend line in
 * the workout card's expanded history detail.
 *
 * The data hook (useExerciseDetailHistory / React Query) is mocked; windowing
 * and metric derivation themselves are covered by the pure-service tests in
 * services/__tests__/exerciseDetailAnalytics.test.ts.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ExerciseHistorySparkline } from '../ExerciseHistorySparkline';

let mockDetailHistoryData: unknown[] = [];
const mockUseExerciseDetailHistory = jest.fn(() => ({
  data: mockDetailHistoryData,
  isLoading: false,
}));
jest.mock('@/hooks/useExerciseDetailHistory', () => ({
  useExerciseDetailHistory: () => mockUseExerciseDetailHistory(),
}));

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

interface SessionOverrides {
  isDeload?: boolean;
  bestE1RM?: number;
  totalVolume?: number;
  sets?: { weightKg: number; reps: number; rpe: number | null; setType?: string }[];
}

const detailSession = (date: string, overrides: SessionOverrides = {}) => ({
  sessionId: `session-${date}`,
  date,
  isDeload: overrides.isDeload ?? false,
  locationName: null,
  sets: overrides.sets ?? [{ weightKg: 100, reps: 8, rpe: 8, setType: 'normal' }],
  bestE1RM: overrides.bestE1RM ?? 100,
  topSet: null,
  totalVolume: overrides.totalVolume ?? 800,
});

describe('ExerciseHistorySparkline', () => {
  beforeEach(() => {
    mockDetailHistoryData = [];
    mockUseExerciseDetailHistory.mockClear();
  });

  it('draws the trend with metric label, session count, and endpoint values', () => {
    mockDetailHistoryData = [
      detailSession(daysAgo(7), { bestE1RM: 110 }),
      detailSession(daysAgo(35), { bestE1RM: 105 }),
      detailSession(daysAgo(70), { bestE1RM: 100 }),
    ];
    render(<ExerciseHistorySparkline exerciseId="exercise-1" metric="e1rm" unit="kg" />);

    const card = screen.getByTestId('history-sparkline');
    expect(card).toBeInTheDocument();
    expect(card.querySelector('polyline')).toBeInTheDocument();
    expect(screen.getByText('Last 12 Weeks')).toBeInTheDocument();
    expect(screen.getByText(/est\. 1RM · 3 sessions/)).toBeInTheDocument();
    // Oldest value on the left, latest + signed change on the right.
    expect(screen.getByText('100 kg')).toBeInTheDocument();
    expect(screen.getByText('110 kg')).toBeInTheDocument();
    expect(screen.getByTestId('history-sparkline-delta')).toHaveTextContent('+10');
    expect(screen.getByTestId('history-sparkline-delta')).toHaveClass('text-success-400');
  });

  it('marks a declining window with the danger color', () => {
    mockDetailHistoryData = [
      detailSession(daysAgo(7), { bestE1RM: 95 }),
      detailSession(daysAgo(35), { bestE1RM: 100 }),
    ];
    render(<ExerciseHistorySparkline exerciseId="exercise-1" metric="e1rm" unit="kg" />);

    expect(screen.getByTestId('history-sparkline-delta')).toHaveTextContent('−5');
    expect(screen.getByTestId('history-sparkline-delta')).toHaveClass('text-danger-400');
  });

  it('plots session volume in display units for rep_total exercises', () => {
    mockDetailHistoryData = [
      detailSession(daysAgo(7), { totalVolume: 900 }),
      detailSession(daysAgo(35), { totalVolume: 800 }),
    ];
    render(<ExerciseHistorySparkline exerciseId="exercise-1" metric="volume" unit="lb" />);

    expect(screen.getByText(/session volume · 2 sessions/)).toBeInTheDocument();
    // 800 kg ≈ 1,764 lbs (formatWeightValue, 0 decimals) — comma-grouped.
    expect(screen.getByText('1,764 lbs')).toBeInTheDocument();
  });

  it('formats duration metrics as seconds', () => {
    mockDetailHistoryData = [
      detailSession(daysAgo(7), {
        sets: [{ weightKg: 0, reps: 70, rpe: 8, setType: 'normal' }],
      }),
      detailSession(daysAgo(35), {
        sets: [{ weightKg: 0, reps: 60, rpe: 8, setType: 'normal' }],
      }),
    ];
    render(<ExerciseHistorySparkline exerciseId="exercise-1" metric="duration" unit="kg" />);

    expect(screen.getByText(/time under load · 2 sessions/)).toBeInTheDocument();
    expect(screen.getByText('60s')).toBeInTheDocument();
    expect(screen.getByText('70s')).toBeInTheDocument();
    expect(screen.getByTestId('history-sparkline-delta')).toHaveTextContent('+10s');
  });

  it('renders nothing until the window holds two sessions', () => {
    mockDetailHistoryData = [detailSession(daysAgo(7))];
    const { container } = render(
      <ExerciseHistorySparkline exerciseId="exercise-1" metric="e1rm" unit="kg" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every recent session was a deload', () => {
    mockDetailHistoryData = [
      detailSession(daysAgo(7), { isDeload: true }),
      detailSession(daysAgo(14), { isDeload: true }),
      detailSession(daysAgo(21), { bestE1RM: 100 }),
    ];
    const { container } = render(
      <ExerciseHistorySparkline exerciseId="exercise-1" metric="e1rm" unit="kg" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
