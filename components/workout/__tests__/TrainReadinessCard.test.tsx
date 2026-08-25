/**
 * Integration test for the Train dashboard's readiness card. Drives the REAL
 * data hook (useDashboardMuscleReadiness → readiness assembly → recovery
 * heuristic) with a mocked Supabase history fetch, so it exercises the same
 * volume + recovery + sort pipeline the in-workout sheet uses — rendered as
 * the Train page's Recovery card (targets strip, body map with the
 * Recovery/Volume paint toggle, capped rows).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- Mocks (must precede the component import) ------------------------------

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

let mockBlocks: unknown[] = [];

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

import { TrainReadinessCard } from '../TrainReadinessCard';

// --- Helpers ----------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Freeze ONLY Date (leave timers real so userEvent/waitFor behave) so the
// fixtures' relative ages hold forever — same rationale as the
// EmptyWorkoutReadiness test.
const REAL_TIMER_APIS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'nextTick', 'performance',
] as const;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...REAL_TIMER_APIS] });
  // Expander/map-mode state persists in sessionStorage across mounts.
  window.sessionStorage.clear();
  mockBlocks = [
    {
      exercises: { id: 'ex-squat', name: 'Squat', primary_muscle: 'quads', secondary_muscles: [] },
      workout_sessions: { id: 's1', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
      set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `sl${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
    },
  ];
});

afterEach(() => {
  jest.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe('TrainReadinessCard', () => {
  it('renders the shared readiness body: targets strip, body map with paint toggle, capped rows', async () => {
    render(<TrainReadinessCard />, { wrapper });

    expect(screen.getByTestId('train-readiness-card')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recovery' })).toBeInTheDocument();

    // Once the mocked history resolves: the body map with its Recovery/Volume
    // paint toggle, and Fatigued quads (trained 30h ago) never a good target.
    await waitFor(() => expect(screen.getByTestId('readiness-map')).toBeInTheDocument());
    expect(screen.getByTestId('readiness-map-mode-recovery')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('readiness-map-mode-volume')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('readiness-targets')).not.toHaveTextContent('Quads');

    // 6 coarse rows visible, the rest behind "+N more" (14 coarse groups total).
    const rowIds = Array.from(document.querySelectorAll('[data-testid^="readiness-row-"]'))
      .map((el) => (el.getAttribute('data-testid') || '').replace('readiness-row-', ''))
      .filter((id) => !id.startsWith('toggle-'));
    expect(rowIds.length).toBe(6);
    expect(screen.getByTestId('readiness-show-more')).toHaveTextContent('+8 more');
  });

  it('switches the map paint to weekly-volume zones on toggle', async () => {
    render(<TrainReadinessCard />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('readiness-map')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-map-mode-volume'));
    expect(screen.getByTestId('readiness-map-mode-volume')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('readiness-map-mode-recovery')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to the long-window heatmap: timeframe chips replace the weekly paint', async () => {
    render(<TrainReadinessCard />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('readiness-map')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-map-mode-heat'));
    expect(screen.getByTestId('readiness-map-mode-heat')).toHaveAttribute('aria-pressed', 'true');

    // The compact heatmap unit mounts with its own timeframe chips (3M is the
    // shared default) and the weekly-paint map unmounts.
    expect(screen.getByTestId('readiness-heatmap')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-heatmap-timeframe-3m')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('readiness-muscle-map')).not.toBeInTheDocument();

    // The mocked client has no auth session, so the fetch resolves to "no
    // data" — the unit must degrade to its empty state, never crash the card.
    await waitFor(() => expect(screen.getByTestId('readiness-heatmap-empty')).toBeInTheDocument());

    // Switching back restores the weekly paint.
    await userEvent.click(screen.getByTestId('readiness-map-mode-recovery'));
    expect(screen.getByTestId('readiness-muscle-map')).toBeInTheDocument();
    expect(screen.queryByTestId('readiness-heatmap')).not.toBeInTheDocument();
  });
});
