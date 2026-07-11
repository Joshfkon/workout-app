/**
 * TDEEDashboard — Weight Projection card behavior.
 *
 * Covers the weight-projection fix:
 *  - collapsed to a single-line summary by default, expands to one table
 *  - exactly one uncertainty warning in the expanded view
 *  - direction-mismatch notice renders when the calorie input contradicts
 *    the phase (e.g. a below-TDEE target while bulking)
 *  - the projection consumes the SAME TDEE displayed on the Metabolism card
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TDEEDashboard } from '@/components/nutrition/TDEEDashboard';
import type { TDEEEstimate, WeightPrediction, DataQualityCheck } from '@/lib/nutrition/adaptive-tdee';

// Recharts' ES-module build doesn't resolve under Jest; stub chart primitives.
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}));

const TDEE = 2935;

const estimate: TDEEEstimate = {
  burnRatePerLb: 16.6,
  estimatedTDEE: TDEE,
  confidence: 'stable',
  confidenceScore: 85,
  dataPointsUsed: 21,
  windowDays: 21,
  standardError: 250,
  lastUpdated: new Date('2026-07-11T00:00:00'),
  source: 'regression',
  estimateHistory: [],
  currentWeight: 176.4,
};

const dataQuality: DataQualityCheck = {
  isValid: true,
  issues: [],
  suggestions: [],
  daysWithData: 21,
  daysWithGaps: 0,
  completeDays: 21,
};

// Predictions only carry the horizon days; the card recomputes weights from
// the pure projection using targetCalories + estimate TDEE.
function predictions(cal: number): WeightPrediction[] {
  return [7, 14, 28, 56].map((days) => ({
    targetDate: `2026-08-0${days === 7 ? 1 : 2}`,
    predictedWeight: 176.4,
    confidenceRange: [175, 178],
    assumedDailyCalories: cal,
    daysFromNow: days,
  }));
}

function renderCard(overrides: Partial<React.ComponentProps<typeof TDEEDashboard>> = {}) {
  return render(
    <TDEEDashboard
      estimate={estimate}
      formulaEstimate={estimate}
      predictions={predictions(3100)}
      dataQuality={dataQuality}
      currentWeight={176.4}
      heightCm={180}
      bodyFatPercent={19}
      avgDailyProteinGrams={170}
      avgWeeklyTrainingSets={16}
      trainingAge="intermediate"
      biologicalSex="male"
      chronologicalAge={30}
      targetCalories={3100}
      phase="bulk"
      {...overrides}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Weight Projection card', () => {
  it('renders collapsed to a single-line summary by default (no table)', () => {
    renderCard();
    expect(screen.getByTestId('weight-projection-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('weight-projection-table')).not.toBeInTheDocument();
  });

  it('expands to a consolidated table with exactly one uncertainty warning', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId('weight-projection-toggle'));

    const table = screen.getByTestId('weight-projection-table');
    expect(table).toBeInTheDocument();
    // One consolidated table, not four stacked sections.
    expect(screen.getAllByTestId('weight-projection-table')).toHaveLength(1);
    // One uncertainty warning (or zero when confidence is high) — never repeated.
    expect(screen.queryAllByTestId('weight-projection-uncertainty').length).toBeLessThanOrEqual(1);
    // The table has a header row + Current + 4 horizons = 6 rows.
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    // Exactly one "How accurate is this?" link.
    expect(screen.getAllByText(/How accurate is this/i)).toHaveLength(1);
  });

  it('projects a GAIN on a bulk (summary weight above current)', () => {
    renderCard();
    const summary = screen.getByTestId('weight-projection-summary').textContent ?? '';
    const match = summary.match(/Projected:\s*([\d.]+)\s*lbs/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(176.4);
    expect(screen.queryByTestId('weight-projection-mismatch')).not.toBeInTheDocument();
  });

  it('renders the direction-mismatch notice when a below-TDEE target is used on a bulk', () => {
    // The reported bug: phase = bulk but a stale 2,558 target leaks in.
    renderCard({ targetCalories: 2558, predictions: predictions(2558) });
    const notice = screen.getByTestId('weight-projection-mismatch');
    expect(notice).toHaveTextContent(/2,558 cal\/day/);
    expect(notice).toHaveTextContent(/below your estimated TDEE/);
  });

  it('persists the expanded preference across remounts', async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard();
    await user.click(screen.getByTestId('weight-projection-toggle'));
    expect(screen.getByTestId('weight-projection-table')).toBeInTheDocument();
    unmount();

    renderCard();
    // Preference restored from localStorage -> starts expanded.
    expect(await screen.findByTestId('weight-projection-table')).toBeInTheDocument();
  });

  it('projection and Metabolism card display the SAME TDEE (single source of truth)', () => {
    renderCard();
    // Metabolism card shows the estimated TDEE.
    const metabolismTdee = estimate.estimatedTDEE;
    expect(screen.getByText(metabolismTdee.toLocaleString())).toBeInTheDocument();

    // Force a mismatch so the notice echoes the exact TDEE the projection used,
    // then assert it equals the Metabolism figure — not by eyeball.
    renderCard({ targetCalories: 2558, predictions: predictions(2558) });
    const notice = screen.getByTestId('weight-projection-mismatch');
    expect(notice).toHaveTextContent(
      new RegExp(`estimated TDEE \\(${metabolismTdee.toLocaleString()}\\)`)
    );
  });
});
