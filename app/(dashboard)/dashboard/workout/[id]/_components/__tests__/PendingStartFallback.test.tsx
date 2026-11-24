/**
 * The route loading boundary right after Start (UX panel round 22: "the page
 * said it was still getting ready after I tapped start, so I had to wait").
 * The boundary shows while the workout screen's code arrives; it now offers
 * Log set on the first exercise, held in the same store the screen replays.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingStartFallback } from '../PendingStartFallback';
import {
  __resetPendingWorkoutBuildsForTests,
  getEarlyLoggedSet,
  setPendingWorkoutPreview,
} from '@/lib/training/pendingWorkoutStart';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'session-1' }),
}));

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/stores/userStore', () => ({
  useUserStore: (select: (s: unknown) => unknown) => select({ user: { preferences: { units: 'kg' } } }),
}));

describe('PendingStartFallback', () => {
  afterEach(() => __resetPendingWorkoutBuildsForTests());

  it('shows the usual skeleton when there is no start preview (reload, deep link)', () => {
    render(<PendingStartFallback fallback={<p>skeleton</p>} />);
    expect(screen.getByText('skeleton')).toBeInTheDocument();
  });

  it('lets set 1 be logged while the workout screen is still loading', async () => {
    setPendingWorkoutPreview('session-1', {
      exercises: [
        {
          exerciseId: 'ex-rdl',
          name: 'Romanian Deadlift',
          targetSets: 3,
          repRange: [8, 12],
          targetRir: 2,
          weightKg: 20,
          loggable: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<PendingStartFallback fallback={<p>skeleton</p>} />);
    expect(screen.queryByText('skeleton')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Set 1 is ready to log');
    await user.click(screen.getAllByRole('button', { name: /^Log set/ })[0]);
    expect(getEarlyLoggedSet('session-1')).toMatchObject({ exerciseId: 'ex-rdl', weightKg: 20, repCount: 8 });
    expect(await screen.findByTestId('preview-set-logged')).toHaveTextContent('Set 1 logged: 20 kg × 8');
  });
});
