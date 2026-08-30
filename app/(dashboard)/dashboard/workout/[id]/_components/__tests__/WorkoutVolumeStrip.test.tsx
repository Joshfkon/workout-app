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
  });

  it('hides the planned segment when nothing is planned', () => {
    render(
      <WorkoutVolumeStrip rows={[row('chest')]} isLoading={false} onOpenDetail={noop} />
    );
    expect(screen.queryByTestId('workout-volume-planned-bar-chest')).not.toBeInTheDocument();
  });

  it('digests the session muscles into one "After today’s plan" line', () => {
    render(
      <WorkoutVolumeStrip
        rows={[
          row('chest', { sets: 10, plannedSets: 4 }),
          row('quads', { sets: 6, plannedSets: 4 }),
          row('back', {
            sets: 3,
            plannedSets: 2,
            zone: 'below_mev',
            projectedZone: 'below_mev',
          }),
          row('shoulders', { sets: 18, plannedSets: 6, projectedZone: 'over_mrv' }),
          row('biceps', {
            sets: 2,
            plannedSets: 1,
            zone: 'below_mev',
            projectedZone: 'below_mev',
            deficitLockedIn: true,
            readiness: 0.2,
            readyInHours: 40,
          }),
          // Not part of this session — never counted in the digest.
          row('calves', { trainedThisSession: false, sets: 0, zone: 'below_mev' }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    const digest = screen.getByTestId('workout-volume-projection-summary');
    expect(digest).toHaveTextContent('After today’s plan:');
    expect(digest).toHaveTextContent('2 in range');
    expect(digest).toHaveTextContent('1 under');
    expect(digest).toHaveTextContent('1 over max');
    expect(digest).toHaveTextContent('1 locked under');
  });

  it('hides the projection line while loading and when no session muscles exist', () => {
    const loading = render(
      <WorkoutVolumeStrip rows={[row('chest')]} isLoading={true} onOpenDetail={noop} />
    );
    expect(screen.queryByTestId('workout-volume-projection-summary')).not.toBeInTheDocument();
    loading.unmount();

    render(
      <WorkoutVolumeStrip
        rows={[row('chest', { trainedThisSession: false })]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );
    expect(screen.queryByTestId('workout-volume-projection-summary')).not.toBeInTheDocument();
  });

  it('expands the digest into a per-muscle projection list with the numbers', async () => {
    const user = userEvent.setup();
    render(
      <WorkoutVolumeStrip
        rows={[
          row('chest', { sets: 10, plannedSets: 4, band: { mev: 8, mrv: 20 } }),
          row('quads', { sets: 8, plannedSets: 0 }),
        ]}
        isLoading={false}
        onOpenDetail={noop}
      />
    );

    const digest = screen.getByTestId('workout-volume-projection-summary');
    expect(digest).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('workout-volume-projection-list')).not.toBeInTheDocument();

    await user.click(digest);
    expect(digest).toHaveAttribute('aria-expanded', 'true');
    const chestRow = screen.getByTestId('workout-volume-projection-row-chest');
    expect(chestRow).toHaveTextContent('Chest');
    expect(chestRow).toHaveTextContent('10 +4 → 14');
    expect(chestRow).toHaveTextContent('8–20');
    expect(chestRow).toHaveTextContent('In range');
    // A muscle with nothing left planned shows its standing without a fake "+0".
    const quadsRow = screen.getByTestId('workout-volume-projection-row-quads');
    expect(quadsRow).toHaveTextContent('8');
    expect(quadsRow).not.toHaveTextContent('→');

    await user.click(digest);
    expect(screen.queryByTestId('workout-volume-projection-list')).not.toBeInTheDocument();
  });

  it('marks a projected MRV overshoot amber on chip tint, digest and list row', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByTestId('workout-volume-chip-chest')).toHaveClass('border-warning-500/50');
    await user.click(screen.getByTestId('workout-volume-projection-summary'));
    const label = screen.getByText('Over max');
    expect(label).toHaveClass('text-warning-400');
  });

  it('marks a locked-in deficit red and explains it in the expanded list', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByTestId('workout-volume-chip-back')).toHaveClass('border-danger-500/50');
    await user.click(screen.getByTestId('workout-volume-projection-summary'));
    const label = screen.getByText('Locked in');
    expect(label).toHaveClass('text-danger-400');
    expect(screen.getByTestId('workout-volume-projection-list')).toHaveTextContent(
      'recovery won’t allow more quality sets'
    );
  });

  it('a merely-under projection carries no warning tint (still the user’s choice)', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByTestId('workout-volume-chip-back')).toHaveClass('border-surface-800');
    await user.click(screen.getByTestId('workout-volume-projection-summary'));
    expect(screen.getByText('Under min')).toHaveClass('text-surface-400');
  });

  it('tapping a chip opens the full "What to train" sheet', async () => {
    const user = userEvent.setup();
    const onOpenDetail = jest.fn();
    render(
      <WorkoutVolumeStrip rows={[row('chest')]} isLoading={false} onOpenDetail={onOpenDetail} />
    );
    await user.click(screen.getByTestId('workout-volume-chip-chest'));
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
