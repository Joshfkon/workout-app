/**
 * Integration test for the empty-workout inline readiness placement. Drives the
 * REAL data hook (useMuscleReadiness → readiness assembly → recovery heuristic)
 * with a mocked Supabase history fetch, so it exercises the same volume +
 * recovery + sort pipeline the sheet uses — but rendered inline, with the
 * Quick Add chips re-ordered by readiness score.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- Mocks (must precede the component import) ------------------------------

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

// A completed session 30h ago that maxed quads → Fatigued (score 0); nothing
// else trained → other muscles Fresh at 0 sets (high, under-volume score).
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

import { EmptyWorkoutReadiness } from '../EmptyWorkoutReadiness';
import type { AvailableExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';

// --- Helpers ----------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function chip(id: string, name: string, primaryMuscle: string): AvailableExercise {
  return {
    id,
    name,
    primary_muscle: primaryMuscle,
    mechanic: 'compound',
  } as AvailableExercise;
}

function chipOrder(): string[] {
  return Array.from(document.querySelectorAll('button'))
    .map((b) => b.textContent || '')
    .filter((t) => t.startsWith('+ '))
    .map((t) => t.replace('+ ', ''));
}

beforeEach(() => {
  mockBlocks = [
    {
      exercises: { id: 'ex-squat', name: 'Squat', primary_muscle: 'quads', secondary_muscles: [] },
      workout_sessions: { id: 's1', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
      set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `sl${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
    },
  ];
});

// --- Tests ------------------------------------------------------------------

describe('EmptyWorkoutReadiness', () => {
  it('renders the readiness body inline (targets strip + rows)', async () => {
    render(
      <EmptyWorkoutReadiness quickAddExercises={[]} onAddExercise={jest.fn()} />,
      { wrapper }
    );

    expect(screen.getByTestId('readiness-inline')).toBeInTheDocument();
    // Rows appear once the mocked history resolves; a Fresh/under-volume muscle
    // is surfaced as a good target, and Fatigued quads never is.
    await waitFor(() => expect(screen.getByTestId('readiness-targets')).not.toHaveTextContent('Quads'));
    expect(screen.getByTestId('readiness-targets').textContent).toBeTruthy();
  });

  it('trims the inline rows to the top 5', async () => {
    render(
      <EmptyWorkoutReadiness quickAddExercises={[]} onAddExercise={jest.fn()} />,
      { wrapper }
    );
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="readiness-row-"]').length).toBe(5)
    );
  });

  it('re-orders Quick Add chips by readiness (recovered + under-volume first)', async () => {
    const chips = [
      chip('ex-squat', 'Squat', 'quads'), // Fatigued → score 0, given first (most frequent)
      chip('ex-raise', 'Calf Raise', 'calves'), // Fresh + under MEV → high score
    ];

    render(
      <EmptyWorkoutReadiness quickAddExercises={chips} onAddExercise={jest.fn()} />,
      { wrapper }
    );

    // Before history resolves the score is 0 for all → original order holds.
    // After it resolves, the recovered/under-volume calf chip jumps ahead.
    await waitFor(() => {
      const order = chipOrder();
      expect(order.indexOf('Calf Raise')).toBeLessThan(order.indexOf('Squat'));
    });
  });

  it('adds an exercise when its chip is tapped', async () => {
    const onAdd = jest.fn();
    render(
      <EmptyWorkoutReadiness
        quickAddExercises={[chip('ex-raise', 'Calf Raise', 'calves')]}
        onAddExercise={onAdd}
      />,
      { wrapper }
    );

    await userEvent.click(await screen.findByRole('button', { name: '+ Calf Raise' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex-raise' }));
  });
});
