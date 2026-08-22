/**
 * Integration test for the Muscle Readiness sheet. Drives the REAL data hook
 * (useMuscleReadiness → readiness assembly → recovery heuristic) with a mocked
 * Supabase history fetch and live-session props, so it exercises the full
 * volume + recovery + sort pipeline as rendered in the DOM.
 *
 * Covers the Playwright-level intents that don't need a running app:
 *  - the sheet opens and dismisses,
 *  - logged sets move a muscle's weekly count but NOT its recovery status,
 *  - a Fresh/under-volume muscle sorts above a Fatigued/under-volume one.
 */

import { render, screen, waitFor } from '@testing-library/react';
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

/** Row testids only — the expansion toggles share the prefix (`readiness-row-toggle-*`). */
function muscleRows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="readiness-row-"]'))
    .map((el) => (el.getAttribute('data-testid') || '').replace('readiness-row-', ''))
    .filter((id) => !id.startsWith('toggle-'));
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

// The recovery heuristic reads the REAL clock to age each session, but the
// fixtures pin "30h ago" to a fixed NOW — so without freezing the clock these
// tests rot (a session dated 2026-07-10 reads as days old on any later run,
// flipping Fatigued → Recovering). Fake ONLY Date (leave timers real so
// userEvent/waitFor behave) so the fixtures' relative ages hold forever.
const REAL_TIMER_APIS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'nextTick', 'performance',
] as const;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...REAL_TIMER_APIS] });
  // Expander state persists in sessionStorage across mounts, and hierarchy
  // expansion persists in localStorage per user per surface — reset per test.
  window.sessionStorage.clear();
  window.localStorage.clear();
  mockBlocks = [
    {
      exercises: { id: 'ex-squat', name: 'Squat', primary_muscle: 'quads', secondary_muscles: ['glutes'] },
      workout_sessions: { id: 's1', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
      set_logs: Array.from({ length: 8 }, (_, i) => ({ id: `sl${i}`, is_warmup: false, rpe: 10, feedback: { repsInTank: 0 } })),
    },
  ];
});

afterEach(() => {
  jest.useRealTimers();
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

    const order = muscleRows(container);
    expect(order.indexOf('calves')).toBeLessThan(order.indexOf('quads'));
  });

  it('reflects live-session sets in the weekly count but NOT in recovery status', async () => {
    const block = liveBlock('b-calf', 'calves');

    // First render: no live sets. Calves start at 0 and untrained.
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

    // Reveal every row so the assertions don't depend on where calves ranks.
    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-show-more'));

    // Weekly volume counts the live sets straight away…
    await waitFor(() => expect(screen.getByTestId('readiness-sets-calves')).toHaveTextContent('3'));
    // …while recovery keeps reading off completed sessions only: the workout is
    // still in progress, so calves has not started owing recovery yet. It does
    // once the session is finished and lands in the history feed.
    expect(screen.getByTestId('readiness-badge-calves')).toHaveTextContent('No recent data');
  });

  it('surfaces recovered, under-volume muscles in the "good targets" strip', async () => {
    render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );
    const strip = await screen.findByTestId('readiness-targets');
    await waitFor(() => expect(strip.textContent?.trim()).toBeTruthy());
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
    // 14 coarse groups total → 8 hidden behind the expander.
    expect(screen.getByTestId('readiness-show-more')).toHaveTextContent('+8 more');

    // Expanding reveals the full list inline.
    await userEvent.click(screen.getByTestId('readiness-show-more'));
    const order = muscleRows(container);
    expect(order.length).toBe(14);

    // Yesterday's glutes did NOT vanish — present, Fatigued, and last in the sort.
    expect(screen.getByTestId('readiness-badge-glutes')).toHaveTextContent('Fatigued');
    expect(order[order.length - 1]).toBe('glutes');

    // A never-trained coarse group shows the no-data state, not a recovery estimate.
    expect(screen.getByTestId('readiness-badge-chest')).toHaveTextContent('No recent data');
  });

  it('tapping a muscle row reveals which exercises\' sets are counted (coarse row and fine child)', async () => {
    // Incline Press (chest_upper primary) 5 working sets, 30h ago; the default
    // Squat block stays so quads also has drill-down data.
    mockBlocks = [
      ...mockBlocks,
      {
        exercises: { id: 'ex-inc', name: 'Incline Press', primary_muscle: 'chest_upper', secondary_muscles: [] },
        workout_sessions: { id: 's2', completed_at: hoursAgo(30), user_id: 'u1', state: 'completed' },
        set_logs: Array.from({ length: 5 }, (_, i) => ({ id: `ip${i}`, is_warmup: false, rpe: 8, feedback: { repsInTank: 2 } })),
      },
    ];

    render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );

    // Reveal all rows (trained muscles sink toward the bottom of the sort).
    await waitFor(() => expect(screen.getByTestId('readiness-show-more')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('readiness-show-more'));

    // Sources stay hidden until the row is expanded.
    expect(screen.queryByTestId('readiness-sources-chest')).not.toBeInTheDocument();

    // Tap the chest row → its counted-sets breakdown names the exercise.
    await userEvent.click(screen.getByTestId('readiness-row-toggle-chest'));
    const chestPanel = screen.getByTestId('readiness-sources-chest');
    expect(chestPanel).toHaveTextContent('Incline Press');
    expect(chestPanel).toHaveTextContent('5 sets');

    // The same expansion revealed the chest_upper fine child; tapping it shows
    // the child's own share.
    await userEvent.click(screen.getByTestId('readiness-sources-toggle-chest_upper'));
    const childPanel = screen.getByTestId('readiness-sources-chest_upper');
    expect(childPanel).toHaveTextContent('Incline Press');
    expect(childPanel).toHaveTextContent('5 sets');

    // Quads has no fine children, but the drill-down still gives its row a
    // toggle — including the ½-credit secondary explanation for glutes' share.
    await userEvent.click(screen.getByTestId('readiness-row-toggle-quads'));
    const quadsPanel = screen.getByTestId('readiness-sources-quads');
    expect(quadsPanel).toHaveTextContent('Squat');
    expect(quadsPanel).toHaveTextContent('8 sets');
  });

  it('toggles the body map between recovery and volume painting, remembered per session', async () => {
    const { container, unmount } = render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );
    await waitFor(() => expect(screen.getByTestId('readiness-map')).toBeInTheDocument());

    const quadsPath = () =>
      container.querySelector('[data-testid="readiness-muscle-map"] path[data-muscle="quads"]');

    // Default: recovery paint. Quads were maxed 30h ago → Fatigued gray, even
    // though their weekly volume is on target.
    expect(screen.getByTestId('readiness-map-mode-recovery')).toHaveAttribute('aria-pressed', 'true');
    expect(quadsPath()!.getAttribute('class')).toContain('fill-surface-600');

    // Toggle to volume → quads paint by their weekly-volume zone instead.
    await userEvent.click(screen.getByTestId('readiness-map-mode-volume'));
    expect(screen.getByTestId('readiness-map-mode-volume')).toHaveAttribute('aria-pressed', 'true');
    expect(quadsPath()!.getAttribute('class')).toMatch(/fill-(success|warning|danger)-500/);
    unmount();

    // Re-open (a fresh lazy mount) → still in volume mode.
    render(
      <MuscleReadinessSheet isOpen onClose={jest.fn()} liveBlocks={[]} liveSets={[]} />,
      { wrapper }
    );
    await waitFor(() => expect(screen.getByTestId('readiness-map')).toBeInTheDocument());
    expect(screen.getByTestId('readiness-map-mode-volume')).toHaveAttribute('aria-pressed', 'true');
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
