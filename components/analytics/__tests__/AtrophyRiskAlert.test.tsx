import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtrophyRiskAlert } from '../AtrophyRiskAlert';
import type { MuscleVolumeData } from '@/services/volumeTracker';

function belowMev(
  muscleGroup: MuscleVolumeData['muscleGroup'],
  totalSets: number,
  mev: number,
  contributingExercises?: MuscleVolumeData['contributingExercises']
): MuscleVolumeData {
  return {
    muscleGroup,
    totalSets,
    directSets: totalSets,
    indirectSets: 0,
    landmarks: { mev, mav: mev, mrv: mev },
    status: 'below_mev',
    percentOfMrv: 0,
    contributingExercises,
  };
}

describe('AtrophyRiskAlert exercise breakdown (FIX #4)', () => {
  it('lists which exercises fed a muscle so a miscount is visible', async () => {
    const user = userEvent.setup();
    render(
      <AtrophyRiskAlert
        userGoal="maintenance"
        musclesBelowMev={[
          belowMev('hamstrings', 3, 4, [
            { id: 'rdl', name: 'RDL', sets: 2 },
            { id: 'be', name: 'Back Extension', sets: 1.5 },
          ]),
        ]}
      />
    );

    await user.click(screen.getByText(/Show details/i));

    // Direct contributor rendered whole, secondary contributor rendered
    // fractional (½ credit) — the debug view that makes miscounts obvious.
    expect(screen.getByText(/RDL ×2/)).toBeInTheDocument();
    expect(screen.getByText(/Back Extension ×1\.5/)).toBeInTheDocument();
  });

  it('renders no breakdown line for an untrained (0-set) muscle', async () => {
    const user = userEvent.setup();
    render(
      <AtrophyRiskAlert
        userGoal="maintenance"
        musclesBelowMev={[belowMev('quads', 0, 6, [])]}
      />
    );

    await user.click(screen.getByText(/Show details/i));
    expect(screen.getAllByText(/Quads/).length).toBeGreaterThan(0);
    // No "×" credit line when nothing fed the muscle.
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });
});
