/**
 * Empty-state auth gate on the History page (the reported bug's poster child):
 *
 *  - expired/invalid session → the RE-AUTH state renders, NEVER
 *    "No workout history yet" (RLS silently returns zero rows on a dead
 *    token, and [] used to be committed as truth)
 *  - live session + genuinely zero sessions → the real empty state
 *  - live session + data → the workout list
 */
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query/queryClient';
import HistoryPage from '../page';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: { units: 'kg' } }),
}));

// Scripted Supabase client: auth surface + a thenable query chain so any
// .select().eq()...range() sequence resolves to the scripted result.
let mockAuth: {
  session: unknown | null;
  user: { id: string } | null;
  userError: { status?: number; name?: string } | null;
};
let mockQueryResult: { data: unknown[] | null; error: { code?: string; message?: string } | null };

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'lt', 'order', 'range', 'limit']) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown
  ) => Promise.resolve(mockQueryResult).then(resolve, reject);
  return chain;
}

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: mockAuth.session } }),
      getUser: async () => ({ data: { user: mockAuth.user }, error: mockAuth.userError }),
    },
    from: () => makeChain(),
  }),
  createClient: () => ({}),
}));

function renderHistory() {
  // Fresh client per test — the app's own defaults (incl. the no-retry rule
  // for SessionExpiredError) are part of what's under test.
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <HistoryPage />
    </QueryClientProvider>
  );
}

describe('History page auth gate', () => {
  it('shows the re-auth prompt — NOT "No workout history yet" — on an expired session', async () => {
    // Local token still stored, but the auth server rejects it; the data
    // query "succeeds" with zero rows (the silent-RLS failure mode).
    mockAuth = {
      session: { user: { id: 'user-1' } },
      user: null,
      userError: { status: 401 },
    };
    mockQueryResult = { data: [], error: null };

    renderHistory();

    expect(await screen.findByTestId('session-expired')).toBeInTheDocument();
    expect(screen.queryByText(/no workout history yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in again/i })).toBeInTheDocument();
  });

  it('shows a retry state — not a logout, not emptiness — when the session cannot be verified', async () => {
    mockAuth = {
      session: { user: { id: 'user-1' } },
      user: null,
      userError: { name: 'AuthRetryableFetchError', status: 0 },
    };
    mockQueryResult = { data: [], error: null };

    renderHistory();

    // SessionVerifyError is retryable, so React Query re-attempts once
    // (~1s backoff) before settling into the error state.
    expect(await screen.findByTestId('error-retry', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/no workout history yet/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-expired')).not.toBeInTheDocument();
  });

  it('shows the genuine empty state for a verified-live session with zero workouts', async () => {
    mockAuth = {
      session: { user: { id: 'user-1' } },
      user: { id: 'user-1' },
      userError: null,
    };
    mockQueryResult = { data: [], error: null };

    renderHistory();

    expect(await screen.findByText(/no workout history yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('session-expired')).not.toBeInTheDocument();
  });

  it('renders workout data for a live session (restored session → data, no reinstall)', async () => {
    mockAuth = {
      session: { user: { id: 'user-1' } },
      user: { id: 'user-1' },
      userError: null,
    };
    mockQueryResult = {
      data: [
        {
          id: 'w1',
          planned_date: '2026-07-10',
          completed_at: '2026-07-10T18:00:00Z',
          state: 'completed',
          session_rpe: 7,
          session_notes: null,
          pump_rating: null,
          is_deload: false,
          exercise_blocks: [],
        },
      ],
      error: null,
    };

    renderHistory();

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText(/no workout history yet/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-expired')).not.toBeInTheDocument();
  });
});
