/**
 * The empty workout page: an empty session renders the normal workout page
 * with EmptyWorkoutStart in the exercise-list slot (Add exercise first, then
 * "Fresh today" chips and two rows — Muscle readiness · Sets this week — that
 * open the full readiness sheet), the opt-in plan builder's "Build manually"
 * returns there, and the first added exercise replaces it with the list.
 *
 * The workout page itself is too large to mount in a unit test, so `Body`
 * below mirrors its switch: the same `resolveWorkoutBodyView` decision, the
 * REAL EmptyWorkoutStart + EmptyWorkoutReadiness (and so the real readiness
 * hook and assembly) and the REAL WorkoutSetupFlow, with only Supabase mocked.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

// --- Mocks (must precede the component imports) -----------------------------

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

let mockTables: Record<string, unknown[]> = {};

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
        return () => builder;
      },
    }
  );
  return builder;
}

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: (table: string) => makeBuilder({ data: mockTables[table] ?? [], error: null }),
  }),
  createClient: () => ({
    from: (table: string) => makeBuilder({ data: mockTables[table] ?? [], error: null }),
  }),
}));
jest.mock('@/stores', () => ({ useUserStore: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/actions/workoutPlanReview', () => ({
  reviewWorkoutPlan: jest.fn(async () => ({ ok: false, error: 'not in tests' })),
}));
jest.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'u1' }, isLoading: false, error: null }),
}));

import { EmptyWorkoutStart } from '../EmptyWorkoutStart';
import { EmptyWorkoutReadiness } from '@/components/workout/EmptyWorkoutReadiness';
import { WorkoutSetupFlow } from '@/components/workout/setup/WorkoutSetupFlow';
import { resolveWorkoutBodyView, type EmptySetupMode } from '../../_lib/emptyWorkoutView';
import type { AvailableExercise } from '../../_lib/types';

// --- Fixtures ---------------------------------------------------------------

// Quads maxed 30h ago (Fatigued, 8 sets this week); calves trained lightly
// ~3 weeks ago (Fresh, well under MEV).
const historyBlock = (id: string, primary: string, sets: number, hours: number, rpe: number) => ({
  exercises: { id, name: id, primary_muscle: primary, secondary_muscles: [], stabilizers: [], is_custom: true },
  workout_sessions: { id: `s-${id}`, completed_at: hoursAgo(hours), user_id: 'u1', state: 'completed' },
  set_logs: Array.from({ length: sets }, (_, i) => ({
    id: `${id}${i}`,
    is_warmup: false,
    rpe,
    feedback: { repsInTank: 10 - rpe },
  })),
});

const chip = (id: string, name: string, primaryMuscle: string) =>
  ({ id, name, primary_muscle: primaryMuscle, mechanic: 'compound' } as AvailableExercise);

const QUICK_ADD = [chip('ex-raise', 'Calf Raise', 'calves')];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Freeze Date only (the recovery heuristic ages sessions off the real clock);
// timers stay real so userEvent/waitFor behave.
const REAL_TIMER_APIS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'cancelIdleCallback', 'hrtime', 'nextTick', 'performance',
] as const;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...REAL_TIMER_APIS] });
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockTables = {
    exercise_blocks: [
      historyBlock('squat', 'quads', 8, 30, 10),
      historyBlock('raise', 'calves', 2, 24 * 20, 8),
    ],
    exercises: [],
    workout_sessions: [],
  };
});
afterEach(() => jest.useRealTimers());

/** Mirrors the workout page's body switch (see file header). */
function Body({ initialMode = 'manual' as EmptySetupMode }) {
  const [blocks, setBlocks] = useState<AvailableExercise[]>([]);
  const [mode, setMode] = useState<EmptySetupMode>(initialMode);
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = resolveWorkoutBodyView(blocks.length, mode);
  const addExercise = (ex: AvailableExercise) => setBlocks((b) => [...b, ex]);

  if (view === 'plan-setup') {
    return (
      <WorkoutSetupFlow
        sessionId="current"
        unavailableEquipmentIds={[]}
        unavailableExerciseIds={[]}
        usageCounts={new Map()}
        onBuildManually={() => setMode('manual')}
        onRequestAddToPlan={jest.fn()}
        onStart={jest.fn(async () => ({ ok: true }))}
      />
    );
  }

  return (
    <div data-testid="workout-page">
      {view === 'empty' && (
        <EmptyWorkoutStart
          onAddExercise={() => addExercise(chip('ex-bench', 'Bench Press', 'chest'))}
          onCopyLastWorkout={jest.fn()}
          isCopyingLastWorkout={false}
          onBuildPlan={() => setMode('plan')}
          readiness={
            <EmptyWorkoutReadiness
              quickAddExercises={QUICK_ADD}
              onAddExercise={addExercise}
              onOpenDetail={() => setSheetOpen(true)}
            />
          }
        />
      )}
      {sheetOpen && <div data-testid="readiness-sheet-open" />}
      <ul data-testid="exercise-list">
        {blocks.map((b) => (
          <li key={b.id}>{b.name}</li>
        ))}
      </ul>
    </div>
  );
}

