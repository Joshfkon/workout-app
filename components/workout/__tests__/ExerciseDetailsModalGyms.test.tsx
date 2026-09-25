/**
 * The exercise detail sheet's per-gym selector: a machine lift trained at
 * more than one gym reads History / Charts / Records one gym at a time, so a
 * lighter-reading machine elsewhere never shows up as a lost PR or regression.
 * The data hook is mocked; derivations are covered by the pure-service tests.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/types/schema';
import { ExerciseDetailsModal } from '../ExerciseDetailsModal';

let mockSessions: unknown[] = [];
jest.mock('@/hooks/useExerciseDetailHistory', () => ({
  useExerciseDetailHistory: () => ({ data: mockSessions, isLoading: false, isError: false }),
}));
jest.mock('../exercise-details/ExerciseEditForm', () => ({ ExerciseEditForm: () => null }));
jest.mock('../exercise-details/ChartsTab', () => ({
  ChartsTab: ({ sessions, gymTracks }: { sessions: unknown[]; gymTracks?: unknown[] }) => (
    <div data-testid="charts-probe">
      {sessions.length} sessions{gymTracks ? ` · ${gymTracks.length} gym lines` : ''}
    </div>
  ),
}));

const session = (id: string, date: string, locationId: string | null, locationName: string | null, kg: number) => ({
  sessionId: id,
  date,
  isDeload: false,
  locationId,
  locationName,
  sets: [{ weightKg: kg, reps: 10, rpe: 8 }],
  bestE1RM: kg * 1.33,
  topSet: { weightKg: kg, reps: 10, rpe: 8 },
  totalVolume: kg * 10,
});

const mixedGyms = () => [
  session('p1', '2026-09-24T10:00:00Z', 'pf', 'Planet Fitness', 59),
  session('h2', '2026-09-17T10:00:00Z', 'home', 'Home Gym', 82),
  session('h1', '2026-09-10T10:00:00Z', 'home', 'Home Gym', 80),
];

const exercise = (name: string, equipment: string[]) =>
  ({ id: `ex-${name}`, name, equipmentRequired: equipment }) as unknown as Exercise;

function renderSheet(ex: Exercise, currentLocationId?: string | null) {
  return render(
    <ExerciseDetailsModal
      exercise={ex}
      isOpen
      onClose={() => {}}
      unit="kg"
      currentLocationId={currentLocationId}
    />
  );
}

describe('ExerciseDetailsModal — per-gym history', () => {
  beforeEach(() => {
    mockSessions = mixedGyms();
  });

  it('opens a machine lift on the gym you are at, with an All gyms option', () => {
    renderSheet(exercise('Seated Leg Curl', ['leg_curl']), 'pf');

    const selector = screen.getByTestId('exercise-detail-gym-selector');
    const options = within(selector).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(['Planet Fitness', 'Home Gym', 'All gyms']);
    expect(within(selector).getByRole('radio', { name: 'Planet Fitness' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('scopes Records to the selected gym and warns on the combined view', async () => {
    const user = userEvent.setup();
    renderSheet(exercise('Seated Leg Curl', ['leg_curl']), 'home');

    await user.click(screen.getByTestId('exercise-detail-tab-records'));
    expect(screen.queryByTestId('records-mixed-gyms')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'All gyms' }));
    expect(screen.getByTestId('records-mixed-gyms')).toBeInTheDocument();
  });

  it('draws one line per gym on the combined chart, one gym otherwise', async () => {
    const user = userEvent.setup();
    renderSheet(exercise('Seated Leg Curl', ['leg_curl']), 'home');

    await user.click(screen.getByTestId('exercise-detail-tab-charts'));
    expect(screen.getByTestId('charts-probe')).toHaveTextContent('2 sessions');

    await user.click(screen.getByRole('radio', { name: 'All gyms' }));
    expect(screen.getByTestId('charts-probe')).toHaveTextContent('3 sessions · 2 gym lines');
  });

  it('shows no selector for a free-weight lift', () => {
    renderSheet(exercise('Barbell Bench Press', ['barbell', 'flat_bench']), 'pf');
    expect(screen.queryByTestId('exercise-detail-gym-selector')).not.toBeInTheDocument();
  });
});
