/**
 * Regression: the exercise edit form must never report success for a write
 * that didn't land. Under RLS, updating a stock catalog row "succeeds" with
 * zero rows written — the old code showed "Exercise updated successfully!"
 * and reloaded, silently discarding the edit (the Glute Drive Machine
 * secondary-muscle report). The form now verifies the write and surfaces a
 * visible error naming what failed.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseEditForm } from '../ExerciseEditForm';
import type { Exercise } from '@/types/schema';

// One mutable holder so each test can configure the mock client.
const mockState: {
  isCustom: boolean;
  updateResult: { data: Array<{ id: string }> | null; error: { message: string } | null };
  updateCalls: Array<{ table: string; payload: Record<string, unknown> }>;
} = {
  isCustom: true,
  updateResult: { data: [{ id: 'ex-1' }], error: null },
  updateCalls: [],
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
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })),
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

describe('ExerciseEditForm save reporting', () => {
  beforeEach(() => {
    mockState.updateCalls = [];
  });

  it('reports a visible error (not success) when the write lands on zero rows', async () => {
    mockState.isCustom = false;
    mockState.updateResult = { data: [], error: null }; // RLS-filtered stock row

    const user = userEvent.setup();
    render(<ExerciseEditForm exercise={exercise} onCancel={() => {}} />);

    // Up-front catalog warning renders once ownership loads.
    expect(await screen.findByTestId('catalog-exercise-notice')).toBeInTheDocument();

    await toggleQuadsAndSave(user);

    const error = await screen.findByText(/Not saved — .*Secondary muscles/i);
    expect(error).toBeInTheDocument();
    expect(error.textContent).toMatch(/catalog/i);
    expect(screen.queryByText(/updated successfully/i)).not.toBeInTheDocument();

    // The write was attempted with the field in the payload — the failure is
    // the zero-row result, not a dropped field.
    const exercisesUpdate = mockState.updateCalls.find((c) => c.table === 'exercises');
    expect(exercisesUpdate).toBeDefined();
    expect(exercisesUpdate!.payload.secondary_muscles).toEqual(['hamstrings', 'quads']);
  });

  it('reports success when the verified write lands on the row', async () => {
    mockState.isCustom = true;
    mockState.updateResult = { data: [{ id: 'ex-1' }], error: null };

    // Success schedules a window.location.reload in 1.5s — keep timers fake so
    // it never fires inside jsdom.
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    try {
      render(<ExerciseEditForm exercise={exercise} onCancel={() => {}} />);

      await toggleQuadsAndSave(user);

      expect(await screen.findByText(/updated successfully/i)).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-exercise-notice')).not.toBeInTheDocument();

      const exercisesUpdate = mockState.updateCalls.find((c) => c.table === 'exercises');
      expect(exercisesUpdate!.payload.secondary_muscles).toEqual(['hamstrings', 'quads']);
    } finally {
      jest.useRealTimers();
    }
  });
});
