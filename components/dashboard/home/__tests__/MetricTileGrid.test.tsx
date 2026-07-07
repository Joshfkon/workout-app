/**
 * MetricTileGrid — Body comp glance tile: shown only with a glance payload
 * (server gates it at ≥2 DEXA scans + height), deep-links to the Composition
 * Map's module via the ?tab=&section= route params, and grades trend arrows
 * (rising FFMI good, rising BF% flagged).
 */

import { render, screen } from '@testing-library/react';

import { MetricTileGrid } from '@/components/dashboard/home/MetricTileGrid';
import { BODY_COMP_TREND_SECTION_ID } from '@/services/compositionSpace';
import type { BodyCompGlance } from '@/lib/actions/dashboard';

const glance: BodyCompGlance = {
  scanCount: 3,
  bodyFatPercent: 18.2,
  ffmi: 21.4,
  bodyFatRatePerMonth: -0.4,
  ffmiRatePerMonth: 0.15,
};

function renderGrid(bodyComp: BodyCompGlance | null) {
  return render(
    <MetricTileGrid
      nutritionTotals={{ calories: 0, protein: 0, carbs: 0, fat: 0 }}
      nutritionTargets={null}
      liftTrends={null}
      volume={null}
      latestWeight={null}
      weightUnit="lb"
      weightHistory={[]}
      weightRate={null}
      bodyComp={bodyComp}
      onLogWeight={() => {}}
    />
  );
}

describe('MetricTileGrid — Body comp tile', () => {
  it('deep-links to the Composition Map module with the correct tab and section', () => {
    renderGrid(glance);
    const tile = screen.getByRole('link', { name: /Body comp/ });
    expect(tile).toHaveAttribute(
      'href',
      `/dashboard/analytics?tab=body&section=${BODY_COMP_TREND_SECTION_ID}`
    );
  });

  it('shows the anchored BF% and FFMI with trend arrows', () => {
    renderGrid(glance);
    expect(screen.getByText('18.2')).toBeInTheDocument();
    expect(screen.getByText(/FFMI 21.4/)).toBeInTheDocument();
    // Falling BF and rising FFMI: honest directions, graded colors.
    expect(screen.getByText('↓')).toHaveClass('text-success-400');
    expect(screen.getByText('↑')).toHaveClass('text-success-400');
    expect(screen.getByText(/3 scans/)).toBeInTheDocument();
  });

  it('flags rising body fat without hiding the direction', () => {
    renderGrid({ ...glance, bodyFatRatePerMonth: 0.6 });
    expect(screen.getByText('↑', { selector: '.text-warning-400' })).toBeInTheDocument();
  });

  it('renders nothing without a glance payload (<2 scans or no height)', () => {
    renderGrid(null);
    expect(screen.queryByText(/Body comp/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
