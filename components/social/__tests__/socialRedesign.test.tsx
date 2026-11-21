/**
 * Social screens on the design system: the shared copy-workout sheet (Discover
 * and the Feed used to carry identical hand-rolled modals) and the leaderboard
 * podium, which is a tinted rank number rather than medal emoji.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyWorkoutSheet } from '../sharing/CopyWorkoutSheet';
import { LeaderboardEntry } from '../leaderboards/LeaderboardEntry';
import type { LeaderboardEntryWithProfile, SharedWorkoutWithProfile } from '@/types/social';

const mockCopy = jest.fn();
jest.mock('@/lib/workout-sharing', () => ({
  copySharedWorkout: (...args: unknown[]) => mockCopy(...args),
}));
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const workout = {
  id: 'w1',
  title: 'Push day',
  workout_data: {
    exercises: [{ exercise_name: 'Bench press', sets: 3, rep_range: [6, 10] }],
  },
} as unknown as SharedWorkoutWithProfile;

describe('CopyWorkoutSheet', () => {
  beforeEach(() => mockCopy.mockReset());

  it('stays closed without a workout', () => {
    render(<CopyWorkoutSheet workout={null} onClose={jest.fn()} />);
    expect(screen.queryByText('Copy workout')).not.toBeInTheDocument();
  });

  it('lists the exercises and confirms a copy', async () => {
    mockCopy.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<CopyWorkoutSheet workout={workout} onClose={jest.fn()} />);

    expect(screen.getByText('Bench press')).toBeInTheDocument();
    expect(screen.getByText('3 × 6–10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy to my workouts' }));
    expect(mockCopy).toHaveBeenCalledWith('w1', expect.anything());
    expect(await screen.findByText('Copied to your templates')).toBeInTheDocument();
  });

  it('shows the error and keeps the buttons when the copy fails', async () => {
    mockCopy.mockResolvedValue({ success: false, error: 'Already copied' });
    const user = userEvent.setup();
    render(<CopyWorkoutSheet workout={workout} onClose={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copy to my workouts' }));
    expect(await screen.findByText('Already copied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy to my workouts' })).toBeEnabled();
  });
});

describe('LeaderboardEntry', () => {
  const entry = (rank: number) =>
    ({
      rank,
      score: 12,
      rank_change: 0,
      user_profile: { username: 'sam', display_name: 'Sam', avatar_url: null },
    }) as unknown as LeaderboardEntryWithProfile;

  it('marks the podium with a rank pill, not a medal emoji', () => {
    render(<LeaderboardEntry entry={entry(2)} type="workouts_completed_week" units="kg" />);
    expect(screen.getByLabelText('Rank 2')).toHaveTextContent('2');
    expect(document.body.textContent).not.toMatch(new RegExp('\\p{Extended_Pictographic}', 'u'));
  });

  it('shows a plain number below the podium', () => {
    render(<LeaderboardEntry entry={entry(7)} type="workouts_completed_week" units="kg" />);
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rank 7')).not.toBeInTheDocument();
  });
});
