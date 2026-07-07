/**
 * CompositionMap — the textual contracts around the chart: the BMI
 * decomposition caption, measurement-honesty labels (noise floor, p-ratio
 * suppression), the goal-vector progress scalar (incl. negative /
 * target-reached / degenerate states and the phase start toggle), and the
 * confidence-gated p-ratio verdicts.
 *
 * Chart internals (Recharts + the Customized SVG layer) don't render in
 * jsdom; the geometry behind them is unit-tested in
 * services/__tests__/compositionSpace.test.ts.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  ScatterChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Customized: () => null,
}));

import { CompositionMap } from '@/components/body/CompositionMap';
import type { AnchoredTrendPoint } from '@/services/bodyCompAnchor';

const scan = (
  date: string,
  leanMassKg: number,
  fatMassKg: number,
  weightKg: number
): AnchoredTrendPoint => ({
  date,
  bodyFatPercent: Math.round((fatMassKg / weightKg) * 1000) / 10,
  leanMassKg,
  fatMassKg,
  weightKg,
  boneMassKg: 3,
  kind: 'dexa',
});

// A clear (if fatty) bulk: +5 kg per pair, 50% lean, with BF% deltas well
// above the 1% noise floor so segments read as signal.
const bulkTrend: AnchoredTrendPoint[] = [
  scan('2026-01-05', 60, 15, 78),
  scan('2026-03-10', 62.5, 17.5, 83),
  scan('2026-06-01', 65, 20, 88),
];

function renderMap(props: Partial<React.ComponentProps<typeof CompositionMap>> = {}) {
  return render(
    <CompositionMap
      trend={bulkTrend}
      heightCm={180}
      units="kg"
      phase="bulk"
      target={null}
      phaseStartDate={null}
      {...props}
    />
  );
}

describe('CompositionMap', () => {
  it('shows the BMI decomposition caption and direction legend', () => {
    renderMap();
    expect(screen.getByText(/FMI \+ FFMI = BMI/)).toBeInTheDocument();
    expect(screen.getByText(/↑ muscle gained · ← fat lost · ↖ recomp/)).toBeInTheDocument();
    // Honesty note: the trail is context, never extended past the last scan.
    expect(screen.getByText(/never extended past your last scan/)).toBeInTheDocument();
  });

  it('lists the p-ratio for each scan pair with phase-aware framing', () => {
    renderMap();
    expect(screen.getByText('Partitioning between scans (p-ratio)')).toBeInTheDocument();
    // Two pairs, both gains → lean-fraction framing with a verdict (≥2 pairs).
    expect(screen.getAllByText(/50% of gain was lean/)).toHaveLength(2);
    expect(screen.getAllByText('good')).toHaveLength(2);
  });

  it('withholds verdict language below 2 scan pairs', () => {
    renderMap({ trend: bulkTrend.slice(0, 2) });
    expect(screen.getByText(/50% of gain was lean/)).toBeInTheDocument();
    expect(screen.queryByText('good')).not.toBeInTheDocument();
  });

  it('suppresses the p-ratio under 3 lb of weight change', () => {
    renderMap({
      trend: [scan('2026-01-05', 60, 15, 78), scan('2026-03-10', 60.6, 14.9, 79)],
    });
    expect(screen.getByText(/p-ratio suppressed/)).toBeInTheDocument();
  });

  it('labels sub-noise-floor deltas instead of interpreting them', () => {
    // Δweight 4 kg but Δlean only 0.5 kg (< 1.5 lb floor).
    renderMap({
      trend: [scan('2026-01-05', 60, 15, 78), scan('2026-06-01', 60.5, 18.5, 82)],
    });
    expect(screen.getByText(/within measurement noise/)).toBeInTheDocument();
  });

  it('frames a cut segment as the fat fraction of the loss', () => {
    renderMap({
      phase: 'cut',
      trend: [scan('2026-01-05', 63, 17, 83), scan('2026-06-01', 62.25, 12.75, 78)],
    });
    expect(screen.getByText(/85% of loss was fat/)).toBeInTheDocument();
  });

  it('shows the composition progress scalar toward the active target', () => {
    // Target continues the bulk direction past the last scan: partway there.
    renderMap({
      target: { targetWeightKg: 98, targetBodyFatPercent: 25.5 },
    });
    expect(
      screen.getByText(/Composition progress: \d+(\.\d+)?% toward target/)
    ).toBeInTheDocument();
  });

  it('shows the target-reached state past the target (capped, not >100%)', () => {
    // Target halfway along the actual path → current is well past it.
    renderMap({
      target: { targetWeightKg: 83, targetBodyFatPercent: 20 },
    });
    expect(screen.getByText(/Target reached/)).toBeInTheDocument();
    expect(screen.queryByText(/1\d\d% toward target/)).not.toBeInTheDocument();
  });

  it('reports negative progress honestly when moving away from the target', () => {
    // Target is leaner+lighter than the start, but the user bulked away
    // from it.
    renderMap({
      target: { targetWeightKg: 74, targetBodyFatPercent: 15 },
    });
    expect(
      screen.getByText(/Composition progress: -\d+(\.\d+)?% toward target/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Moving away from the target along the goal direction/)
    ).toBeInTheDocument();
  });

  it('hides the scalar entirely for a degenerate goal vector (start ≈ target)', () => {
    // Target equals the first scan's composition: nothing to project onto.
    renderMap({
      target: { targetWeightKg: 78, targetBodyFatPercent: (15 / 78) * 100 },
    });
    expect(screen.queryByText(/toward target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Target reached/)).not.toBeInTheDocument();
  });

  it('offers the phase / all-time start toggle when a phase start is known', async () => {
    const user = userEvent.setup();
    renderMap({
      target: { targetWeightKg: 88, targetBodyFatPercent: 20.7 },
      phaseStartDate: '2026-02-01',
    });
    // Defaults to the phase start (first scan on/after 2026-02-01).
    expect(screen.getByRole('button', { name: 'This phase' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All time' }));
    expect(screen.getByText(/toward target/)).toBeInTheDocument();
  });

  it('states the DEXA precision caveat', () => {
    renderMap();
    expect(screen.getByText(/DEXA precision is ~±1–2% BF/)).toBeInTheDocument();
  });
});
