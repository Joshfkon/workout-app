/**
 * Integration test for the setup flow: the REAL readiness hook, draft
 * builder, projection and edit path, with only Supabase mocked. Covers the
 * acceptance path (defaults → Build plan → Start in ≤3 taps, no network on
 * the build path), live footer updates, swap, and the offline Start guard.
 */

import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

// Per-table fixtures. exercise_blocks feeds the readiness history (7-day and
// 28-day lookback); exercises feeds the setup catalog.
let mockTables: Record<string, unknown[]> = {};
let fromCalls: string[] = [];

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
    from: (table: string) => {
      fromCalls.push(table);
      return makeBuilder({ data: mockTables[table] ?? [], error: null });
    },
  }),
  createClient: () => ({
    from: (table: string) => makeBuilder({ data: mockTables[table] ?? [], error: null }),
  }),
}));
jest.mock('@/stores', () => ({ useUserStore: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'u1' }, isLoading: false, error: null }),
}));

import { WorkoutSetupFlow, type StartPlanPayload } from '../WorkoutSetupFlow';

const catalogRow = (
  id: string,
  name: string,
  primary: string,
  mechanic: 'compound' | 'isolation',
  extra: Record<string, unknown> = {}
) => ({
  id,
  name,
  primary_muscle: primary,
  secondary_muscles: [],
  mechanic,
  movement_pattern: `${id}_pattern`,
  equipment_required: ['dumbbells'],
  equipment_class: null,
  is_bodyweight: false,
  hypertrophy_tier: 'A',
  default_rep_range: mechanic === 'compound' ? [6, 10] : [10, 15],
  default_rir: 2,
  stabilizers: [],
  is_custom: true,
  exercise_type: null,
  ...extra,
});

const CATALOG = [
  catalogRow('bench', 'Bench Press', 'chest', 'compound', { secondary_muscles: ['triceps'] }),
  catalogRow('fly', 'Cable Fly', 'chest', 'isolation'),
  catalogRow('incline', 'Incline Press', 'chest_upper', 'compound'),
  catalogRow('row', 'Chest Supported Row', 'back', 'compound'),
  catalogRow('pulldown', 'Lat Pulldown', 'lats', 'compound'),
  catalogRow('curl', 'Curl', 'biceps', 'isolation'),
  catalogRow('wrist', 'Wrist Curl', 'forearms', 'isolation'),
];

// Chest + back trained 4 days ago (Fresh, under MEV → Good Targets); forearms
// never trained (unknown — must not be pre-selected).
const historyBlock = (id: string, primary: string, sets: number) => ({
  exercises: { id, name: id, primary_muscle: primary, secondary_muscles: [], stabilizers: [], is_custom: true },
  workout_sessions: { id: 's-old', completed_at: hoursAgo(96), user_id: 'u1', state: 'completed' },
  set_logs: Array.from({ length: sets }, (_, i) => ({ id: `${id}${i}`, is_warmup: false, rpe: 8, feedback: { repsInTank: 2 } })),
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const REAL_TIMER_APIS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'cancelIdleCallback', 'hrtime', 'nextTick', 'performance',
] as const;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...REAL_TIMER_APIS] });
  window.localStorage.clear();
  fromCalls = [];
  mockTables = {
    exercise_blocks: [historyBlock('bench', 'chest', 3), historyBlock('row', 'back', 3)],
    exercises: CATALOG,
    workout_sessions: [],
  };
});
afterEach(() => jest.useRealTimers());

function renderFlow(overrides: Partial<React.ComponentProps<typeof WorkoutSetupFlow>> = {}) {
  const onStart = jest.fn(async (_p: StartPlanPayload) => ({ ok: true }));
  const utils = render(
    <WorkoutSetupFlow
      sessionId="current"
      unavailableEquipmentIds={[]}
      unavailableExerciseIds={[]}
      usageCounts={new Map()}
      onBuildManually={jest.fn()}
      onRequestAddToPlan={jest.fn()}
      onStart={onStart}
      {...overrides}
    />,
    { wrapper }
  );
  return { ...utils, onStart };
}

async function waitForPreselection() {
  await waitFor(() =>
    expect(screen.getByTestId('setup-chip-chest')).toHaveAttribute('aria-pressed', 'true')
  );
}

