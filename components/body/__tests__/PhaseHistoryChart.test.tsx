/**
 * PhaseHistoryChart — regression coverage for the June-2026 "weight history
 * seems wrong" report. Chart internals (Recharts) render empty at jsdom's
 * zero size, so the mocks capture the PROPS handed to the chart primitives
 * and the tests assert on the row-building logic:
 *
 *   1. DEXA markers are merged into the chart-level rows (a child Scatter
 *      with its own `data` prop gets index-positioned by recharts inside a
 *      ComposedChart — dots pinned to the plot edges instead of their dates).
 *   2. Weigh-in gaps > LOW_CONFIDENCE_GAP_DAYS break the solid line and are
 *      bridged by dashed low-confidence segments.
 *   3. X ticks are explicit month boundaries labeled "Mar '26" — never the
 *      date-lookalike "Mar 26" recharts produced from auto ticks.
 */

import { render } from '@testing-library/react';

type CapturedProps = Record<string, unknown>;
const captured: { composedChart: CapturedProps[]; line: CapturedProps[]; scatter: CapturedProps[]; xAxis: CapturedProps[] } = {
  composedChart: [],
  line: [],
  scatter: [],
  xAxis: [],
};

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  ComposedChart: (props: CapturedProps & { children?: React.ReactNode }) => {
    captured.composedChart.push(props);
    return <div>{props.children as React.ReactNode}</div>;
  },
  Line: (props: CapturedProps) => {
    captured.line.push(props);
    return null;
  },
  Scatter: (props: CapturedProps) => {
    captured.scatter.push(props);
    return null;
  },
  XAxis: (props: CapturedProps) => {
    captured.xAxis.push(props);
    return null;
  },
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceArea: () => null,
}));

import { PhaseHistoryChart } from '@/components/body/PhaseHistoryChart';
import { LOW_CONFIDENCE_GAP_DAYS } from '@/services/bodyCompAnchor';

interface Row {
  ts: number;
  weight: number | null;
  scanWeight?: number;
  [key: `gap${number}`]: number | undefined;
}

const ts = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

// Dense head (daily), then sparse tail with gaps far beyond the threshold.
const denseHead = Array.from({ length: 10 }, (_, i) => ({
  day: `2026-02-${String(20 + (i % 9)).padStart(2, '0')}`,
  weight: 169 + (i % 3) * 0.3,
})).filter((w, i, arr) => arr.findIndex((x) => x.day === w.day) === i);
const sparseTail = [
  { day: '2026-04-20', weight: 169.0 },
  { day: '2026-06-26', weight: 170.1 },
];
const weighIns = [...denseHead, ...sparseTail];

function renderChart(props: Partial<React.ComponentProps<typeof PhaseHistoryChart>> = {}) {
  captured.composedChart.length = 0;
  captured.line.length = 0;
  captured.scatter.length = 0;
  captured.xAxis.length = 0;
  return render(
    <PhaseHistoryChart
      weighIns={weighIns}
      scanDays={['2026-02-22', '2026-06-26']}
      phases={[]}
      unitLabel="lb"
      {...props}
    />
  );
}

const chartRows = (): Row[] => captured.composedChart[0].data as Row[];

describe('PhaseHistoryChart', () => {
  it('renders the empty state below two weigh-ins', () => {
    const { getByText } = renderChart({ weighIns: [{ day: '2026-06-01', weight: 170 }] });
    expect(getByText(/Not enough weight data/)).toBeInTheDocument();
    expect(captured.composedChart).toHaveLength(0);
  });

  it('merges DEXA markers into the chart rows instead of a separate Scatter data prop', () => {
    renderChart();

    // The Scatter must NOT carry its own data — recharts index-positions a
    // child Scatter's own rows across the axis (dots pinned to plot edges).
    expect(captured.scatter).toHaveLength(1);
    expect(captured.scatter[0].data).toBeUndefined();
    expect(captured.scatter[0].dataKey).toBe('scanWeight');

    // Each scan snapped onto the nearest weigh-in row, on the line.
    const marked = chartRows().filter((r) => r.scanWeight != null);
    expect(marked.map((r) => r.ts)).toEqual([ts('2026-02-22'), ts('2026-06-26')]);
    marked.forEach((r) => expect(r.scanWeight).toBe(r.weight));
  });

  it('drops scans outside the weigh-in range', () => {
    renderChart({ scanDays: ['2025-12-01', '2026-07-15'] });
    expect(chartRows().every((r) => r.scanWeight == null)).toBe(true);
  });

  it(`bridges weigh-in gaps > ${LOW_CONFIDENCE_GAP_DAYS} days with dashed segments and breaks the solid line`, () => {
    renderChart();

    // Two long gaps: Feb 28 → Apr 20 and Apr 20 → Jun 26.
    const gapLines = captured.line.filter((l) => String(l.dataKey).startsWith('gap'));
    expect(gapLines.map((l) => l.dataKey)).toEqual(['gap0', 'gap1']);
    gapLines.forEach((l) => {
      expect(l.strokeDasharray).toBeTruthy();
      expect(l.connectNulls).toBe(true);
    });

    // Gap endpoints carry the bridge values; a null mid-gap row breaks the
    // solid line so it cannot span the void.
    const rows = chartRows();
    const gap0Points = rows.filter((r) => r.gap0 != null);
    expect(gap0Points.map((r) => r.ts)).toEqual([ts('2026-02-28'), ts('2026-04-20')]);
    const breakers = rows.filter((r) => r.weight === null);
    expect(breakers).toHaveLength(2);
    expect(breakers[0].ts).toBeGreaterThan(ts('2026-02-28'));
    expect(breakers[0].ts).toBeLessThan(ts('2026-04-20'));
  });

  it('marks real weigh-ins with point dots when the series is sparse', () => {
    renderChart();
    const solid = captured.line.find((l) => l.dataKey === 'weight');
    expect(solid?.dot).toBeTruthy();

    // Dense multi-year series: dots off so the line stays readable.
    const daily: { day: string; weight: number }[] = [];
    const start = new Date(2025, 0, 1);
    for (let i = 0; i < 200; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      daily.push({
        day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        weight: 170,
      });
    }
    renderChart({ weighIns: daily });
    const denseSolid = captured.line.find((l) => l.dataKey === 'weight');
    expect(denseSolid?.dot).toBe(false);
  });

  it("labels x ticks as explicit month boundaries in \"Mar '26\" form", () => {
    renderChart();
    const axis = captured.xAxis[0];
    const tickValues = axis.ticks as number[];
    // Months fully inside the data range: Mar, Apr, May, Jun 2026.
    expect(tickValues).toEqual([ts('2026-03-01'), ts('2026-04-01'), ts('2026-05-01'), ts('2026-06-01')]);
    const fmt = axis.tickFormatter as (t: number) => string;
    expect(fmt(ts('2026-03-01'))).toBe("Mar '26");
    expect(fmt(ts('2026-06-01'))).toBe("Jun '26");
  });
});
