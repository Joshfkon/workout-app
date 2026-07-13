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
const DEFAULT_BLOCKS: unknown[] = [
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
let mockBlocks: unknown[] = DEFAULT_BLOCKS;

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
  // Hierarchy expansion persists per user per surface — reset between tests.
  window.localStorage.clear();
  mockBlocks = DEFAULT_BLOCKS;
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

    // Headline counts COARSE groups only: 13 total, quads the sole not-ready.
    expect(screen.getByTestId('muscle-recovery-headline')).toHaveTextContent('12 of 13 ready');
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

  it('aggregates a divergent group conservatively and self-reveals its members', async () => {
    // Side delts maxed 6h ago → Fatigued; front/rear light 5 days ago → Fresh.
    mockBlocks = [
      {
        exercises: { id: 'ex-lat-raise', name: 'Lateral Raise', primary_muscle: 'lateral_delts', secondary_muscles: [] },
        workout_sessions: { id: 's-side', completed_at: hoursAgo(6), user_id: 'u1', state: 'completed' },
        set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `lr${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
      },
      {
        exercises: { id: 'ex-front', name: 'Front Raise', primary_muscle: 'front_delts', secondary_muscles: [] },
        workout_sessions: { id: 's-front', completed_at: hoursAgo(120), user_id: 'u1', state: 'completed' },
        set_logs: Array.from({ length: 4 }, (_, i) => ({ id: `fr${i}`, is_warmup: false, rpe: 8, feedback: { repsInTank: 2 } })),
      },
      {
        exercises: { id: 'ex-rear', name: 'Reverse Fly', primary_muscle: 'rear_delts', secondary_muscles: [] },
        workout_sessions: { id: 's-rear', completed_at: hoursAgo(120), user_id: 'u1', state: 'completed' },
        set_logs: Array.from({ length: 4 }, (_, i) => ({ id: `rf${i}`, is_warmup: false, rpe: 8, feedback: { repsInTank: 2 } })),
      },
    ];

    render(<MuscleRecoveryCard />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('muscle-recovery-card')).toBeInTheDocument());

    // Parent = least-recovered member: Shoulders reads Fatigued, never Fresh.
    await waitFor(() =>
      expect(screen.getByTestId('recovery-status-shoulders')).toHaveTextContent('Fatigued')
    );

    // Divergence (Fresh members under a Fatigued parent) self-reveals the
    // children WITHOUT any tap — each showing its own status/timer.
    expect(screen.getByTestId('recovery-status-lateral_delts')).toHaveTextContent('Fatigued');
    expect(screen.getByTestId('recovery-status-front_delts')).toHaveTextContent('Fresh');
    expect(screen.getByTestId('recovery-status-rear_delts')).toHaveTextContent('Fresh');

    // Headline counts shoulders ONCE (coarse only): 12 of 13 ready.
    expect(screen.getByTestId('muscle-recovery-headline')).toHaveTextContent('12 of 13 ready');
  });
});