describe('WorkoutSetupFlow', () => {
  it('pre-selects Good Targets and never a zero-history group', async () => {
    renderFlow();
    await waitForPreselection();
    expect(screen.getByTestId('setup-chip-back')).toHaveAttribute('aria-pressed', 'true');
    const forearms = screen.getByTestId('setup-chip-forearms');
    expect(forearms).toHaveAttribute('aria-pressed', 'false');
    expect(forearms).toHaveTextContent('No recent data');
  });

  it('defaults → Build plan → Start in two taps, with no network on the build path', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { onStart } = renderFlow();
    await waitForPreselection();

    const callsBeforeBuild = fromCalls.length;
    await user.click(screen.getByTestId('setup-build-plan')); // tap 1
    expect(screen.getByTestId('setup-draft-editor')).toBeInTheDocument();
    expect(fromCalls.length).toBe(callsBeforeBuild); // synchronous, no fetch

    await user.click(screen.getByTestId('setup-start')); // tap 2
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    const { items } = onStart.mock.calls[0][0];
    expect(items.length).toBeGreaterThan(0);
    // Compounds lead the plan.
    expect(['bench', 'incline', 'row', 'pulldown']).toContain(items[0].exerciseId);
  });

  it('updates the footer immediately on set changes and removals', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderFlow();
    await waitForPreselection();
    await user.click(screen.getByTestId('setup-build-plan'));

    const duration = () => screen.getByTestId('setup-duration').textContent;
    const chestBar = () => screen.getByTestId('setup-projection-chest').textContent;
    const before = { d: duration(), c: chestBar() };

    const firstRow = screen.getAllByTestId(/^setup-row-/)[0];
    const itemId = firstRow.getAttribute('data-testid')!.replace('setup-row-', '');
    await user.click(screen.getByTestId(`setup-sets-inc-${itemId}`));
    expect(screen.getByTestId(`setup-sets-${itemId}`)).toHaveTextContent(/sets/);
    expect(duration()).not.toBe(before.d);

    await user.click(screen.getByTestId(`setup-remove-${itemId}`));
    expect(screen.queryByTestId(`setup-row-${itemId}`)).not.toBeInTheDocument();
    expect(chestBar() !== before.c || duration() !== before.d).toBe(true);
  });

  it('swaps only to same-muscle alternatives, in place', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderFlow();
    await waitForPreselection();
    await user.click(screen.getByTestId('setup-chip-back')); // chest only
    await user.click(screen.getByTestId('setup-build-plan'));

    const rows = screen.getAllByTestId(/^setup-row-/);
    const itemId = rows[0].getAttribute('data-testid')!.replace('setup-row-', '');
    await user.click(screen.getByTestId(`setup-swap-${itemId}`));
    const sheet = await screen.findByTestId('setup-swap-sheet');
    const options = within(sheet).getAllByTestId(/^setup-swap-option-/).map((o) => o.getAttribute('data-testid'));
    // Chest alternatives only (none of back/biceps/forearms).
    options.forEach((id) => expect(id).toMatch(/bench|fly|incline/));
    await user.click(within(sheet).getAllByTestId(/^setup-swap-option-/)[0]);
    // Same slot, same position.
    expect(screen.getAllByTestId(/^setup-row-/)[0]).toHaveAttribute('data-testid', `setup-row-${itemId}`);
  });

  it('with the network off, Start keeps the plan and explains', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { onStart } = renderFlow();
    await waitForPreselection();
    await user.click(screen.getByTestId('setup-build-plan'));

    const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await user.click(screen.getByTestId('setup-start'));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByTestId('setup-start-error')).toHaveTextContent(/offline/i);
    expect(screen.getByTestId('setup-draft-editor')).toBeInTheDocument();
    onLine.mockRestore();
  });

  it('remembers the last time budget and trims to it', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const first = renderFlow();
    await waitForPreselection();
    await user.click(screen.getByTestId('setup-budget-30'));
    first.unmount();

    renderFlow();
    await waitForPreselection();
    expect(screen.getByTestId('setup-budget-30')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('setup-build-plan'));
    const minutes = Number(/~(\d+)/.exec(screen.getByTestId('setup-duration').textContent ?? '')![1]);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it('Build plan is disabled with no groups selected', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderFlow();
    await waitForPreselection();
    await user.click(screen.getByTestId('setup-chip-chest'));
    await user.click(screen.getByTestId('setup-chip-back'));
    expect(screen.getByTestId('setup-build-plan')).toBeDisabled();
    await act(async () => {});
  });
});
