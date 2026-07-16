import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutVolumeStrip } from '../WorkoutVolumeStrip';
import type { WorkoutMuscleVolumeRow } from '@/hooks/useWorkoutMuscleVolume';

function row(muscle: string, over: Partial<WorkoutMuscleVolumeRow> = {}): WorkoutMuscleVolumeRow {
  return {
    key: muscle,
    muscle,
    displayName: muscle.charAt(0).toUpperCase() + muscle.slice(1),
    isChild: false,
    parent: null,
    sets: 8,
    band: { mev: 8, mrv: 20 },
    zone: 'in_zone',
    belowMev: false,
    reachable: true,
    expandable: false,
    exercises: [],
    children: [],
    sessionSets: 0,
    trainedThisSession: true,
    readiness: 1,
    readyInHours: 0,
    ...over,
  } as WorkoutMuscleVolumeRow;
}

const noop = () => {};

describe('WorkoutVolumeStrip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a chip per row with the readiness dot and "Ready" microcopy', () => {
    render(
      <WorkoutVolumeStrip
        rows={[row('chest'), row('quads', { readiness: 0.9 })]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    expect(screen.getByTestId('workout-volume-chip-chest')).toBeInTheDocument();
    expect(screen.getByTestId('workout-volume-readiness-dot-quads')).toHaveClass('bg-success-500');
    expect(screen.getByTestId('workout-volume-readiness-quads')).toHaveTextContent('Ready');
  });

  it('shows amber/red dots and the "~Nh" ETA below the ready threshold', () => {
    render(
      <WorkoutVolumeStrip
        rows={[
          row('back', { readiness: 0.6, readyInHours: 9.6 }),
          row('glutes', { readiness: 0.1, readyInHours: 36 }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    expect(screen.getByTestId('workout-volume-readiness-dot-back')).toHaveClass('bg-warning-500');
    expect(screen.getByTestId('workout-volume-readiness-back')).toHaveTextContent('~10h');
    expect(screen.getByTestId('workout-volume-readiness-dot-glutes')).toHaveClass('bg-danger-500');
    expect(screen.getByTestId('workout-volume-readiness-glutes')).toHaveTextContent('~36h');
  });

  it('collapses and re-expands the card row via the header toggle', async () => {
    const user = userEvent.setup();
    render(<WorkoutVolumeStrip rows={[row('chest')]} isLoading={false} onOpenDetail={noop} />);

    const toggle = screen.getByTestId('workout-volume-strip-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('workout-volume-chip-chest')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByTestId('workout-volume-chip-chest')).toBeInTheDocument();
  });

  it('shows session muscles by default, the rest behind "Show all (+N)"', async () => {
    const user = userEvent.setup();
    render(
      <WorkoutVolumeStrip
        rows={[
          row('quads'),
          row('chest', { trainedThisSession: false }),
          row('back', { trainedThisSession: false }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    expect(screen.getByTestId('workout-volume-chip-quads')).toBeInTheDocument();
    expect(screen.queryByTestId('workout-volume-chip-chest')).not.toBeInTheDocument();

    const expander = screen.getByTestId('workout-volume-strip-show-all');
    expect(expander).toHaveTextContent('Show all (+2)');

    await user.click(expander);
    // Session muscles stay first; the rest append.
    const chips = screen.getAllByTestId(/^workout-volume-chip-/);
    expect(chips.map((c) => c.getAttribute('data-testid'))).toEqual([
      'workout-volume-chip-quads',
      'workout-volume-chip-chest',
      'workout-volume-chip-back',
    ]);
    expect(expander).toHaveTextContent('Show less');

    await user.click(expander);
    expect(screen.queryByTestId('workout-volume-chip-chest')).not.toBeInTheDocument();
  });

  it('persists the show-all preference across mounts', async () => {
    const user = userEvent.setup();
    const rows = [row('quads'), row('chest', { trainedThisSession: false })];
    const first = render(<WorkoutVolumeStrip rows={rows} isLoading={false} onOpenDetail={noop} />);
    await user.click(screen.getByTestId('workout-volume-strip-show-all'));
    first.unmount();

    render(<WorkoutVolumeStrip rows={rows} isLoading={false} onOpenDetail={noop} />);
    expect(screen.getByTestId('workout-volume-chip-chest')).toBeInTheDocument();
    expect(screen.getByTestId('workout-volume-strip-show-all')).toHaveTextContent('Show less');
  });

  it('shows everything (no expander) when no muscle is session-trained', () => {
    render(
      <WorkoutVolumeStrip
        rows={[row('chest', { trainedThisSession: false }), row('back', { trainedThisSession: false })]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );
    expect(screen.getByTestId('workout-volume-chip-chest')).toBeInTheDocument();
    expect(screen.getByTestId('workout-volume-chip-back')).toBeInTheDocument();
    expect(screen.queryByTestId('workout-volume-strip-show-all')).not.toBeInTheDocument();
  });

  it('persists the collapse preference across mounts', async () => {
    const user = userEvent.setup();
    const first = render(
      <WorkoutVolumeStrip rows={[row('chest')]} isLoading={false} onOpenDetail={noop} />
    );
    await user.click(screen.getByTestId('workout-volume-strip-toggle'));
    first.unmount();

    render(<WorkoutVolumeStrip rows={[row('chest')]} isLoading={false} onOpenDetail={noop} />);
    expect(screen.getByTestId('workout-volume-strip-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('workout-volume-chip-chest')).not.toBeInTheDocument();
  });
});
