/**
 * BodyHubTrends — presentational behavior around the anchored trend:
 * metric toggle (FFMI gated on profile height), empty state, and the
 * clearly-labeled normalized-FFMI readout sourced from the same
 * computeFFMI the Analytics gauge uses.
 *
 * Chart internals (Recharts) render empty at jsdom's zero size; these tests
 * cover the component's own logic, not pixel output.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The embedded CompositionMap uses next/navigation for its suggestion flow.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// Recharts' ES-module build doesn't resolve under Jest, and jsdom has no
// layout anyway — stub the chart primitives; we assert on component logic.
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  ComposedChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ScatterChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  ReferenceDot: () => null,
  Area: () => null,
  AreaChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  Customized: () => null,
}));

import { BodyHubTrends } from '@/components/body/BodyHubTrends';
import { computeFFMI } from '@/services/bodyCompEngine';
import type { AnchoredTrendPoint } from '@/services/bodyCompAnchor';

const trendPoint = (overrides: Partial<AnchoredTrendPoint>): AnchoredTrendPoint => ({
  date: '2026-06-01',
  bodyFatPercent: 20,
  leanMassKg: 64,
  fatMassKg: 16,
  weightKg: 83,
  boneMassKg: 3,
  kind: 'estimated',
  ...overrides,
});

const twoPointTrend: AnchoredTrendPoint[] = [
  trendPoint({ date: '2026-06-01', kind: 'dexa' }),
  trendPoint({ date: '2026-06-15', leanMassKg: 65, boneMassKg: 3.1 }),
];

function renderTrends(props: Partial<React.ComponentProps<typeof BodyHubTrends>> = {}) {
  return render(
    <BodyHubTrends
      units="kg"
      heightCm={180}
      trend={twoPointTrend}
      weightHistory={[]}
      isLoading={false}
      {...props}
    />
  );
}

describe('BodyHubTrends', () => {
  it('renders no composition card until a body scan exists (the prompt lives below the chart)', () => {
    renderTrends({ trend: [] });
    expect(screen.queryByText('Body composition trend')).not.toBeInTheDocument();
    expect(screen.queryByText(/DEXA/)).not.toBeInTheDocument();
  });

  it('tells a user with no weigh-ins how to get a weight trend', async () => {
    const user = userEvent.setup();
    const onLogWeight = jest.fn();
    renderTrends({ trend: [], weightHistory: [], onLogWeight });
    expect(screen.getByText(/Weigh in on 2 different days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log weight' }));
    expect(onLogWeight).toHaveBeenCalledTimes(1);
  });

  it('shows a lone weigh-in with what it takes to start the line', () => {
    renderTrends({
      trend: [],
      weightHistory: [{ date: '2026-06-01', weight: 80, unit: 'kg' }],
    });
    expect(screen.getByText('80.0')).toBeInTheDocument();
    expect(screen.getByText(/Weigh in on one more day/)).toBeInTheDocument();
  });

  it('offers the FFMI toggle only when the profile has a height', () => {
    const { rerender } = renderTrends();
    expect(screen.getByRole('button', { name: 'Muscle (FFMI)' })).toBeInTheDocument();

    rerender(
      <BodyHubTrends
        units="kg"
        heightCm={null}
        trend={twoPointTrend}
        weightHistory={[]}
        isLoading={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Muscle (FFMI)' })).not.toBeInTheDocument();
    // The other two metrics remain available.
    expect(screen.getByRole('button', { name: 'Body fat %' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lean mass' })).toBeInTheDocument();
  });

  it('shows the latest value prominently above the chart, labeled by point kind', async () => {
    const user = userEvent.setup();
    renderTrends();

    // Last point is an estimate → "current estimate" with the BF% value.
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText(/current estimate · Jun 15/)).toBeInTheDocument();

    // Lean mass metric: same headline pattern, unit-suffixed value.
    await user.click(screen.getByRole('button', { name: 'Lean mass' }));
    expect(screen.getByText('65')).toBeInTheDocument();
    expect(screen.getByText(/current estimate · Jun 15/)).toBeInTheDocument();
  });

  it('labels the headline "measured by body scan (DEXA)" when the newest point is a scan', () => {
    renderTrends({
      trend: [
        trendPoint({ date: '2026-06-01' }),
        trendPoint({ date: '2026-06-15', kind: 'dexa', bodyFatPercent: 17.8 }),
      ],
    });
    expect(screen.getByText('17.8')).toBeInTheDocument();
    expect(screen.getByText(/measured by body scan \(DEXA\) · Jun 15/)).toBeInTheDocument();
  });

  it('labels the normalized FFMI readout from the trend last point (shared computeFFMI)', async () => {
    const user = userEvent.setup();
    renderTrends();

    await user.click(screen.getByRole('button', { name: 'Muscle (FFMI)' }));

    const last = twoPointTrend[twoPointTrend.length - 1];
    const expected = computeFFMI(last.leanMassKg, last.boneMassKg, 180);
    const readout = screen.getByText(/height-normalized/);
    expect(readout).toHaveTextContent(`latest ${expected.ffmi}`);
    expect(readout).toHaveTextContent(`height-normalized: ${expected.normalizedFfmi}`);
  });

  it('notes the lean-only fallback when bone mass was never logged', async () => {
    const user = userEvent.setup();
    renderTrends({
      trend: twoPointTrend.map((p) => ({ ...p, boneMassKg: null })),
    });

    await user.click(screen.getByRole('button', { name: 'Muscle (FFMI)' }));
    expect(
      screen.getByText(/bone mass not logged — FFMI uses lean mass only/)
    ).toBeInTheDocument();
  });
});

describe('BodyHubTrends — Composition Map', () => {
  // Two DEXA anchors ≥ the map's scan gate; the estimated point between
  // them must not count toward it.
  const twoScanTrend: AnchoredTrendPoint[] = [
    trendPoint({ date: '2026-05-01', kind: 'dexa' }),
    trendPoint({ date: '2026-05-20', kind: 'estimated' }),
    trendPoint({ date: '2026-06-10', kind: 'dexa', leanMassKg: 66, fatMassKg: 15, weightKg: 84 }),
  ];

  it('offers the Map toggle only with a height AND ≥2 DEXA scans', () => {
    const { rerender } = renderTrends({ trend: twoScanTrend });
    expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument();

    // One scan (plus estimates): no map.
    rerender(
      <BodyHubTrends
        units="kg"
        heightCm={180}
        trend={[twoScanTrend[0], twoScanTrend[1]]}
        weightHistory={[]}
        isLoading={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();

    // No height: no map either.
    rerender(
      <BodyHubTrends
        units="kg"
        heightCm={null}
        trend={twoScanTrend}
        weightHistory={[]}
        isLoading={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();
  });

  it('switches to the Composition Map view on toggle', async () => {
    const user = userEvent.setup();
    renderTrends({ trend: twoScanTrend });

    await user.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByText('Composition map')).toBeInTheDocument();
    // Decomposition caption + direction legend from the map itself.
    expect(screen.getByText(/FMI \+ FFMI = BMI/)).toBeInTheDocument();
    expect(screen.getByText(/↑ muscle gained · ← fat lost · ↖ recomp/)).toBeInTheDocument();
  });

  it('opens the map directly when deep-linked via initialMetric', () => {
    renderTrends({ trend: twoScanTrend, initialMetric: 'map' });
    expect(screen.getByText('Composition map')).toBeInTheDocument();
  });

  it('falls back gracefully when a map deep link is not satisfiable', () => {
    renderTrends({ trend: [twoScanTrend[0]], initialMetric: 'map' });
    // <2 scans: the map option doesn't exist — the default view renders.
    expect(screen.getByText('Body composition trend')).toBeInTheDocument();
    expect(screen.queryByText(/↑ muscle gained/)).not.toBeInTheDocument();
  });
});