// --- Tests ------------------------------------------------------------------

describe('resolveWorkoutBodyView', () => {
  it('shows the empty workout page by default, the plan builder only on request', () => {
    expect(resolveWorkoutBodyView(0, 'manual')).toBe('empty');
    expect(resolveWorkoutBodyView(0, 'plan')).toBe('plan-setup');
  });

  it('shows the exercise list once a block exists, whatever the setup mode', () => {
    expect(resolveWorkoutBodyView(1, 'manual')).toBe('exercises');
    expect(resolveWorkoutBodyView(3, 'plan')).toBe('exercises');
  });
});

describe('empty workout page', () => {
  it('leads with Add exercise and summarises readiness and weekly sets in two rows', async () => {
    render(<Body />, { wrapper });

    expect(screen.getByTestId('empty-workout-start')).toBeInTheDocument();
    expect(screen.getByTestId('empty-add-exercises')).toHaveTextContent('Add exercise');
    expect(screen.getByTestId('empty-copy-last')).toHaveTextContent('Repeat last workout');

    // Counts come straight from history (quads fatigued, chest no data, calves behind).
    const readinessRow = await screen.findByRole('button', { name: /Muscle readiness/ });
    await waitFor(() => expect(readinessRow).toHaveTextContent(/recovering/));
    expect(readinessRow).toHaveTextContent(/fresh/);
    expect(readinessRow).toHaveTextContent(/no data/);
    expect(screen.getByRole('button', { name: /Sets this week/ })).toHaveTextContent(/under the weekly minimum/);

    // The 14-muscle body isn't on the page until asked for.
    expect(screen.queryByTestId('readiness-sets-quads')).not.toBeInTheDocument();
  });

  it('opens the full readiness sheet from either row', async () => {
    render(<Body />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: /Sets this week/ }));
    expect(screen.getByTestId('readiness-sheet-open')).toBeInTheDocument();
  });

  it('gives way to the exercise list once an exercise is added (Add exercise)', async () => {
    render(<Body />, { wrapper });
    await userEvent.click(screen.getByTestId('empty-add-exercises'));

    expect(screen.queryByTestId('empty-workout-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('readiness-rows')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('exercise-list')).getByText('Bench Press')).toBeInTheDocument();
  });

  it('gives way to the exercise list once an exercise is added (Quick Add chip)', async () => {
    render(<Body />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Calf Raise' }));

    expect(screen.queryByTestId('empty-workout-start')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('exercise-list')).getByText('Calf Raise')).toBeInTheDocument();
  });

  it('"Build manually" in the plan builder lands on the empty workout page', async () => {
    render(<Body />, { wrapper });

    await userEvent.click(screen.getByTestId('empty-build-plan'));
    expect(await screen.findByTestId('setup-target-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('workout-page')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('setup-build-manually'));

    // Back on the workout page: no exercises, the empty state, no picker opened.
    expect(screen.getByTestId('workout-page')).toBeInTheDocument();
    expect(screen.getByTestId('empty-workout-start')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-target-picker')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('exercise-list')).queryAllByRole('listitem')).toHaveLength(0);
  });
});
