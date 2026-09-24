/**
 * ChartsTab "All gyms" view of a machine lift: every trend metric draws one
 * line per gym — a single line would zig-zag between machines that read
 * differently, which is exactly what the per-gym split exists to prevent.
 * Recharts is stubbed so the series the tab asks for are observable in jsdom.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChartsTab } from '../ChartsTab';
import { summarizeSessions } from '@/services/exerciseDetailAnalytics';
import { buildLocationTracks } from '@/services/locationTracks';

jest.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Pass,
    LineChart: ({ data, children }: { data: Record<string, unknown>[]; children?: React.ReactNode }) => (
      <div data-testid="line-chart" data-rows={JSON.stringify(data)}>{children}</div>
    ),
    BarChart: Pass,
    Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const sessions = summarizeSessions([
  { sessionId: 'p1', date: daysAgo(2), isDeload: false, locationId: 'pf', locationName: 'Planet Fitness', sets: [{ weightKg: 40, reps: 20, rpe: 8 }] },
  { sessionId: 'h1', date: daysAgo(9), isDeload: false, locationId: 'home', locationName: 'Home Gym', sets: [{ weightKg: 60, reps: 18, rpe: 8 }] },
  { sessionId: 'p0', date: daysAgo(16), isDeload: false, locationId: 'pf', locationName: 'Planet Fitness', sets: [{ weightKg: 40, reps: 19, rpe: 8 }] },
]);
const gymTracks = buildLocationTracks(sessions, (s) => s.locationId, (s) => s.date, {
  pf: 'Planet Fitness',
  home: 'Home Gym',
});

describe('ChartsTab — all gyms', () => {
  it('draws the rep-total trend as one line per gym', () => {
    render(<ChartsTab sessions={sessions} unit="lb" repTotalMode gymTracks={gymTracks} />);

    expect(screen.getByTestId('line-pf')).toBeInTheDocument();
    expect(screen.getByTestId('line-home')).toBeInTheDocument();
    expect(screen.queryByTestId('line-total')).not.toBeInTheDocument();

    const rows = JSON.parse(screen.getAllByTestId('line-chart')[0].dataset.rows as string);
    // Oldest first; each session only on its own gym's series.
    expect(rows.map((r: Record<string, unknown>) => [r.pf, r.home])).toEqual([
      [19, null],
      [null, 18],
      [20, null],
    ]);
  });

  it('draws the e1RM trend as one line per gym', async () => {
    const user = userEvent.setup();
    // Low-rep sets: 18–20 reps are outside the e1RM estimator's domain.
    const estimable = summarizeSessions(
      sessions.map((s) => ({ ...s, sets: [{ weightKg: s.sets[0].weightKg, reps: 8, rpe: 8 }] }))
    );
    render(<ChartsTab sessions={estimable} unit="lb" repTotalMode gymTracks={gymTracks} />);
    await user.click(screen.getByRole('button', { name: 'Est 1RM' }));

    expect(screen.getByTestId('line-pf')).toBeInTheDocument();
    expect(screen.getByTestId('line-home')).toBeInTheDocument();
    expect(screen.queryByTestId('line-e1rm')).not.toBeInTheDocument();
  });

  it('keeps the single line for one gym', () => {
    render(<ChartsTab sessions={sessions} unit="lb" repTotalMode />);
    expect(screen.getByTestId('line-total')).toBeInTheDocument();
    expect(screen.queryByTestId('line-pf')).not.toBeInTheDocument();
  });
});
