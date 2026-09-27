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
jest.mock('@/lib/actions/workoutPlanReview', () => ({
  reviewWorkoutPlan: jest.fn(async () => ({ ok: false, error: 'not in tests' })),
}));
jest.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'u1' }, isLoading: false, error: null }),
}));

import { WorkoutSetupFlow, type StartPlanPayload } from '../WorkoutSetupFlow';
import type { ReviewPayload } from '@/services/workoutSetup/aiReview';
import type { ReviewRequester } from '../usePlanReview';

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

describe('WorkoutSetupFlow — AI review', () => {
  async function toEditor(requester: ReviewRequester, extra: Partial<React.ComponentProps<typeof WorkoutSetupFlow>> = {}) {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const utils = renderFlow({ reviewRequester: requester, ...extra });
    await waitForPreselection();
    await user.click(screen.getByTestId('setup-build-plan'));
    return { user, ...utils };
  }

  it('shows suggestions inline with a summary; accepting applies through the edit path', async () => {
    let sent: ReviewPayload | null = null;
    const requester: ReviewRequester = async (payload) => {
      sent = payload;
      // The first item that has alternatives outside the plan.
      const first = payload.plan.find((p) => p.swapCandidates.length > 0)!;
      return {
        ok: true,
        review: {
          summary: 'One change worth making.',
          suggestions: [
            { id: 'sw', type: 'swap', itemId: first.itemId, replacementExerciseId: first.swapCandidates[0].exerciseId, reason: 'Fresher option', severity: 'info' },
            { id: 'fl', type: 'flag', itemId: payload.plan[payload.plan.length - 1].itemId, reason: 'Keep form strict', severity: 'warn' },
          ],
        },
      };
    };
    const { user, onStart } = await toEditor(requester);
    await user.click(screen.getByTestId('setup-review'));
    expect(await screen.findByTestId('setup-review-banner')).toHaveTextContent('One change worth making.');
    const target = sent!.plan.find((p) => p.swapCandidates.length > 0)!;
    const row = () => screen.getByTestId(`setup-row-${target.itemId}`);
    expect(within(row()).getByTestId('setup-suggestion-sw')).toBeInTheDocument();

    const replacement = target.swapCandidates[0].name;
    const setsBefore = within(row()).getByTestId(/^setup-sets-item/).textContent;
    const orderBefore = screen.getAllByTestId(/^setup-row-/).map((r) => r.getAttribute('data-testid'));
    await user.click(screen.getByTestId('setup-suggestion-accept-sw'));
    const rowAfter = row();
    // Swapped in place: same slot, same order.
    expect(screen.getAllByTestId(/^setup-row-/).map((r) => r.getAttribute('data-testid'))).toEqual(orderBefore);
    expect(rowAfter).toHaveTextContent(replacement);
    expect(within(rowAfter).getByTestId(/^setup-sets-item/).textContent).toBe(setsBefore);
    expect(screen.queryByTestId('setup-suggestion-sw')).not.toBeInTheDocument();
    // The other suggestion is still actionable.
    expect(screen.getByTestId('setup-suggestion-fl')).toBeInTheDocument();

    await user.click(screen.getByTestId('setup-start'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const { reviewDecisions } = onStart.mock.calls[0][0];
    expect(reviewDecisions.map((d) => [d.suggestionId, d.decision, d.applied])).toEqual([
      ['sw', 'accepted', true],
      ['fl', 'ignored', false],
    ]);
    expect(reviewDecisions[0]).toMatchObject({ type: 'swap', reason: 'Fresher option' });
  });

  it('"Looks good." when the review returns no suggestions', async () => {
    const { user } = await toEditor(async () => ({ ok: true, review: { summary: '', suggestions: [] } }));
    await user.click(screen.getByTestId('setup-review'));
    expect(await screen.findByTestId('setup-review-banner')).toHaveTextContent('Looks good.');
  });

  it('Accept all / Dismiss all record every decision', async () => {
    const requester: ReviewRequester = async (payload) => ({
      ok: true,
      review: {
        summary: '',
        suggestions: payload.plan.slice(0, 2).map((p, i) => ({ id: `s${i}`, type: 'adjust_sets' as const, itemId: p.itemId, newSets: p.sets === 2 ? 3 : 2, reason: 'time', severity: 'info' as const })),
      },
    });
    const { user, onStart } = await toEditor(requester);
    await user.click(screen.getByTestId('setup-review'));
    await screen.findByTestId('setup-review-banner');
    const duration = screen.getByTestId('setup-duration').textContent;
    await user.click(screen.getByTestId('setup-review-accept-all'));
    expect(screen.queryByTestId(/^setup-suggestion-s/)).not.toBeInTheDocument();
    expect(screen.getByTestId('setup-duration').textContent).not.toBe(duration);
    await user.click(screen.getByTestId('setup-start'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0].reviewDecisions.map((d) => d.decision)).toEqual(['accepted', 'accepted']);
  });

  it('a failed review never blocks Start and shows "Review unavailable"', async () => {
    const { user, onStart } = await toEditor(async () => ({ ok: false, error: 'boom' }));
    await user.click(screen.getByTestId('setup-review'));
    expect(await screen.findByText('Review unavailable, try again.')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-review-banner')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('setup-start'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
  });

  it('a user edit hides a shown review (stale)', async () => {
    const requester: ReviewRequester = async (payload) => ({
      ok: true,
      review: { summary: 'x', suggestions: [{ id: 'f', type: 'flag', itemId: payload.plan[0].itemId, reason: 'r', severity: 'info' }] },
    });
    const { user } = await toEditor(requester);
    await user.click(screen.getByTestId('setup-review'));
    await screen.findByTestId('setup-review-banner');
    const itemId = screen.getAllByTestId(/^setup-row-/)[0].getAttribute('data-testid')!.replace('setup-row-', '');
    await user.click(screen.getByTestId(`setup-sets-inc-${itemId}`));
    expect(screen.queryByTestId('setup-review-banner')).not.toBeInTheDocument();
  });
});
