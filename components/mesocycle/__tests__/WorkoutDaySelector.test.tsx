import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { WorkoutDaySelector } from '@/components/mesocycle/WorkoutDaySelector';
import type { WorkoutDay } from '@/types/schema';

/** Controlled harness so preset/shift clicks round-trip through state. */
function Harness({
  daysPerWeek = 4,
  initial = ['Monday', 'Tuesday', 'Thursday', 'Friday'] as WorkoutDay[],
}: {
  daysPerWeek?: number;
  initial?: WorkoutDay[];
}) {
  const [days, setDays] = useState<WorkoutDay[]>(initial);
  return (
    <WorkoutDaySelector daysPerWeek={daysPerWeek} selectedDays={days} onChange={setDays} />
  );
}

function selectedDayLabels(): string[] {
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].filter(
    (day) => screen.getByRole('button', { name: day }).getAttribute('aria-pressed') === 'true'
  );
}

describe('WorkoutDaySelector', () => {
  it('renders every day identically — no weekend is singled out', () => {
    render(<Harness />);

    // The old UI tagged Sat/Sun with a "Weekend" sublabel and dimmed them.
    const saturday = screen.getByRole('button', { name: 'Saturday' });
    const sunday = screen.getByRole('button', { name: 'Sunday' });
    const wednesday = screen.getByRole('button', { name: 'Wednesday' });

    expect(saturday.textContent).toBe('Sat');
    expect(sunday.textContent).toBe('Sun');
    expect(saturday.className).toBe(wednesday.className);
    expect(sunday.className).toBe(wednesday.className);
  });

  it('lets a weekend day be selected like any other', async () => {
    const user = userEvent.setup();
    render(<Harness daysPerWeek={2} initial={[]} />);

    await user.click(screen.getByRole('button', { name: 'Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Sunday' }));

    expect(selectedDayLabels()).toEqual(['Saturday', 'Sunday']);
    expect(screen.getByText('2/2 days selected')).toBeInTheDocument();
  });

  it('offers a weekend preset, not just weekday ones', async () => {
    const user = userEvent.setup();
    render(<Harness daysPerWeek={2} initial={[]} />);

    await user.click(screen.getByRole('button', { name: 'Weekends only' }));

    expect(selectedDayLabels()).toEqual(['Saturday', 'Sunday']);
  });

  it('shifts the whole selection forward, wrapping Sunday to Monday', async () => {
    const user = userEvent.setup();
    render(<Harness daysPerWeek={2} initial={['Friday', 'Sunday']} />);

    await user.click(screen.getByRole('button', { name: /shift/i }));

    expect(selectedDayLabels()).toEqual(['Monday', 'Saturday']);
  });

  it('hides the weekdays-only preset when it cannot cover the week', () => {
    render(<Harness daysPerWeek={6} initial={[]} />);
    expect(screen.queryByRole('button', { name: 'Weekdays only' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spread out' })).toBeInTheDocument();
  });

  it('marks the active preset', async () => {
    const user = userEvent.setup();
    render(<Harness daysPerWeek={3} initial={[]} />);

    const spreadOut = screen.getByRole('button', { name: 'Spread out' });
    expect(spreadOut).toHaveAttribute('aria-pressed', 'false');

    await user.click(spreadOut);
    expect(spreadOut).toHaveAttribute('aria-pressed', 'true');
    expect(selectedDayLabels()).toEqual(['Monday', 'Wednesday', 'Friday']);
  });

  it('does not mutate the selectedDays prop when rendering the summary', () => {
    const days: WorkoutDay[] = ['Friday', 'Monday'];
    render(<WorkoutDaySelector daysPerWeek={2} selectedDays={days} onChange={() => {}} />);
    expect(days).toEqual(['Friday', 'Monday']);
    expect(screen.getByText('Monday, Friday')).toBeInTheDocument();
  });
});
