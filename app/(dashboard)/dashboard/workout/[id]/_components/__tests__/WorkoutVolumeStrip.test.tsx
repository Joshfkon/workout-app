import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutVolumeStrip } from '../WorkoutVolumeStrip';
import type { WorkoutMuscleVolumeRow } from '@/hooks/useWorkoutMuscleVolume';

function row(muscle: string, over: Partial<WorkoutMuscleVolumeRow> = {}): WorkoutMuscleVolumeRow {
  const base = {
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
    plannedSets: 0,
    projectedZone: 'in_zone',
    deficitLockedIn: false,
    ...over,
  } as WorkoutMuscleVolumeRow;
  // Projected defaults to completed + planned unless the test pins it.
  if (over.projectedSets === undefined) base.projectedSets = base.sets + base.plannedSets;
  return base;
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

  it('fills the bar completely at the top of the band (sets = MRV)', () => {
    render(
      <WorkoutVolumeStrip
        rows={[
          row('chest', { sets: 22, band: { mev: 8, mrv: 22 } }),
          row('back', { sets: 11, band: { mev: 8, mrv: 22 } }),
          row('quads', { sets: 30, band: { mev: 8, mrv: 22 } }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    expect(screen.getByTestId('workout-volume-bar-chest')).toHaveStyle({ width: '100%' });
    expect(screen.getByTestId('workout-volume-bar-back')).toHaveStyle({ width: '50%' });
    // Overrun past MRV stays capped at a full bar (color signals the overrun).
    expect(screen.getByTestId('workout-volume-bar-quads')).toHaveStyle({ width: '100%' });
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

  it('renders the hatched planned segment sized to today’s remaining contribution', () => {
    render(
      <WorkoutVolumeStrip
        rows={[row('chest', { sets: 10, plannedSets: 5, band: { mev: 8, mrv: 20 } })]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );
    // Completed 10/20 = 50%; projected 15/20 = 75% → planned segment 25%.
    expect(screen.getByTestId('workout-volume-bar-chest')).toHaveStyle({ width: '50%' });
    expect(screen.getByTestId('workout-volume-planned-bar-chest')).toHaveStyle({ width: '25%' });
    expect(screen.getByTestId('workout-volume-projection-chest')).toHaveTextContent('+5 today → 15');
  });

  it('hides the planned segment and projection line when nothing is planned', () => {
    render(
      <WorkoutVolumeStrip rows={[row('chest')]} isLoading={false} onOpenDetail={noop} />
    );
    expect(screen.queryByTestId('workout-volume-planned-bar-chest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workout-volume-projection-chest')).not.toBeInTheDocument();
  });

  it('reads amber when the projection overshoots MRV', () => {
    render(
      <WorkoutVolumeStrip
        rows={[
          row('chest', {
            sets: 18,
            plannedSets: 6,
            projectedZone: 'over_mrv',
            band: { mev: 8, mrv: 20 },
          }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );
    expect(screen.getByTestId('workout-volume-projection-chest')).toHaveClass('text-warning-400');
    expect(screen.getByTestId('workout-volume-chip-chest')).toHaveClass('border-warning-500/50');
  });

  it('reads red for a locked-in deficit', () => {
    render(
      <WorkoutVolumeStrip
        rows={[
          row('back', {
            sets: 3,
            plannedSets: 2,
            zone: 'below_mev',
            projectedZone: 'below_mev',
            deficitLockedIn: true,
            readiness: 0.2,
            readyInHours: 40,
          }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );
    expect(screen.getByTestId('workout-volume-projection-back')).toHaveClass('text-danger-400');
    expect(screen.getByTestId('workout-volume-chip-back')).toHaveClass('border-danger-500/50');
  });

  it('a merely-under projection carries no warning tint (still the user’s choice)', () => {
    render(
      <WorkoutVolumeStrip
        rows={[
          row('back', {
            sets: 3,
            plannedSets: 2,
            zone: 'below_mev',
            projectedZone: 'below_mev',
            deficitLockedIn: false,
          }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );
    expect(screen.getByTestId('workout-volume-projection-back')).toHaveClass('text-surface-400');
    expect(screen.getByTestId('workout-volume-chip-back')).toHaveClass('border-surface-800');
  });

  it('tapping a chip opens the numbers panel; tapping again closes it', async () => {
    const user = userEvent.setup();
    render(
      <WorkoutVolumeStrip
        rows={[row('chest', { sets: 10, plannedSets: 4, readyInHours: 0 })]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    const chip = screen.getByTestId('workout-volume-chip-chest');
    expect(chip).toHaveAttribute('aria-expanded', 'false');

    await user.click(chip);
    const panel = screen.getByTestId('workout-volume-detail-chest');
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveTextContent('10 sets');
    expect(panel).toHaveTextContent('+4 sets');
    expect(panel).toHaveTextContent('14 of 8–20');
    expect(panel).toHaveTextContent('Ready');

    await user.click(chip);
    expect(screen.queryByTestId('workout-volume-detail-chest')).not.toBeInTheDocument();
  });

  it('the panel explains a locked-in deficit and links to the full sheet', async () => {
    const user = userEvent.setup();
    const onOpenDetail = jest.fn();
    render(
      <WorkoutVolumeStrip
        rows={[
          row('back', {
            sets: 3,
            plannedSets: 2,
            zone: 'below_mev',
            projectedZone: 'below_mev',
            deficitLockedIn: true,
            readiness: 0.2,
            readyInHours: 40,
          }),
        ]}
        isLoading={false}
        onOpenDetail={onOpenDetail}
      />
    );

    await user.click(screen.getByTestId('workout-volume-chip-back'));
    expect(screen.getByTestId('workout-volume-detail-status-back')).toHaveTextContent(
      'Deficit locked in'
    );
    expect(screen.getByTestId('workout-volume-detail-back')).toHaveTextContent(
      'locked in'
    );

    await user.click(screen.getByTestId('workout-volume-detail-full-back'));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
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
