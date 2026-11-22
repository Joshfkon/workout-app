/**
 * Shorter AI start (UX panel: mode → gym → duration → confirm). The sheet now
 * opens straight onto a plan sized for the last-used duration at the
 * last-used location, so the only tap left is Start; "Change" still reaches
 * the duration picker.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

/** Chainable, awaitable stand-in for a Supabase query builder. */
function query(result: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'eq', 'gte', 'limit', 'insert']) {
    builder[m] = () => builder;
  }
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

const EXERCISES = [
  { id: 'ex-1', name: 'Goblet Squat', primary_muscle: 'quads', exercise_type: 'rep_based' },
  { id: 'ex-2', name: 'Lat Pulldown', primary_muscle: 'lats', exercise_type: 'rep_based' },
].map((e) => ({
  secondary_muscles: [],
  movement_pattern: null,
  mechanic: 'compound',
  default_rep_range: [8, 12],
  default_rir: 2,
  hypertrophy_tier: 'A',
  equipment_required: [],
  is_bodyweight: false,
  ...e,
}));

const mockInsert = jest.fn(() => Promise.resolve({ error: null }));
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: (table: string) => {
      if (table === 'exercises') return query({ data: EXERCISES });
      if (table === 'users') return query({ data: { weight_kg: null, height_cm: null } });
      if (table === 'exercise_blocks') {
        const q = query({ data: [] });
        (q as Record<string, unknown>).insert = mockInsert;
        return q;
      }
      return query({ data: [] });
    },
  }),
}));
jest.mock('@/lib/supabase/authState', () => ({ getLocalUserId: () => Promise.resolve('user-1') }));
jest.mock('@/hooks/useMuscleRecovery', () => ({
  useMuscleRecovery: () => ({ recoveryStatus: [], isLoading: false }),
}));
jest.mock('@/hooks/useWeeklyVolume', () => ({
  useWeeklyVolume: () => ({ volumeData: [], isLoading: false }),
}));
jest.mock('@/lib/actions/equipment', () => ({ fetchUnavailableEquipment: () => Promise.resolve([]) }));

const GYM = {
  id: 'loc-gym',
  name: 'Iron Gym',
  is_default: false,
  last_used_at: '2026-11-20T10:00:00Z',
  icon: null,
  preset_kind: 'gym',
  dumbbell_max_kg: null,
};
const HOME = { ...GYM, id: 'loc-home', name: 'Home', is_default: true, last_used_at: null, preset_kind: 'home' };
jest.mock('@/lib/actions/locations', () => ({
  fetchTrainingLocations: () => Promise.resolve([HOME, GYM]),
  fetchUnavailableEquipmentForLocation: () => Promise.resolve([]),
  touchLocationLastUsed: () => Promise.resolve(),
  createTrainingLocation: jest.fn(),
}));
const mockGetOrCreate = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ sessionId: 'sess-1', isNewSession: true })
);
jest.mock('@/app/(dashboard)/dashboard/workout/_lib/adhocSession', () => ({
  getOrCreateTodaySession: (...args: unknown[]) => mockGetOrCreate(...args),
}));
jest.mock('@/lib/training/transferCandidates', () => ({
  fetchTransferCandidates: () => Promise.resolve([]),
}));
jest.mock('@/lib/geo/gymChoice', () => ({ markGymChosen: jest.fn() }));

const mockBuild = jest.fn();
jest.mock('@/services/suggestedWorkout', () => {
  const actual = jest.requireActual('@/services/suggestedWorkout');
  return {
    ...actual,
    buildSuggestedWorkout: (input: { maxExercises: number; sessionMinutes: number }) => {
      mockBuild(input);
      return {
        focus: 'Legs and back are recovered and under target.',
        isLightSession: false,
        exercises: [
          { exerciseId: 'ex-1', muscle: 'quads', reason: 'under target', sets: 3, repRange: [8, 12], targetRir: 2 },
          { exerciseId: 'ex-2', muscle: 'lats', reason: 'under target', sets: 3, repRange: [8, 12], targetRir: 2 },
        ],
      };
    },
  };
});

import { SuggestedWorkoutSheet, AI_DURATION_STORAGE_KEY } from '../SuggestedWorkoutSheet';

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('SuggestedWorkoutSheet: one tap to start', () => {
  it('opens straight onto the plan (default 45 min) — no duration tap needed', async () => {
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    expect(
      await screen.findByRole('button', { name: 'Start workout (2 exercises)' })
    ).toBeInTheDocument();
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMinutes: 45 }));
    expect(screen.queryByText('How much time do you have?')).not.toBeInTheDocument();
    // Last-used location is preselected.
    expect(screen.getByRole('button', { name: /Iron Gym/, pressed: true })).toBeInTheDocument();
    // Target effort in plain words, the term kept.
    expect(screen.getAllByText(/stop 2 reps short of failure/).length).toBeGreaterThan(0);
  });

  it('uses the last-used duration', async () => {
    window.localStorage.setItem(AI_DURATION_STORAGE_KEY, '30');
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    expect(mockBuild).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionMinutes: 30, maxExercises: 3 })
    );
    expect(screen.getByText(/Sized for ~30 minutes/)).toBeInTheDocument();
  });

  it('Start is the only tap: it creates the session at the preselected gym', async () => {
    const user = userEvent.setup();
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Start workout (2 exercises)' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/workout/sess-1?fromCreate=true'));
    expect(mockGetOrCreate).toHaveBeenCalledWith(expect.anything(), 'user-1', 'ai_suggested', 'loc-gym');
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(AI_DURATION_STORAGE_KEY)).toBe('45');
  });

  it('"Change" reopens the duration picker; a new pick rebuilds and is remembered', async () => {
    const user = userEvent.setup();
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });

    await user.click(screen.getByTestId('suggested-workout-change-duration'));
    expect(screen.getByText('How much time do you have?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^60\s*min$/ }));
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMinutes: 60 }));
    expect(window.localStorage.getItem(AI_DURATION_STORAGE_KEY)).toBe('60');
  });
});
