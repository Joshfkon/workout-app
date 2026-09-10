/**
 * Regression test for GitHub issue #393: Discard from the resume pill must
 * cancel the DB session, not just clear local state.
 *
 * Before the fix: discarding only called endSession() (Zustand-local), leaving
 * the workout_sessions row in_progress. Next "Blank workout" reclaimed that
 * session via getOrCreateTodaySession, bringing back the old sets.
 *
 * After the fix: discard calls the server action to cancel the DB session
 * before clearing local state.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResumeWorkoutBanner } from '../ResumeWorkoutBanner';
import { discardWorkoutSession } from '@/lib/actions/workout-session';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/dashboard',
}));

// Mock the server action
jest.mock('@/lib/actions/workout-session', () => ({
  discardWorkoutSession: jest.fn(),
}));

const mockDiscardWorkoutSession = discardWorkoutSession as jest.MockedFunction<
  typeof discardWorkoutSession
>;

const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10m ago

const mockEndSession = jest.fn();

const storeState = {
  activeSession: {
    id: 'session-abc',
    mesocycleId: null,
    startedAt,
  },
  exerciseBlocks: [
    { id: 'block-1', exerciseId: 'ex-1', targetSets: 3 },
    { id: 'block-2', exerciseId: 'ex-2', targetSets: 3 },
  ],
  exercises: {
    'ex-1': { primaryMuscle: 'chest' },
    'ex-2': { primaryMuscle: 'triceps' },
  },
  setLogs: {
    'block-1': [{ id: 'set-1', reps: 10, weightKg: 60 }],
  },
  endSession: mockEndSession,
};

jest.mock('@/stores/workoutStore', () => ({
  useWorkoutStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

describe('ResumeWorkoutBanner discard (issue #393)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscardWorkoutSession.mockResolvedValue({ ok: true });
  });

  it('calls the server action to cancel the DB session before clearing local state', async () => {
    const user = userEvent.setup();
    render(<ResumeWorkoutBanner />);

    // Click "Discard" to open the confirmation modal
    const discardButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(discardButton);

    // Confirm the discard in the modal
    const confirmButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(confirmButton);

    // Verify the server action was called with correct parameters
    await waitFor(() => {
      expect(mockDiscardWorkoutSession).toHaveBeenCalledWith(
        'session-abc',
        null, // mesocycleId
        ['block-1', 'block-2'] // blockIds
      );
    });

    // Verify local state is cleared AFTER successful DB cancellation
    await waitFor(() => {
      expect(mockEndSession).toHaveBeenCalled();
    });
  });

  it('does NOT clear local state if the server action fails', async () => {
    const user = userEvent.setup();
    mockDiscardWorkoutSession.mockResolvedValue({
      ok: false,
      errors: ['Database error'],
    });

    render(<ResumeWorkoutBanner />);

    const discardButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(discardButton);

    const confirmButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(confirmButton);

    // Server action was called
    await waitFor(() => {
      expect(mockDiscardWorkoutSession).toHaveBeenCalled();
    });

    // But local state was NOT cleared
    expect(mockEndSession).not.toHaveBeenCalled();

    // Error message is shown
    expect(screen.getByText(/Failed to discard workout/i)).toBeInTheDocument();
  });

  it('shows a loading state while discarding', async () => {
    const user = userEvent.setup();
    // Make the action take a while
    mockDiscardWorkoutSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 100);
        })
    );

    render(<ResumeWorkoutBanner />);

    const discardButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(discardButton);

    const confirmButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(confirmButton);

    // Button shows loading state
    expect(screen.getByRole('button', { name: 'Discarding...' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discarding...' })).toBeDisabled();

    // Wait for completion
    await waitFor(() => {
      expect(mockEndSession).toHaveBeenCalled();
    });
  });

  it('passes mesocycleId when the session is part of a mesocycle', async () => {
    const user = userEvent.setup();
    
    // Override the store state for this test
    const mesocycleStoreState = {
      ...storeState,
      activeSession: {
        ...storeState.activeSession,
        mesocycleId: 'meso-123',
      },
    };

    jest.doMock('@/stores/workoutStore', () => ({
      useWorkoutStore: (selector: (state: unknown) => unknown) =>
        selector(mesocycleStoreState),
    }));

    const { ResumeWorkoutBanner: ReloadedBanner } = await import('../ResumeWorkoutBanner');
    render(<ReloadedBanner />);

    const discardButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(discardButton);

    const confirmButton = screen.getByRole('button', { name: 'Discard' });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockDiscardWorkoutSession).toHaveBeenCalledWith(
        'session-abc',
        'meso-123', // mesocycleId is passed
        ['block-1', 'block-2']
      );
    });
  });
});
