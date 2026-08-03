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

const PRESET_LABELS = [
  'Spread out',
  'Weekdays only',
  'Weekends only',
  'Weekends + weekdays',
  'Back to back',
];

/** Preset chips currently rendered, in order. */
function presetLabels(): string[] {
  return PRESET_LABELS.filter((label) => screen.queryByRole('button', { name: label }) !== null);
}

/** Preset chips showing themselves as applied. */
function activePresetLabels(): string[] {
  return presetLabels().filter(
    (label) => screen.getByRole('button', { name: label }).getAttribute('aria-pressed') === 'true'
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

  // Reported: "hitting any other button auto selects weekdays only", and
  // "hitting weekdays only while it's selected does nothing". Both came from
  // preset chips that lit up for selections they had not produced.
  describe('preset chips report only what they actually applied', () => {
    it.each([2, 3, 4, 5, 6])(
      'lights at most one chip at %i days/week, whichever was pressed',
      async (daysPerWeek) => {
        const user = userEvent.setup();
        render(<Harness daysPerWeek={daysPerWeek} initial={[]} />);

        for (const label of presetLabels()) {
          await user.click(screen.getByRole('button', { name: label }));
          expect(activePresetLabels()).toEqual([label]);
        }
      }
    );

    it('does not claim "weekdays only" for a different all-weekday preset', async () => {
      const user = userEvent.setup();
      render(<Harness daysPerWeek={4} initial={[]} />);

      // Spread out at 4 days is Mon/Tue/Thu/Fri — every day a weekday, but
      // not the weekdays-only selection.
      await user.click(screen.getByRole('button', { name: 'Spread out' }));

      expect(selectedDayLabels()).toEqual(['Monday', 'Tuesday', 'Thursday', 'Friday']);
      expect(screen.getByRole('button', { name: 'Weekdays only' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('never offers two chips that produce the same days', () => {
      for (const daysPerWeek of [1, 2, 3, 4, 5, 6, 7]) {
        const { unmount } = render(<Harness daysPerWeek={daysPerWeek} initial={[]} />);
        const labels = presetLabels();
        expect(labels.length).toBeGreaterThan(0);
        expect(new Set(labels).size).toBe(labels.length);
        unmount();
      }
    });

    it('re-applies a preset after the user hand-edits the days', async () => {
      const user = userEvent.setup();
      render(<Harness daysPerWeek={4} initial={[]} />);

      await user.click(screen.getByRole('button', { name: 'Weekdays only' }));
      const weekdaysOnly = selectedDayLabels();
      expect(screen.getByRole('button', { name: 'Weekdays only' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      // Hand-edit away from the preset: the chip must stop claiming it applies.
      await user.click(screen.getByRole('button', { name: 'Sunday' }));
      expect(screen.getByRole('button', { name: 'Weekdays only' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      // Pressing it again restores exactly the preset.
      await user.click(screen.getByRole('button', { name: 'Weekdays only' }));
      expect(selectedDayLabels()).toEqual(weekdaysOnly);
    });
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
