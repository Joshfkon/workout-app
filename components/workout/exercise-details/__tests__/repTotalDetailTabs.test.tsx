import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryTab } from '../HistoryTab';
import { RecordsTab } from '../RecordsTab';
import { ChartsTab } from '../ChartsTab';
import type { ExerciseDetailSession } from '@/services/exerciseDetailAnalytics';

// Recharts' ResponsiveContainer needs ResizeObserver, absent in jsdom.
beforeAll(() => {
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/**
 * ADD 2 follow-up: the exercise-detail sheet must not present e1RM-derived
 * numbers for a rep_total exercise — session rep totals replace them.
 */

const LB135_KG = 61.23496995;

function session(id: string, date: string, reps: number[]): ExerciseDetailSession {
  const sets = reps.map((r) => ({ weightKg: LB135_KG, reps: r, rpe: 9 }));
  return {
    sessionId: id,
    date,
    isDeload: false,
    locationName: null,
    sets,
    // e1RM fields as the analytics layer would compute them for high-rep
    // history (0 = no estimate) — but ALSO test with a positive value to
    // prove the gate, not the data, hides it.
    bestE1RM: 100,
    topSet: sets[0],
    totalVolume: sets.reduce((s, x) => s + x.weightKg * x.reps, 0),
  };
}

const sessions = [
  session('s2', '2026-07-20T12:00:00Z', [20, 18, 16]),
  session('s1', '2026-07-11T12:00:00Z', [20, 18, 10]),
];

describe('rep_total detail tabs (no e1RM anywhere)', () => {
  it('HistoryTab: expanded session shows rep total, never "Session best e1RM"', async () => {
    const user = userEvent.setup();
    render(<HistoryTab sessions={sessions} isLoading={false} unit="lb" repTotalMode />);
    await user.click(screen.getByText(/Jul 20/));
    expect(screen.getByText(/Session rep total/)).toBeInTheDocument();
    expect(screen.getByText('54 reps')).toBeInTheDocument();
    expect(screen.queryByText(/Session best e1RM/)).not.toBeInTheDocument();
  });

  it('RecordsTab: "Best est. 1RM" card is replaced by "Best session reps"', () => {
    render(<RecordsTab sessions={sessions} unit="lb" repTotalMode />);
    expect(screen.getByText(/Best session reps/i)).toBeInTheDocument();
    expect(screen.getByText('54 reps')).toBeInTheDocument();
    expect(screen.queryByText(/Best est\. 1RM/i)).not.toBeInTheDocument();
  });

  it('ChartsTab: e1RM trend is replaced by the session rep-total trend', () => {
    render(<ChartsTab sessions={sessions} unit="lb" repTotalMode />);
    expect(screen.getByText(/Session rep total/)).toBeInTheDocument();
    expect(screen.queryByText(/Est\. 1RM trend/)).not.toBeInTheDocument();
  });

  it('default (e1rm) mode is unchanged', async () => {
    const user = userEvent.setup();
    render(<HistoryTab sessions={sessions} isLoading={false} unit="lb" />);
    await user.click(screen.getByText(/Jul 20/));
    expect(screen.getByText(/Session best e1RM/)).toBeInTheDocument();
    expect(screen.queryByText(/Session rep total/)).not.toBeInTheDocument();
  });
});
