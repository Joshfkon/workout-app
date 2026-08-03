/**
 * Regression: a workout opened hours ago with no sets logged used to take over
 * the screen with a modal "Resume workout? / Discard / Resume" the moment Home
 * loaded — an interrupt the user had to answer before touching anything else.
 *
 * A forgotten session is not urgent. It stays in the same passive bottom pill
 * every other in-progress workout uses; only the styling and copy change so it
 * doesn't pretend to be live.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResumeWorkoutBanner } from '../ResumeWorkoutBanner';
import { resetOverlayRegistry } from '@/lib/ui/overlayRegistry';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/dashboard',
}));

// The wild repro: started 11h ago, zero sets logged.
const startedAt = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString();

const storeState = {
  activeSession: { id: 'session-1', startedAt },
  exerciseBlocks: [{ id: 'block-1', exerciseId: 'ex-1', targetSets: 18 }],
  exercises: { 'ex-1': { primaryMuscle: 'chest' } },
  setLogs: {},
  endSession: jest.fn(),
};

jest.mock('@/stores/workoutStore', () => ({
  useWorkoutStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

describe('ResumeWorkoutBanner with a stale, empty session', () => {
  afterEach(() => {
    resetOverlayRegistry();
    storeState.endSession.mockClear();
  });

  it('shows the passive pill, not a blocking resume-or-discard prompt', () => {
    render(<ResumeWorkoutBanner />);

    expect(screen.getByRole('button', { name: 'Resume workout' })).toBeInTheDocument();
    expect(screen.queryByText('Resume workout?')).not.toBeInTheDocument();
    expect(screen.queryByText(/never logged a set/i)).not.toBeInTheDocument();
  });

  it('labels it as not started rather than showing a live set tally', () => {
    render(<ResumeWorkoutBanner />);

    expect(screen.getByText(/Not started/)).toBeInTheDocument();
    expect(screen.queryByText(/0\/18 sets/)).not.toBeInTheDocument();
  });

  it('discards only when the user asks and confirms', async () => {
    const user = userEvent.setup();
    render(<ResumeWorkoutBanner />);

    expect(storeState.endSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    // Confirmation modal opens; the pill's own Discard is still mounted, so
    // target the confirm button inside the modal.
    expect(screen.getByText('Discard Workout?')).toBeInTheDocument();
    const discardButtons = screen.getAllByRole('button', { name: 'Discard' });
    await user.click(discardButtons[discardButtons.length - 1]);

    expect(storeState.endSession).toHaveBeenCalled();
  });
});
