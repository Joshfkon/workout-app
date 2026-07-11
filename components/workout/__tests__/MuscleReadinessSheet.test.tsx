/**
 * Integration test for the Muscle Readiness sheet. Drives the REAL data hook
 * (useMuscleReadiness → readiness assembly → recovery heuristic) with a mocked
 * Supabase history fetch and live-session props, so it exercises the full
 * volume + recovery + sort pipeline as rendered in the DOM.
 *
 * Covers the Playwright-level intents that don't need a running app:
 *  - the sheet opens and dismisses,
 *  - logged sets move a muscle's weekly count AND recovery status,
 *  - a Fresh/under-volume muscle sorts above a Fatigued/under-volume one.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- Mocks (must precede the component import) ------------------------------

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

// A completed session 30h ago that hammered quads (8 maxed sets) → Fatigued and
// contributes weekly volume; nothing else trained → other muscles Fresh at 0.
let mockBlocks: unknown[] = [
  {
    exercises: { id: 'ex-squat', name: 'Squat', primary_muscle: 'quads', secondary_muscles: ['glutes'] },
    workout_sessions: { id: 's1', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
    set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `sl${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
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

import { MuscleReadinessSheet } from '../MuscleReadinessSheet';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import type { SetLog } from '@/types/schema';

// --- Helpers ----------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function muscleOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="readiness-row-"]')).map((el) =>
    (el.getAttribute('data-testid') || '').replace('readiness-row-', '')
  );
}

/** A minimal live block whose exercise targets one muscle. */
function liveBlock(id: string, primaryMuscle: string): ExerciseBlockWithExercise {
  return {
    id,
    exercise: { id: `ex-${id}`, name: id, primaryMuscle, secondaryMuscles: [] },
  } as unknown as ExerciseBlockWithExercise;
}

/** A working set logged against a block. */
function liveSet(id: string, blockId: string): SetLog {
  return {
    id,
    exerciseBlockId: blockId,
    isWarmup: false,
    setType: 'normal',
    rpe: 8,
    feedback: { repsInTank: 2, form: 'clean' },
  } as unknown as SetLog;
}

beforeEach(() => {
  // Expander state persists in sessionStorage across mounts — reset per test.
  window.sessionStorage.clear();
  mockBlocks = [
    {
      exercises: { id: 'ex-squat', name: 'Squat', primary_muscle: 'quads', secondary_muscles: ['glutes'] },
      workout_sessions: { id: 's1', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
      set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `sl${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
    },
  ];
});

// --- Tests ------------------------------------------------------------------

describe('MuscleReadinessSheet', () => {
  it('renders rows once history loads and dismisses via the close button', async () => {
    const onClose = jest.fn();
    render(
      <MuscleReadinessSheet isOpen onClose={onClose} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );

    // Sheet is present.
    expect(await screen.findByTestId('readiness-sheet')).toBeInTheDocument();
    // Coarse rows appear after the mocked history resolves (cap shows top 6).
    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    // Reveal all coarse rows (fatigued quads sits below the cap).
    await userEvent.click(screen.getByTestId('readiness-show-more'));
    expect(screen.getByTestId('readiness-row-quads')).toBeInTheDocument();

    // Dismiss.
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ranks a Fresh, under-volume muscle above a Fatigued, under-volume muscle', async () => {
    const { container } = render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );

    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-show-more'));

    // Quads were maxed 30h ago → Fatigued; calves untrained → no recent data.
    // Both under MEV, so the never-trained calves still ranks above quads.
    expect(screen.getByTestId('readiness-badge-quads')).toHaveTextContent('Fatigued');
    expect(screen.getByTestId('readiness-badge-calves')).toHaveTextContent('No recent data');

    const order = muscleOrder(container);
    expect(order.indexOf('calves')).toBeLessThan(order.indexOf('quads'));
  });

  it('reflects live-session sets in both weekly count and recovery status', async () => {
    const block = liveBlock('b-calf', 'calves');

    // First render: no live sets. Calves start at 0 and Fresh.
    const { rerender } = render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[block]} liveSets={[]} />,
      { wrapper }
    );
    await waitFor(() => expect(screen.getByTestId('readiness-row-calves')).toBeInTheDocument());
    expect(screen.getByTestId('readiness-sets-calves')).toHaveTextContent('0');
    // Not yet trained this window → no recovery estimate.
    expect(screen.getByTestId('readiness-badge-calves')).toHaveTextContent('No recent data');

    // Log 3 calf sets in the live session and re-render (as reopening would).
    const sets = [liveSet('a', 'b-calf'), liveSet('b', 'b-calf'), liveSet('c', 'b-calf')];
    rerender(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[block]} liveSets={sets} />
    );

    // Just trained → Fatigued, so calves sinks below the 6-row cap; reveal all.
    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-show-more'));

    await waitFor(() => expect(screen.getByTestId('readiness-sets-calves')).toHaveTextContent('3'));
    expect(screen.getByTestId('readiness-badge-calves')).toHaveTextContent('Fatigued');
  });

  it('surfaces recovered, under-volume muscles in the "good targets" strip', async () => {
    render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );
    const strip = await screen.findByTestId('readiness-targets');
    await waitFor(() => expect(within(strip).queryByText(/./)).toBeTruthy());
    // Fatigued quads must never be recommended as a target.
    expect(strip).not.toHaveTextContent('Quads');
  });

  it('renders every coarse group, caps at 6 with "+N more", and keeps a Fatigued muscle reachable at the bottom', async () => {
    // Glutes hammered ~20h ago (yesterday) → Fatigued; nothing else trained.
    mockBlocks = [
      {
        exercises: { id: 'ex-ht', name: 'Hip Thrust', primary_muscle: 'glutes', secondary_muscles: [] },
        workout_sessions: { id: 's-glutes', completed_at: hoursAgo(20), user_id: 'u1', state: 'completed' },
        set_logs: Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
      },
    ];

    const { container } = render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );

    // Cap: exactly 6 coarse rows visible before expanding, with a "+N more".
    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    expect(container.querySelectorAll('[data-testid^="readiness-row-"]').length).toBe(6);
    // 13 coarse groups total → 7 hidden behind the expander.
    expect(screen.getByTestId('readiness-show-more')).toHaveTextContent('+7 more');

    // Expanding reveals the full list inline.
    await userEvent.click(screen.getByTestId('readiness-show-more'));
    const order = muscleOrder(container);
    expect(order.length).toBe(13);

    // Yesterday's glutes did NOT vanish — present, Fatigued, and last in the sort.
    expect(screen.getByTestId('readiness-badge-glutes')).toHaveTextContent('Fatigued');
    expect(order[order.length - 1]).toBe('glutes');

    // A never-trained coarse group shows the no-data state, not a recovery estimate.
    expect(screen.getByTestId('readiness-badge-chest')).toHaveTextContent('No recent data');
  });

  it('remembers the expanded state across re-mounts within the session', async () => {
    const { unmount } = render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );
    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-show-more'));
    expect(screen.getByTestId('readiness-show-less')).toBeInTheDocument();
    unmount();

    // Re-open (a fresh lazy mount) → still expanded, no "+N more" to re-tap.
    render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );
    await waitFor(() => expect(screen.getByTestId('readiness-show-less')).toBeInTheDocument());
    expect(screen.queryByTestId('readiness-show-more')).not.toBeInTheDocument();
  });
});
