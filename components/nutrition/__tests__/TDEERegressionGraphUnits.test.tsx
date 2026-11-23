/**
 * The daily-burn regression card shows weights in the user's unit (the
 * analysis itself is in lb) and never says "TDEE".
 */

import { render, screen } from '@testing-library/react';

// jsdom has no ResizeObserver; the chart body isn't under test here.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return { ...actual, ResponsiveContainer: () => null };
});
import { TDEERegressionGraph } from '../TDEERegressionGraph';
import type { RegressionAnalysis } from '@/lib/nutrition/adaptive-tdee';

const analysis: RegressionAnalysis = {
  dataPoints: Array.from({ length: 6 }, (_, i) => ({
    date: `2026-11-0${i + 1}`,
    weight: 200,
    calories: 2400 + i * 50,
    actualChange: -0.2,
    predictedChange: -0.15,
    residual: -0.05,
  })),
  burnRatePerLb: 13,
  estimatedTDEE: 2600,
  rSquared: 0.4,
  standardError: 0.1,
  currentWeight: 200,
};

describe('TDEERegressionGraph units', () => {
  it('kg user: weight, burn rate and error are in kg', () => {
    render(<TDEERegressionGraph regressionAnalysis={analysis} weightUnit="kg" />);
    expect(screen.getByText('90.7 kg')).toBeInTheDocument();
    expect(screen.getByText('28.7 cal/kg')).toBeInTheDocument();
    expect(screen.getByText('±0.3 kg/wk')).toBeInTheDocument();
    expect(screen.queryByText(/\blbs?\b/)).not.toBeInTheDocument();
    expect(screen.getByText('Daily burn from your data')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/TDEE/);
  });

  it('lb user keeps lb', () => {
    render(<TDEERegressionGraph regressionAnalysis={analysis} weightUnit="lb" />);
    expect(screen.getByText('200.0 lb')).toBeInTheDocument();
    expect(screen.getByText('13.0 cal/lb')).toBeInTheDocument();
  });
});
