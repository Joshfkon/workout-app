/**
 * Integration test for the analytics Muscle Recovery card. Drives the REAL
 * unified data path (useDashboardMuscleReadiness → readiness rows → recovery
 * heuristic) with a mocked Supabase history fetch, so the card is verified to
 * render the same model as the in-workout readiness sheet — statuses here are
 * computed by the shared heuristic, not a card-local one.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- Mocks (must precede the component import) ------------------------------

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

// quads maxed 30h ago → Fatigued (84h window); biceps light 40h ago → Fresh
// (36h base window); everything else untrained → "No recent data".
const mockBlocks: unknown[] = [
  {
    exercises: { id: 'ex-squat', name: 'Squat', primary_muscle: 'quads', secondary_muscles: [] },
    workout_sessions: { id: 's1', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
    set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `sl${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
  },
  {
    exercises: { id: 'ex-curl', name: 'Curl', primary_muscle: 'biceps', secondary_muscles: [] },
    workout_sessions: { id: 's2', completed_at: hoursAgo(40), user_id: 'u1', state: 'completed' },
    set_logs: Array.from({ length: 3 }, (_, i) => ({ id: `cl${i}`, is_warmup: false, rpe: 7, feedback: { repsInTank: 3 } })),
  },
];

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: () => makeBuilder({ data: mockBlocks, error: null }),
  }),
}));

jest.mock('@/stores', () => ({
  useUserStore: () => ({ user: { id: 'u1' } }),
}));

jest.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'u1' }, isLoading: false, error: null }),
}));

import { MuscleRecoveryCard } from '../MuscleRecoveryCard';

// --- Helpers ----------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Freeze only Date so the fixtures' relative ages hold on any run date (same
// approach as the readiness sheet test).
const REAL_TIMER_APIS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'nextTick', 'performance',
] as const;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...REAL_TIMER_APIS] });
});

afterEach(() => {
  jest.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe('MuscleRecoveryCard', () => {
  it('renders unified recovery statuses and the body map from the shared model', async () => {
    render(<MuscleRecoveryCard />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('muscle-recovery-card')).toBeInTheDocument());

    // Statuses come from the shared heuristic: maxed quads Fatigued, light
    // biceps Fresh past its 36h window, untrained chest has no estimate.
    expect(screen.getByTestId('recovery-status-quads')).toHaveTextContent('Fatigued');
    expect(screen.getByTestId('recovery-status-biceps')).toHaveTextContent('Fresh');
    expect(screen.getByTestId('recovery-status-chest')).toHaveTextContent('No recent data');

    // The map renders from the same rows.
    expect(screen.getByTestId('muscle-recovery-map')).toBeInTheDocument();

    // Header summarizes the one still-recovering group.
    expect(screen.getByText('1 recovering')).toBeInTheDocument();
  });

  it('sorts recovering muscles first and expands to all coarse groups', async () => {
    const { container } = render(<MuscleRecoveryCard />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('muscle-recovery-card')).toBeInTheDocument());

    const rowMuscles = () =>
      Array.from(container.querySelectorAll('[data-testid^="recovery-row-"]')).map((el) =>
        (el.getAttribute('data-testid') || '').replace('recovery-row-', '')
      );

    // Capped at 6 with the still-recovering quads on top.
    expect(rowMuscles()).toHaveLength(6);
    expect(rowMuscles()[0]).toBe('quads');

    // Expanding reveals all 13 coarse groups.
    await userEvent.click(screen.getByTestId('muscle-recovery-toggle'));
    expect(rowMuscles()).toHaveLength(13);
  });
});
