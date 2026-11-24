/**
 * Body weight card: the current weight with its unit, the window's
 * start → now change, the trend line's rate, and a y-axis domain that shows
 * a real trend without turning water-weight noise into a cliff.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="chart">{children}</div>,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  ReferenceArea: () => null,
}));

import { WeightGraph, weightAxisDomain, MIN_WEIGHT_AXIS_SPAN } from '../WeightGraph';
import { setClock, resetClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';

const history = [
  { date: '2026-10-23', weight: 142.4, unit: 'lb' },
  { date: '2026-11-01', weight: 142.0, unit: 'lb' },
  { date: '2026-11-10', weight: 141.9, unit: 'lb' },
  { date: '2026-11-20', weight: 141.6, unit: 'lb' },
];

beforeEach(() => setClock(createTestClock('2026-11-22T12:00:00')));
afterEach(() => resetClock());

describe('WeightGraph', () => {
  it('shows the current weight with its unit', () => {
    render(<WeightGraph weightHistory={history} preferredUnit="lb" />);
    const current = screen.getByTestId('weight-current');
    expect(current).toHaveTextContent('141.6');
    expect(current).toHaveTextContent('lb');
  });

  it('states the change along the drawn trend line, for the selected period', () => {
    render(<WeightGraph weightHistory={history} preferredUnit="lb" />);
    const text = screen.getByTestId('weight-change').textContent ?? '';
    // Trend endpoints (not raw first/last weigh-ins), named by the selected range.
    expect(text).toMatch(/^Trend \d+\.\d → \d+\.\d lb \(−\d\.\d\) in the last 30 days$/);
  });

  it('does not show ±0.0 for a zigzag whose trend clearly moves', () => {
    const zigzag = [
      { date: '2026-10-25', weight: 175.0, unit: 'lb' as const },
      { date: '2026-11-01', weight: 173.0, unit: 'lb' as const },
      { date: '2026-11-08', weight: 174.5, unit: 'lb' as const },
      { date: '2026-11-15', weight: 172.5, unit: 'lb' as const },
      { date: '2026-11-22', weight: 175.0, unit: 'lb' as const },
    ];
    render(<WeightGraph weightHistory={zigzag} preferredUnit="lb" />);
    const text = screen.getByTestId('weight-change').textContent ?? '';
    const [, start, end] = /^(?:Trend )?([\d.]+) → ([\d.]+)/.exec(text) ?? [];
    expect(start).toBeDefined();
    // Start/end are the fitted line's values, not 175.0 → 175.0.
    expect(`${start}→${end}`).not.toBe('175.0→175.0');
  });

  it('labels the trend-line rate with its unit, matching the drawn trend', () => {
    render(<WeightGraph weightHistory={history} preferredUnit="lb" />);
    expect(screen.getByTestId('weight-trend')).toHaveTextContent(/That's −0\.\d lb\/wk/);
    expect(screen.getByTestId('weight-trend')).toHaveTextContent(/can differ from your latest one/);
    // The method is explained once, on the Progress summary — not here too.
    expect(screen.getByTestId('weight-trend')).not.toHaveTextContent(/straight line|fitted/);
  });

  it('converts to the viewer unit', () => {
    render(<WeightGraph weightHistory={history} preferredUnit="kg" />);
    expect(screen.getByTestId('weight-current')).toHaveTextContent('64.2');
    expect(screen.getByTestId('weight-current')).toHaveTextContent('kg');
  });

  it('keeps the range control when the window has no weigh-ins', async () => {
    const old = [
      { date: '2026-09-01', weight: 150, unit: 'lb' },
      { date: '2026-09-10', weight: 149, unit: 'lb' },
    ];
    render(<WeightGraph weightHistory={old} preferredUnit="lb" />);
    expect(screen.getByText(/No weigh-ins in the last 30 days/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '90d' }));
    expect(screen.getByTestId('weight-current')).toHaveTextContent('149.0');
  });
});

describe('weightAxisDomain', () => {
  it('never spans less than the minimum, so a 0.8 lb drift stays visible but not a cliff', () => {
    const [lo, hi] = weightAxisDomain([142.4, 142.0, 141.9, 141.6], 'lb');
    expect(hi - lo).toBeGreaterThanOrEqual(MIN_WEIGHT_AXIS_SPAN.lb);
    // Old domain padded ±2 lb then floored/ceiled → 6+ lb for a 0.8 lb move.
    expect(hi - lo).toBeLessThanOrEqual(MIN_WEIGHT_AXIS_SPAN.lb + 1);
    expect(lo).toBeLessThanOrEqual(141.6);
    expect(hi).toBeGreaterThanOrEqual(142.4);
  });

  it('pads a big range by ~15% each side', () => {
    const [lo, hi] = weightAxisDomain([180, 200], 'lb');
    expect(lo).toBe(177);
    expect(hi).toBe(203);
  });

  it('snaps kg to half units', () => {
    const [lo, hi] = weightAxisDomain([64.2, 64.6], 'kg');
    expect(lo * 2).toBe(Math.round(lo * 2));
    expect(hi * 2).toBe(Math.round(hi * 2));
    expect(hi - lo).toBeGreaterThanOrEqual(MIN_WEIGHT_AXIS_SPAN.kg);
  });
});
