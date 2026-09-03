/**
 * Regression: the exercise edit form must never report success for a write
 * that didn't land. Under RLS a direct update on a stock catalog row
 * "succeeds" with zero rows written — the old code showed "Exercise updated
 * successfully!" and reloaded, silently discarding the edit (the Glute Drive
 * Machine secondary-muscle report). The form now verifies the write: custom
 * rows save directly, stock rows fall back to the audited
 * update_catalog_exercise RPC (applied to the shared catalog for all users),
 * and any failure surfaces as a visible error naming what failed.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseEditForm } from '../ExerciseEditForm';
import type { Exercise } from '@/types/schema';

// One mutable holder so each test can configure the mock client.
const mockState: {
  isCustom: boolean;
  updateResult: { data: Array<{ id: string }> | null; error: { message: string } | null };
  rpcResult: { data: unknown; error: { message: string } | null };
  updateCalls: Array<{ table: string; payload: Record<string, unknown> }>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} = {
  isCustom: true,
  updateResult: { data: [{ id: 'ex-1' }], error: null },
  rpcResult: { data: null, error: null },
  updateCalls: [],
  rpcCalls: [],
};

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => {
    function tableBuilder(table: string) {
      const b: Record<string, unknown> & { _isUpdate?: boolean } = {};
      const chain = () => b;
      b.select = jest.fn(chain);
      b.eq = jest.fn(chain);
      b.order = jest.fn(chain);
      b.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: { is_custom: mockState.isCustom }, error: null })
      );
      b.update = jest.fn((payload: Record<string, unknown>) => {
        mockState.updateCalls.push({ table, payload });
        b._isUpdate = true;
        return b;
      });
      b.upsert = jest.fn(() => Promise.resolve({ error: null }));
      // Awaiting any chain resolves reads to empty lists; updates resolve to
      // the configured result (RLS simulation: [] = zero rows written).
      (b as { then?: unknown }).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) =>
        Promise.resolve(
          b._isUpdate ? mockState.updateResult : { data: [], error: null }
        ).then(resolve, reject);
      return b;
    }
    return {
      from: jest.fn(tableBuilder),
      rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
        mockState.rpcCalls.push({ fn, args });
        return Promise.resolve(mockState.rpcResult);
      }),
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })),
        // The save path reads the local session (no network) instead of
        // round-tripping to the auth server via getUser().
        getSession: jest.fn(async () => ({
          data: { session: { user: { id: 'user-1' } } },
        })),
      },
    };
  },
}));

const exercise = {
  id: 'ex-1',
  name: 'Glute Drive Machine',
  primaryMuscle: 'glutes',
  secondaryMuscles: ['hamstrings'],
  movementPattern: 'hip_hinge',
} as unknown as Exercise;

async function toggleQuadsAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: 'Quads' }));
  await user.click(screen.getByRole('button', { name: /^save$/i }));
}

/**
 * Regression: sub-muscle checkboxes must stay under their own group. Hiding
 * only the primary's own checkbox left its heads indented beneath the
 * PREVIOUS group's label — with primary "Calves (all)", Gastrocnemius and
 * Soleus rendered as if they were sub-muscles of Adductors. The heads stay
 * SELECTABLE either way: a coarse primary credits only itself and never its
 * heads (LEGACY_PRIMARY_VOLUME_WEIGHTS), so dropping them would silently
 * delete real volume credit.
 */
