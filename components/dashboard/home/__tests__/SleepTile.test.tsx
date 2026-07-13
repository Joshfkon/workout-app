/**
 * SleepTile — the home grid's Sleep card: last night's hours + quality dot,
 * the 7-day average line and a trailing-week sparkline; a quiet "Log sleep"
 * affordance when nothing is logged (never a warning nag); tap opens the
 * inline log sheet.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SleepTile, type SleepGlance } from '@/components/dashboard/home/SleepTile';
import { getLocalDateString } from '@/lib/utils';
import type { SleepLogEntry } from '@/types/schema';

/** Local-day string `days` before today (entries are keyed by local day). */
function dayAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return getLocalDateString(d);
}

/** A trailing week of entries, newest first (index 0 = last night = today). */
const weekFixture: SleepLogEntry[] = [
  { localDay: dayAgo(0), hours: 7.5, quality: 'good', source: 'manual' },
  { localDay: dayAgo(1), hours: 6.5, quality: 'ok', source: 'manual' },
  { localDay: dayAgo(2), hours: 8, quality: 'good', source: 'manual' },
  { localDay: dayAgo(3), hours: 7, quality: 'ok', source: 'manual' },
  { localDay: dayAgo(4), hours: 6, quality: 'poor', source: 'manual' },
  { localDay: dayAgo(5), hours: 7.5, quality: 'good', source: 'manual' },
  { localDay: dayAgo(6), hours: 8, quality: 'good', source: 'manual' },
];

const avg = weekFixture.reduce((s, e) => s + e.hours, 0) / weekFixture.length; // 7.2h

function glance(overrides: Partial<SleepGlance> = {}): SleepGlance {
  return {
    entries: weekFixture,
    lastNight: weekFixture[0],
    sevenDayAvgHours: avg,
    ...overrides,
  };
}

describe('SleepTile', () => {
  it('renders last night hours with the quality dot', () => {
    render(<SleepTile sleep={glance()} onLog={() => {}} />);
    expect(screen.getByText('7.5h')).toBeInTheDocument();
    expect(screen.getByText(/last night/)).toBeInTheDocument();
    expect(screen.getByTestId('sleep-quality-dot')).toHaveClass('bg-success-400');
  });

  it('renders the 7-day average line and the trailing-week sparkline from the fixture', () => {
    render(<SleepTile sleep={glance()} onLog={() => {}} />);
    expect(screen.getByTestId('sleep-avg')).toHaveTextContent('7.2h avg this week');
    const sparkline = screen.getByTestId('sleep-sparkline');
    // One point per fixture night, oldest → newest.
    const points = sparkline.querySelector('polyline')!.getAttribute('points')!.split(' ');
    expect(points).toHaveLength(weekFixture.length);
  });

  it('empty state is a quiet "Log sleep" affordance — no data, no warning styling', () => {
    render(
      <SleepTile sleep={glance({ entries: [], lastNight: null, sevenDayAvgHours: null })} onLog={() => {}} />
    );
    expect(screen.getByText('Log sleep')).toBeInTheDocument();
    expect(screen.queryByTestId('sleep-sparkline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sleep-avg')).not.toBeInTheDocument();
    // Neutral tile border — the empty state must never nag.
    expect(screen.getByRole('button').className).not.toContain('warning');
  });

  it('tapping the tile opens the log sheet', async () => {
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SleepTile sleep={glance()} onLog={onLog} />);
    await user.click(screen.getByRole('button'));
    expect(onLog).toHaveBeenCalledTimes(1);
  });
});
