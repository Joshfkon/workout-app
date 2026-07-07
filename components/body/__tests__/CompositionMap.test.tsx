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
  NOW_LABEL_COLOR,
  LABEL_PILL_COLOR,
  type DecorationsData,
} from '@/components/body/CompositionMap';
import {
  labelBox,
  estimateTextWidth,
  rectIntersectsSegment,
  rectIntersectsCircle,
  type PxPoint,
} from '@/components/body/compositionMapGeometry';
import type { AnchoredTrendPoint } from '@/services/bodyCompAnchor';
import {
  visibleIsoBmiSegments,
  COMPOSITION_MAP_FFMI_THRESHOLDS,
  type CompositionPoint,
} from '@/services/compositionSpace';

/** WCAG 2.x contrast ratio between two hex colors. */
function contrastRatio(hexA: string, hexB: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

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

  it('resolves a one-sided delta as "essentially all fat" instead of blanket noise', () => {
    // Δweight 4 kg but Δlean only 0.5 kg (< 1.5 lb floor): the fat side is
    // clear, so the segment is attributable — not measurement noise.
    renderMap({
      trend: [scan('2026-01-05', 60, 15, 78), scan('2026-06-01', 60.5, 18.5, 82)],
    });
    expect(screen.getByText(/essentially all fat/)).toBeInTheDocument();
    expect(screen.queryByText(/within measurement noise/)).not.toBeInTheDocument();
  });

  it('shows "essentially all fat" for the Dec→Mar −7.5 lb cut with flat lean', () => {
    renderMap({
      phase: 'cut',
      trend: [scan('2025-12-03', 63, 17, 83.4), scan('2026-03-15', 62.8, 13.8, 80)],
    });
    expect(screen.getByText(/essentially all fat/)).toBeInTheDocument();
  });

  it('shows "essentially all lean" when only the fat side is flat', () => {
    renderMap({
      trend: [scan('2026-01-05', 60, 15, 78), scan('2026-06-01', 63.5, 15.2, 81.7)],
    });
    expect(screen.getByText(/essentially all lean/)).toBeInTheDocument();
  });

  it('keeps the blanket noise label when both components are inside the floors', () => {
    renderMap({
      trend: [scan('2026-01-05', 60, 15, 78), scan('2026-06-01', 60.5, 15.5, 79.5)],
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

  it('summarizes Latest vs Goal in the footer, with the implied goal weight', () => {
    renderMap({ target: { targetWeightKg: 98, targetBodyFatPercent: 25.5 } });
    const footer = screen.getByTestId('map-summary-footer');
    expect(footer).toHaveTextContent(/Latest \(/);
    expect(footer).toHaveTextContent('Goal');
    // Implied weight = (FMI* + FFMI*) · h² — the exact weight the goal
    // point sits at (a BF%+weight target round-trips to itself).
    expect(footer).toHaveTextContent(/Implied weight ~98\.0 kg/);
    expect(footer).toHaveTextContent(/BF 25\.5%/);
  });

  it('footer nudges toward Goals when no target exists', () => {
    renderMap({ target: null });
    expect(screen.getByTestId('map-summary-footer')).toHaveTextContent(/No target set/);
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

  // A daily-estimate scribble wandering near the early path — the kind of
  // geometry labels used to land on.
  const trail = [
    point('2025-03-20', 3.05, 17.1),
    point('2025-04-10', 3.25, 17.25),
    point('2025-05-01', 3.15, 17.45),
    point('2025-05-20', 3.4, 17.6),
    point('2025-06-10', 3.48, 17.75),
  ];

  const baseData: DecorationsData = {
    domain,
    scanPoints: fiveScans,
    trailPoints: [],
    targetPoint: null,
    targetLabelLines: null,
    vectorLabel: null,
    showGoalVector: false,
    startLabel: "Start · Mar '25",
    nowLabel: 'Latest · Jun 2',
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

  it('labels the endpoints, flipped away from edges and the path', () => {
    renderDecorations();
    const start = screen.getByTestId('map-start-label');
    expect(start).toHaveTextContent("Start · Mar '25");
    // Start point at px(100, 265): label sits to the right, dodging the
    // outgoing path segment that runs up-right from the point.
    expect(Number(start.getAttribute('x'))).toBeGreaterThan(100);
    expect(start.getAttribute('text-anchor')).toBe('start');

    const now = screen.getByTestId('map-now-label');
    expect(now).toHaveTextContent('Latest · Jun 2');
    // Now point at px(388, 27), top-right corner: label flips left-below.
    expect(Number(now.getAttribute('x'))).toBeLessThan(388);
    expect(Number(now.getAttribute('y'))).toBeGreaterThan(27);
    expect(now.getAttribute('text-anchor')).toBe('end');
  });

  it('renders the Start/Now labels full-contrast on background pills', () => {
    renderDecorations();
    expect(screen.getByTestId('map-start-label-pill')).toBeInTheDocument();
    expect(screen.getByTestId('map-now-label-pill')).toBeInTheDocument();
    // The Now label keeps its full-contrast fill — never a faded variant.
    expect(screen.getByTestId('map-now-label').getAttribute('fill')).toBe(NOW_LABEL_COLOR);
    const pill = screen.getByTestId('map-now-label-pill');
    expect(pill.getAttribute('fill')).toBe(LABEL_PILL_COLOR);
    // WCAG contrast of the label color over its pill ≥ 4.5:1.
    expect(contrastRatio(NOW_LABEL_COLOR, LABEL_PILL_COLOR)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every label clear of chart geometry, or backs it with a pill', () => {
    renderDecorations({
      targetPoint: { fmi: 6.5, ffmi: 22.5 },
      targetLabelLines: ['GOAL', 'FFMI 22.5', 'BF 22%', 'FMI 6.5'],
      vectorLabel: 'Goal vector · 62%',
      showGoalVector: true,
      trailPoints: trail,
    });

    // Reconstruct the geometry the decorations drew, in pixels.
    const segments: Array<{ a: PxPoint; b: PxPoint }> = [];
    for (let i = 1; i < fiveScans.length; i++) {
      segments.push({
        a: { x: xScale(fiveScans[i - 1].fmi), y: yScale(fiveScans[i - 1].ffmi) },
        b: { x: xScale(fiveScans[i].fmi), y: yScale(fiveScans[i].ffmi) },
      });
    }
    for (let i = 1; i < trail.length; i++) {
      segments.push({
        a: { x: xScale(trail[i - 1].fmi), y: yScale(trail[i - 1].ffmi) },
        b: { x: xScale(trail[i].fmi), y: yScale(trail[i].ffmi) },
      });
    }
    for (const seg of visibleIsoBmiSegments(domain)) {
      segments.push({
        a: { x: xScale(seg.x1), y: yScale(seg.y1) },
        b: { x: xScale(seg.x2), y: yScale(seg.y2) },
      });
    }
    for (const t of COMPOSITION_MAP_FFMI_THRESHOLDS.filter(
      (v) => v > domain.y[0] && v < domain.y[1]
    )) {
      segments.push({
        a: { x: xScale(domain.x[0]), y: yScale(t) },
        b: { x: xScale(domain.x[1]), y: yScale(t) },
      });
    }
    const circles = fiveScans.map((p, i) => ({
      x: xScale(p.fmi),
      y: yScale(p.ffmi),
      r: i === fiveScans.length - 1 ? 9 : i === 0 ? 4.5 : 4,
    }));

    const labels = [
      'map-start-label',
      'map-now-label',
      'map-target-label',
      ...screen.getAllByTestId('map-month-label').map(() => 'map-month-label'),
    ];
    const elements = [
      screen.getByTestId('map-start-label'),
      screen.getByTestId('map-now-label'),
      screen.getByTestId('map-target-label'),
      ...screen.getAllByTestId('map-month-label'),
    ];
    expect(labels.length).toBeGreaterThanOrEqual(6); // 3 named + 3 months

    for (const el of elements) {
      const testid = el.getAttribute('data-testid')!;
      const hasPill = el.parentElement?.querySelector(`[data-testid="${testid}-pill"]`);
      if (hasPill) continue; // pill guarantees legibility wherever it sits
      const fontSize = Number(el.getAttribute('font-size') ?? 9);
      const box = labelBox(
        Number(el.getAttribute('x')),
        Number(el.getAttribute('y')),
        (el.getAttribute('text-anchor') ?? 'start') as 'start' | 'middle' | 'end',
        estimateTextWidth(el.textContent ?? '', fontSize),
        fontSize + 2
      );
      for (const seg of segments) {
        expect(rectIntersectsSegment(box, seg.a, seg.b)).toBe(false);
      }
      for (const c of circles) {
        expect(rectIntersectsCircle(box, c, c.r)).toBe(false);
      }
    }
  });

  it('draws the dashed goal vector from the latest point with target + progress labels', () => {
    renderDecorations({
      targetPoint: { fmi: 6.5, ffmi: 22.5 },
      targetLabelLines: ['GOAL', 'FFMI 22.5', 'BF 22%', 'FMI 6.5'],
      vectorLabel: 'Goal vector · 62%',
      showGoalVector: true,
    });
    expect(screen.getByTestId('map-target')).toBeInTheDocument();
    expect(screen.getByTestId('map-goal-arrowhead')).toBeInTheDocument();
    const goalLabel = screen.getByTestId('map-target-label');
    expect(goalLabel).toHaveTextContent('GOAL');
    expect(goalLabel).toHaveTextContent('FFMI 22.5');
    expect(goalLabel).toHaveTextContent('BF 22%');
    expect(goalLabel).toHaveTextContent('FMI 6.5');
    expect(screen.getByTestId('map-target-label-pill')).toBeInTheDocument();
    const vector = screen.getByTestId('map-vector-label');
    expect(vector).toHaveTextContent('Goal vector · 62%');
    // Caption rides the line: rotated about the vector midpoint.
    expect(vector.getAttribute('transform')).toContain('rotate(');
  });

  it('keeps the target marker visible even when the vector is suppressed', () => {
    // A degenerate/suppressed goal vector must not hide WHERE the target is.
    renderDecorations({
      showGoalVector: false,
      targetPoint: { fmi: 6.5, ffmi: 22.5 },
      targetLabelLines: ['GOAL', 'FFMI 22.5', 'BF 22%', 'FMI 6.5'],
    });
    expect(screen.getByTestId('map-target')).toBeInTheDocument();
    expect(screen.getByTestId('map-target-label')).toHaveTextContent('GOAL');
    expect(screen.queryByTestId('map-goal-arrowhead')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-vector-label')).not.toBeInTheDocument();
  });

  it('omits target artifacts entirely when no target is set', () => {
    renderDecorations({ targetPoint: null });
    expect(screen.queryByTestId('map-target')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-goal-arrowhead')).not.toBeInTheDocument();
  });

  it('shows month labels on intermediate points when sparse (≤5 scans)', () => {
    renderDecorations();
    const labels = screen.getAllByTestId('map-month-label');
    expect(labels.map((l) => l.textContent)).toEqual(['Jun 15', 'Sep 20', 'Jan 10']);
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
