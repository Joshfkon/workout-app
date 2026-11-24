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
const mockPrefetch = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, prefetch: mockPrefetch }) }));

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

const mockInsert = jest.fn((_rows: unknown) => Promise.resolve({ error: null }));
let mockUsersRow: Record<string, unknown> = { weight_kg: null, height_cm: null };
/** Rows the usage query (exercise_blocks ⋈ workout_sessions) returns. */
let mockUsage: unknown[] = [];
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: (table: string) => {
      if (table === 'exercises') return query({ data: EXERCISES });
      if (table === 'users') return query({ data: mockUsersRow });
      if (table === 'exercise_blocks') {
        const q = query({ data: mockUsage });
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
/** Whether the sheet's read says today already has an ad-hoc session. */
let mockTodayAdhocExists: boolean | null = true;
const mockInsertSession = jest.fn((..._args: unknown[]) => Promise.resolve('client-id'));
jest.mock('@/app/(dashboard)/dashboard/workout/_lib/adhocSession', () => ({
  getOrCreateTodaySession: (...args: unknown[]) => mockGetOrCreate(...args),
  hasTodayAdhocSession: () => Promise.resolve(mockTodayAdhocExists),
  insertTodayAdhocSession: (...args: unknown[]) => mockInsertSession(...args),
  newClientSessionId: () => 'client-id',
}));
jest.mock('@/lib/training/transferCandidates', () => ({
  fetchTransferCandidates: () => Promise.resolve([]),
}));
jest.mock('@/lib/geo/gymChoice', () => ({ markGymChosen: jest.fn() }));

const mockBuild = jest.fn();
let mockPlanOverride: Record<string, unknown> | null = null;
jest.mock('@/services/suggestedWorkout', () => {
  const actual = jest.requireActual('@/services/suggestedWorkout');
  return {
    ...actual,
    buildSuggestedWorkout: (input: { maxExercises: number; sessionMinutes: number }) => {
      mockBuild(input);
      if (mockPlanOverride) return mockPlanOverride;
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
import { useUserStore } from '@/stores/userStore';
import { resetClock, setClock } from '@/lib/clock';
import type { User } from '@/types/schema';

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockTodayAdhocExists = true;
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

describe('SuggestedWorkoutSheet: beginner mode wording', () => {
  const jargonPlan = {
    focus: 'Today: quads and lats — rested, and furthest behind on this week’s sets.',
    isLightSession: false,
    exercises: [
      { exerciseId: 'ex-1', muscle: 'quads', reason: 'Quads: 2 of 10 weekly sets done', sets: 3, repRange: [8, 12], targetRir: 2 },
      { exerciseId: 'ex-2', muscle: 'lats', reason: 'Lats: 0 of 8 weekly sets done', sets: 3, repRange: [8, 12], targetRir: 2 },
    ],
  };
  const setBeginner = (beginnerMode: boolean) =>
    useUserStore.setState({
      user: { id: 'user-1', experience: 'novice', preferences: { units: 'kg', beginnerMode }, volumeLandmarks: {} } as unknown as User,
    });
  beforeEach(() => {
    mockPlanOverride = jargonPlan;
  });
  afterEach(() => {
    mockPlanOverride = null;
    useUserStore.setState({ user: null });
  });

  it('uses plain muscle names and plain weekly wording instead of weekly sets', async () => {
    setBeginner(true);
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    expect(screen.getByTestId('suggested-workout-focus')).toHaveTextContent(
      'Today: front thighs and back (lats) — rested, and they’ve had the least work this week.'
    );
    const reasons = screen.getAllByTestId('suggested-pick-reason').map((el) => el.textContent);
    expect(reasons).toEqual(['Front thighs: needs more work this week', 'Back (lats): needs more work this week']);
    expect(document.body).not.toHaveTextContent(/weekly sets/);
    // Panel round 18: "behind this week" and "short of failure" read as jargon.
    expect(document.body).not.toHaveTextContent(/behind this week|short of failure/);
  });

  it('keeps the existing wording when beginner mode is off', async () => {
    setBeginner(false);
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    expect(screen.getAllByTestId('suggested-pick-reason')[0]).toHaveTextContent('Quads: 2 of 10 weekly sets done');
  });
});

describe('SuggestedWorkoutSheet: why this order, and when you last did it', () => {
  const NOW = new Date(2026, 10, 23, 9, 0); // Mon, Nov 23 2026, local
  beforeEach(() => {
    setClock({ now: () => new Date(NOW), today: () => '2026-11-23' });
    mockPlanOverride = {
      focus: 'Today: quads and lats — rested, and furthest behind on this week’s sets.',
      isLightSession: false,
      order: 'compounds_first',
      exercises: [
        { exerciseId: 'ex-1', muscle: 'quads', reason: 'Quads: 2 of 10 weekly sets done', sets: 3, repRange: [8, 12], targetRir: 2 },
        { exerciseId: 'ex-2', muscle: 'lats', reason: 'Lats: 0 of 8 weekly sets done', sets: 3, repRange: [8, 12], targetRir: 2 },
      ],
    };
    mockUsage = [
      // Completed on Tue, Nov 17; an abandoned start later doesn't count as "did".
      { exercise_id: 'ex-1', workout_sessions: { started_at: new Date(2026, 10, 17, 18, 0).toISOString(), state: 'completed' } },
      { exercise_id: 'ex-1', workout_sessions: { started_at: new Date(2026, 10, 21, 18, 0).toISOString(), state: 'in_progress' } },
    ];
  });
  afterEach(() => {
    resetClock();
    mockPlanOverride = null;
    mockUsage = [];
  });

  it('says why the list is in this order, from the plan’s own rule', async () => {
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    expect(screen.getByTestId('suggested-workout-order')).toHaveTextContent(
      'Order: big compound lifts first, then smaller ones. Within each, rested muscles furthest behind this week go first.'
    );
  });

  it('a recent lift names the day it was done', async () => {
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    const whys = screen.getAllByTestId('suggested-pick-why').map((el) => el.textContent);
    expect(whys[0]).toBe('You did this on Tue, Nov 17 — weights start from your last sets.');
    expect(whys[1]).toMatch(/^New to you/);
  });
});

describe('SuggestedWorkoutSheet: injury areas and the start wait (round 19)', () => {
  afterEach(() => {
    mockPlanOverride = null;
    mockUsersRow = { weight_kg: null, height_cm: null };
  });

  const injuryPlan = {
    focus: 'Legs and back are recovered and under target.',
    isLightSession: false,
    exercises: [
      {
        exerciseId: 'ex-1',
        muscle: 'quads',
        reason: 'under target',
        sets: 3,
        repRange: [8, 12],
        targetRir: 2,
        injury: { kind: 'instead_of', pickedId: 'ex-1', insteadOfId: 'ex-2' },
      },
      { exerciseId: 'ex-2', muscle: 'lats', reason: 'under target', sets: 3, repRange: [8, 12], targetRir: 2 },
    ],
  };

  it('says plainly how the injury areas shaped the picks, per pick and overall', async () => {
    mockUsersRow = { weight_kg: null, height_cm: null, preferences: { injuryAreas: ['shoulder'] } };
    mockPlanOverride = injuryPlan;
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    await waitFor(() =>
      expect(screen.getByTestId('suggested-workout-injury')).toHaveTextContent(
        'Planned around your shoulder: lifts that strain it are left out — 1 lift swapped for one easier on it.'
      )
    );
    const notes = screen.getAllByTestId('suggested-pick-injury');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('For your shoulder: picked instead of Lat Pulldown');
  });

  it('carries the injury line onto the started block for the workout card', async () => {
    mockUsersRow = { weight_kg: null, height_cm: null, preferences: { injuryAreas: ['shoulder'] } };
    mockPlanOverride = injuryPlan;
    const user = userEvent.setup();
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByTestId('suggested-workout-injury');
    await user.click(screen.getByRole('button', { name: 'Start workout (2 exercises)' }));
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    const rows = mockInsert.mock.calls[0][0] as { suggestion_reason: string }[];
    expect(rows[0].suggestion_reason).toBe('under target · For your shoulder: picked instead of Lat Pulldown');
    expect(rows[1].suggestion_reason).toBe('under target');
  });

  it('says nothing about injuries without injury areas', async () => {
    mockPlanOverride = injuryPlan;
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'Start workout (2 exercises)' });
    expect(screen.queryByTestId('suggested-workout-injury')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggested-pick-injury')).not.toBeInTheDocument();
  });

  it('opens the workout screen before the build when today has no session yet (navigate-first)', async () => {
    mockTodayAdhocExists = false;
    let releaseInsert: (id: string) => void = () => {};
    mockInsertSession.mockImplementationOnce(
      () => new Promise((resolve) => (releaseInsert = resolve as typeof releaseInsert))
    );
    const { hasPendingWorkoutBuild, awaitPendingWorkoutBuild } = jest.requireActual(
      '@/lib/training/pendingWorkoutStart'
    ) as typeof import('@/lib/training/pendingWorkoutStart');
    const user = userEvent.setup();
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Start workout (2 exercises)' }));
    // Navigated with the client-made id while the session insert is still in flight.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/workout/client-id?fromCreate=true'));
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(mockInsertSession).toHaveBeenCalledWith(expect.anything(), 'user-1', 'ai_suggested', 'loc-gym', 'client-id');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(hasPendingWorkoutBuild('client-id')).toBe(true);
    // The blocks wait for the session row, then the workout page's wait ends.
    releaseInsert('client-id');
    await expect(awaitPendingWorkoutBuild('client-id')).resolves.toBeNull();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('shows which step the start is on, then opens the screen once the session exists', async () => {
    let releaseSession: (v: { sessionId: string; isNewSession: boolean }) => void = () => {};
    mockGetOrCreate.mockImplementationOnce(
      () => new Promise((resolve) => (releaseSession = resolve as typeof releaseSession))
    );
    const user = userEvent.setup();
    render(<SuggestedWorkoutSheet isOpen onClose={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Start workout (2 exercises)' }));
    expect(await screen.findByRole('button', { name: 'Checking your plan… (1 of 4)' })).toBeDisabled();
    // A step list with a progress bar under the button, not just a label.
    expect(screen.getByTestId('workout-start-progress')).toHaveAttribute('data-stage', 'preparing');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13');
    releaseSession({ sessionId: 'sess-9', isNewSession: true });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/workout/sess-9?fromCreate=true'));
    expect(screen.getByRole('button', { name: 'Opening workout… (4 of 4)' })).toBeDisabled();
    expect(screen.getByTestId('workout-start-progress')).toHaveAttribute('data-stage', 'opening');
  });
});
