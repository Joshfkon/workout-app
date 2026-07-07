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

import {
  CompositionMap,
  buildDecorations,
  formatMonthYear,
  type DecorationsData,
} from '@/components/body/CompositionMap';
import type { AnchoredTrendPoint } from '@/services/bodyCompAnchor';
import type { CompositionPoint } from '@/services/compositionSpace';

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

  it('prompts to set a target (linking to goals) when none is set', () => {
    renderMap({ target: null });
    const link = screen.getByRole('link', { name: 'Set a target' });
    expect(link).toHaveAttribute('href', '/dashboard/analytics?tab=goals');
    expect(screen.getByText(/to see your goal vector/)).toBeInTheDocument();
  });

  it('hides the set-a-target prompt once a target exists', () => {
    renderMap({ target: { targetWeightKg: 98, targetBodyFatPercent: 25.5 } });
    expect(screen.queryByText(/Set a target/)).not.toBeInTheDocument();
  });
});

describe('CompositionMap decorations (direction cues)', () => {
  // Render the Customized layer directly with fake linear scales — the
  // recharts mock swallows it inside the chart, but the layer itself is a
  // plain SVG component.
  const domain = { x: [2, 8] as [number, number], y: [16, 24] as [number, number] };
  const xScale = (v: number) => 40 + (v - 2) * 60;
  const yScale = (v: number) => 20 + (24 - v) * 35;
  const axisProps = {
    xAxisMap: { 0: { scale: xScale } },
    yAxisMap: { 0: { scale: yScale } },
  };

  const point = (date: string, fmi: number, ffmi: number): CompositionPoint => ({
    date,
    fmi,
    ffmi,
    bmi: fmi + ffmi,
    bodyFatPercent: (fmi / (fmi + ffmi)) * 100,
    weightKg: 80,
  });

  // The "real 5-scan dataset": a long bulk walking up and to the right,
  // ending near the top-right corner (forces the Now label to flip).
  const fiveScans = [
    point('2025-03-10', 3.0, 17.0),
    point('2025-06-15', 3.5, 17.8),
    point('2025-09-20', 4.2, 18.6),
    point('2026-01-10', 5.0, 19.5),
    point('2026-06-02', 7.8, 23.8),
  ];

  const baseData: DecorationsData = {
    domain,
    scanPoints: fiveScans,
    trailPoints: [],
    targetPoint: null,
    targetLabel: null,
    progressLabel: null,
    showGoalVector: false,
    startLabel: "Start · Mar '25",
    nowLabel: 'Now · Jun 2',
    showIntermediateLabels: true,
  };

  function renderDecorations(data: Partial<DecorationsData> = {}) {
    const Decorations = buildDecorations({ ...baseData, ...data });
    return render(
      <svg>
        <Decorations {...axisProps} />
      </svg>
    );
  }

  it('draws an arrowhead on every segment, rotated along travel direction', () => {
    renderDecorations();
    const arrows = screen.getAllByTestId('map-arrowhead');
    expect(arrows).toHaveLength(4);
    // First segment: (3.0,17.0)→(3.5,17.8) = px (100,265)→(130,237), i.e.
    // up-and-right in SVG space → negative rotation.
    const expectedAngle = Math.atan2(237 - 265, 130 - 100) * (180 / Math.PI);
    const transform = arrows[0].getAttribute('transform')!;
    const rotation = Number(transform.match(/rotate\((-?[\d.]+)\)/)?.[1]);
    expect(rotation).toBeCloseTo(expectedAngle, 6);
    // Midpoint placement.
    expect(transform).toContain('translate(115, 251)');
  });

  it('labels the endpoints and flips them away from edges (start top-right, now bottom-left)', () => {
    renderDecorations();
    const start = screen.getByTestId('map-start-label');
    expect(start).toHaveTextContent("Start · Mar '25");
    // Start point at px(100, 265): label right-above.
    expect(Number(start.getAttribute('x'))).toBeGreaterThan(100);
    expect(Number(start.getAttribute('y'))).toBeLessThan(265);
    expect(start.getAttribute('text-anchor')).toBe('start');

    const now = screen.getByTestId('map-now-label');
    expect(now).toHaveTextContent('Now · Jun 2');
    // Now point at px(388, 27), top-right corner: label flips left-below.
    expect(Number(now.getAttribute('x'))).toBeLessThan(388);
    expect(Number(now.getAttribute('y'))).toBeGreaterThan(27);
    expect(now.getAttribute('text-anchor')).toBe('end');
  });

  it('draws the dashed goal vector from the latest point with target + progress labels', () => {
    renderDecorations({
      targetPoint: { fmi: 6.5, ffmi: 22.5 },
      targetLabel: 'Target · FFMI 22.5 / BF 22%',
      progressLabel: '62% of the way',
      showGoalVector: true,
    });
    expect(screen.getByTestId('map-target')).toBeInTheDocument();
    expect(screen.getByTestId('map-goal-arrowhead')).toBeInTheDocument();
    expect(screen.getByTestId('map-target-label')).toHaveTextContent(
      'Target · FFMI 22.5 / BF 22%'
    );
    expect(screen.getByTestId('map-progress-label')).toHaveTextContent('62% of the way');
  });

  it('keeps the target marker visible even when the vector is suppressed', () => {
    // A degenerate/suppressed goal vector must not hide WHERE the target is.
    renderDecorations({
      showGoalVector: false,
      targetPoint: { fmi: 6.5, ffmi: 22.5 },
      targetLabel: 'Target · FFMI 22.5 / BF 22%',
    });
    expect(screen.getByTestId('map-target')).toBeInTheDocument();
    expect(screen.getByTestId('map-target-label')).toHaveTextContent('Target ·');
    expect(screen.queryByTestId('map-goal-arrowhead')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-progress-label')).not.toBeInTheDocument();
  });

  it('omits target artifacts entirely when no target is set', () => {
    renderDecorations({ targetPoint: null });
    expect(screen.queryByTestId('map-target')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-goal-arrowhead')).not.toBeInTheDocument();
  });

  it('shows month labels on intermediate points when sparse (≤5 scans)', () => {
    renderDecorations();
    const labels = screen.getAllByTestId('map-month-label');
    expect(labels.map((l) => l.textContent)).toEqual(['Jun', 'Sep', 'Jan']);
  });

  it('drops intermediate labels on dense maps (tap-only)', () => {
    renderDecorations({ showIntermediateLabels: false });
    expect(screen.queryAllByTestId('map-month-label')).toHaveLength(0);
    // Endpoint labels stay regardless of density.
    expect(screen.getByTestId('map-start-label')).toBeInTheDocument();
    expect(screen.getByTestId('map-now-label')).toBeInTheDocument();
  });
});

describe('CompositionMap endpoint label formatting', () => {
  it("formats the start label month-year as Mar '25", () => {
    expect(formatMonthYear('2025-03-10')).toBe("Mar '25");
    expect(formatMonthYear('2026-06-02')).toBe("Jun '26");
  });
});