describe('ExerciseEditForm secondary-muscle taxonomy', () => {
  const withPrimary = (primaryMuscle: string, secondaryMuscles: string[] = []) =>
    ({ ...exercise, primaryMuscle, secondaryMuscles }) as unknown as Exercise;

  /** The data-muscle-group block a checkbox actually lives in. */
  const groupOf = (name: string) =>
    screen.getByRole('checkbox', { name }).closest('[data-muscle-group]')
      ?.getAttribute('data-muscle-group');

  beforeEach(() => {
    mockState.isCustom = true;
    mockState.updateResult = { data: [{ id: 'ex-1' }], error: null };
    mockState.updateCalls = [];
    mockState.rpcCalls = [];
  });

  it('nests each head under its own group, not the group rendered above it', async () => {
    render(<ExerciseEditForm exercise={withPrimary('gastrocnemius')} onCancel={() => {}} />);

    expect(await screen.findByRole('checkbox', { name: 'Soleus' })).toBeInTheDocument();
    expect(groupOf('Soleus')).toBe('calves');
    expect(groupOf('Glute Med')).toBe('glutes');
    expect(groupOf('Obliques')).toBe('abs');
    // The primary head itself is not offered again as a secondary.
    expect(screen.queryByRole('checkbox', { name: 'Gastrocnemius' })).not.toBeInTheDocument();
  });

  it('keeps the heads of a whole-group primary selectable, under their own label', async () => {
    render(<ExerciseEditForm exercise={withPrimary('calves')} onCancel={() => {}} />);

    // 'calves' as a primary credits only itself — it never leaks into
    // gastrocnemius/soleus — so both heads must remain taggable.
    expect(await screen.findByRole('checkbox', { name: 'Gastrocnemius' })).toBeInTheDocument();
    expect(groupOf('Gastrocnemius')).toBe('calves');
    expect(groupOf('Soleus')).toBe('calves');
    // The group itself is the primary, so it is labelled, not offered again.
    expect(screen.queryByRole('checkbox', { name: 'Calves' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Calves').closest('[data-muscle-group]')?.getAttribute('data-muscle-group')
    ).toBe('calves');
  });

  it('preserves an existing fine-muscle secondary under a coarse primary across a save', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    try {
      // Mirrors the seeded Single Leg Hip Thrust: coarse 'glutes' primary with
      // a legitimate 'glute_med' secondary. Editing an unrelated field must not
      // strip that head's volume credit.
      render(
        <ExerciseEditForm
          exercise={withPrimary('glutes', ['glute_med', 'hamstrings'])}
          onCancel={() => {}}
        />
      );

      expect(await screen.findByRole('checkbox', { name: 'Glute Med' })).toBeChecked();

      await user.click(screen.getByRole('checkbox', { name: 'Quads' }));
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await screen.findByText(/updated successfully/i);
      const update = mockState.updateCalls.find((c) => c.table === 'exercises');
      expect(update!.payload.secondary_muscles).toEqual(['glute_med', 'hamstrings', 'quads']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('omits a group with no heads left once it is the primary', async () => {
    render(<ExerciseEditForm exercise={withPrimary('quads')} onCancel={() => {}} />);

    expect(await screen.findByRole('checkbox', { name: 'Hamstrings' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Quads' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-muscle-group="quads"]')).toBeNull();
  });
});

describe('ExerciseEditForm save reporting', () => {
  beforeEach(() => {
    mockState.updateCalls = [];
    mockState.rpcCalls = [];
  });

  it('saves a stock catalog row through the audited RPC and says so', async () => {
    mockState.isCustom = false;
    mockState.updateResult = { data: [], error: null }; // RLS-filtered stock row
    mockState.rpcResult = { data: { id: 'ex-1', updated: true }, error: null };

    // Success schedules a window.location.reload in 1.5s — keep timers fake so
    // it never fires inside jsdom.
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    try {
      render(<ExerciseEditForm exercise={exercise} onCancel={() => {}} />);

      // Up-front shared-catalog warning renders once ownership loads.
      expect(await screen.findByTestId('catalog-exercise-notice')).toBeInTheDocument();

      await toggleQuadsAndSave(user);

      expect(
        await screen.findByText(/Shared exercise updated for all users/i)
      ).toBeInTheDocument();

      // The write went through the audited catalog RPC with the field intact.
      expect(mockState.rpcCalls).toHaveLength(1);
      expect(mockState.rpcCalls[0].fn).toBe('update_catalog_exercise');
      expect(
        (mockState.rpcCalls[0].args.p_patch as Record<string, unknown>).secondary_muscles
      ).toEqual(['hamstrings', 'quads']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a visible error (not success) when the catalog RPC rejects the write', async () => {
    mockState.isCustom = false;
    mockState.updateResult = { data: [], error: null };
    mockState.rpcResult = {
      data: null,
      error: { message: 'function update_catalog_exercise does not exist' },
    };

    const user = userEvent.setup();
    render(<ExerciseEditForm exercise={exercise} onCancel={() => {}} />);

    await toggleQuadsAndSave(user);

    const error = await screen.findByText(/catalog update failed/i);
    expect(error.textContent).toMatch(/does not exist/i);
    expect(screen.queryByText(/updated successfully/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/updated for all users/i)).not.toBeInTheDocument();

    // The write was attempted with the field in the payload — the failure is
    // honest, not a dropped field.
    const exercisesUpdate = mockState.updateCalls.find((c) => c.table === 'exercises');
    expect(exercisesUpdate).toBeDefined();
    expect(exercisesUpdate!.payload.secondary_muscles).toEqual(['hamstrings', 'quads']);
  });

  it('renders a failed save at the top of the form, next to the Save button', async () => {
    // Regression for the "editing doesn't seem to save" report: the form is
    // taller than a phone viewport and Save sits at the top, so an error
    // banner rendered at the BOTTOM was off-screen — a failed save was
    // indistinguishable from a silent no-op.
    mockState.isCustom = false;
    mockState.updateResult = { data: [], error: null };
    mockState.rpcResult = {
      data: null,
      error: { message: 'function update_catalog_exercise does not exist' },
    };

    const user = userEvent.setup();
    render(<ExerciseEditForm exercise={exercise} onCancel={() => {}} />);

    await toggleQuadsAndSave(user);

    const error = await screen.findByTestId('exercise-edit-save-error');
    const nameInput = screen.getByPlaceholderText('Exercise name');
    // The banner must precede the first field in document order.
    expect(
      error.compareDocumentPosition(nameInput) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('reports plain success when a custom row saves directly (no RPC involved)', async () => {
    mockState.isCustom = true;
    mockState.updateResult = { data: [{ id: 'ex-1' }], error: null };

    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    try {
      render(<ExerciseEditForm exercise={exercise} onCancel={() => {}} />);

      await toggleQuadsAndSave(user);

      expect(await screen.findByText(/updated successfully/i)).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-exercise-notice')).not.toBeInTheDocument();
      expect(mockState.rpcCalls).toHaveLength(0);

      const exercisesUpdate = mockState.updateCalls.find((c) => c.table === 'exercises');
      expect(exercisesUpdate!.payload.secondary_muscles).toEqual(['hamstrings', 'quads']);
    } finally {
      jest.useRealTimers();
    }
  });
});
