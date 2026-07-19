/**
 * MeasurementTrendCard — date-range filtering over the per-site tape trend.
 *
 * Chart internals (Recharts) render empty at jsdom's zero size; the LineChart
 * stub captures the `data` prop so we can assert how many points survive the
 * selected range without pixel output.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Recharts' ES-module build doesn't resolve under Jest, and jsdom has no
// layout anyway — stub the chart primitives; we assert on component logic.
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  LineChart: ({ data }: { data?: unknown[] }) => (
    <div data-testid="line-chart" data-points={data?.length ?? 0} />
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

let mockRows: Array<Record<string, unknown>> = [];

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: mockRows }),
        }),
      }),
    }),
  }),
}));

import { MeasurementTrendCard } from '@/components/body/MeasurementTrendCard';

/** Local-timezone YYYY-MM-DD for `n` days ago (mirrors getLocalDateString). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const chestRow = (loggedAt: string, chestCm: number) => ({
  logged_at: loggedAt,
  chest: chestCm,
});

describe('MeasurementTrendCard date ranges', () => {
  beforeEach(() => {
    mockRows = [];
  });

  it('defaults to 1Y and excludes points older than a year', async () => {
    mockRows = [
      chestRow(daysAgo(400), 100),
      chestRow(daysAgo(200), 105),
      chestRow(daysAgo(10), 110),
      chestRow(daysAgo(1), 111),
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);

    const chart = await screen.findByTestId('line-chart');
    expect(chart).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('measurement-trend-range-1y')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('narrows to the last month and widens to full history', async () => {
    mockRows = [
      chestRow(daysAgo(400), 100),
      chestRow(daysAgo(200), 105),
      chestRow(daysAgo(10), 110),
      chestRow(daysAgo(1), 111),
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);
    const user = userEvent.setup();

    await screen.findByTestId('line-chart');

    await user.click(screen.getByTestId('measurement-trend-range-1m'));
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '2');

    await user.click(screen.getByTestId('measurement-trend-range-all'));
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '4');
  });

  it('points at a longer range when all history is outside the window', async () => {
    mockRows = [chestRow(daysAgo(500), 100), chestRow(daysAgo(400), 104)];
    render(<MeasurementTrendCard tapeUnit="cm" />);

    expect(
      await screen.findByText(/No measurements in this date range/)
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('measurement-trend-range-all'));
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '2');
  });

  it('lists each measured site with a direction badge and rate', async () => {
    mockRows = [
      { logged_at: daysAgo(60), chest: 100, waist: 90 },
      { logged_at: daysAgo(30), chest: 103, waist: 87 },
      { logged_at: daysAgo(1), chest: 106, waist: 84, neck: 38 },
    ];
    render(<MeasurementTrendCard tapeUnit="cm" />);

    const chestRowEl = await screen.findByTestId('measurement-trend-row-chest');
    expect(chestRowEl).toHaveTextContent('Chest');
    expect(chestRowEl).toHaveTextContent('Rising');
    expect(chestRowEl).toHaveTextContent('106.0 cm');
    expect(chestRowEl).toHaveTextContent('cm/mo');
    expect(chestRowEl).toHaveTextContent('3 entries');

    // Waist is shrinking → labeled Down (improvement coloring is CSS-only).
    expect(screen.getByTestId('measurement-trend-row-waist')).toHaveTextContent('Down');

    // One neck entry → no fitted trend yet.
    const neckRowEl = screen.getByTestId('measurement-trend-row-neck');
    expect(neckRowEl).toHaveTextContent('Building');
    expect(neckRowEl).toHaveTextContent('1 entry');

    // Tapping a row selects it for the detail chart.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('measurement-trend-row-waist'));
    expect(screen.getByText('Waist detail')).toBeInTheDocument();
  });
});
