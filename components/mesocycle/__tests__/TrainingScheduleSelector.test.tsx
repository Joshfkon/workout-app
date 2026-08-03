import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TrainingScheduleSelector } from '@/components/mesocycle/TrainingScheduleSelector';
import type { WorkoutDay } from '@/types/schema';
import type { ScheduleMode } from '@/lib/training/trainingSchedule';

// 2026-08-03 is a Monday.
const ANCHOR = '2026-08-03';

function Harness({ initialMode = 'fixed_days' as ScheduleMode }) {
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [days, setDays] = useState<WorkoutDay[]>(['Monday', 'Tuesday', 'Thursday', 'Friday']);
  const [interval, setInterval] = useState(2);
  return (
    <TrainingScheduleSelector
      daysPerWeek={4}
      mode={mode}
      onModeChange={setMode}
      selectedDays={days}
      onDaysChange={setDays}
      intervalDays={interval}
      onIntervalChange={setInterval}
      anchorDate={ANCHOR}
    />
  );
}

describe('TrainingScheduleSelector', () => {
  it('starts on the weekday picker', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Monday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Same days each week' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('exposes an every-other-day cadence — the schedule weekdays cannot express', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Every N days' }));

    expect(screen.getByRole('button', { name: 'Every other day' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // The weekday grid is gone — an interval schedule has no fixed weekdays.
    expect(screen.queryByRole('button', { name: 'Monday' })).not.toBeInTheDocument();
  });

  it('previews the actual dates, which roll through the week', async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="interval" />);

    // Aug 3 (Mon), 5 (Wed), 7 (Fri), 9 (Sun), 11 (Tue) — weekends included.
    expect(screen.getByText(/Mon 3 → Wed 5 → Fri 7 → Sun 9 → Tue 11/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Every 3 days' }));

    // Aug 3 (Mon), 6 (Thu), 9 (Sun), 12 (Wed), 15 (Sat).
    expect(screen.getByText(/Mon 3 → Thu 6 → Sun 9 → Wed 12 → Sat 15/)).toBeInTheDocument();
  });

  it('states the fractional cadence and the whole-number planning value', () => {
    render(<Harness initialMode="interval" />);
    expect(screen.getByText(/~3\.5 sessions\/week/)).toBeInTheDocument();
    expect(screen.getByText(/planned at 4 sessions\/week/)).toBeInTheDocument();
  });
});
