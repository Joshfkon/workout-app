import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrainingStyleCard } from '../TrainingStyleCard';

/**
 * The training style saves on tap into users.preferences, keeping every
 * other preference key; Automatic removes the key so the style is inferred.
 */

let storedPreferences: Record<string, unknown>;
const recentSessions = Array.from({ length: 10 }, () => ({ mesocycle_id: null }));
const update = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { preferences: storedPreferences }, error: null }),
              single: async () => ({ data: { preferences: storedPreferences }, error: null }),
            }),
          }),
          update: (row: { preferences: Record<string, unknown> }) => ({
            eq: async () => {
              update(row);
              storedPreferences = row.preferences;
              return { error: null };
            },
          }),
        };
      }
      // workout_sessions: recent completed workouts, none from a plan.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: recentSessions, error: null }) }),
            }),
          }),
        }),
      };
    },
  }),
}));

describe('TrainingStyleCard', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    update.mockClear();
    storedPreferences = { units: 'lb', theme: 'dark' };
  });

  it('shows the inferred style under Automatic', async () => {
    render(<TrainingStyleCard userId="u1" />);
    expect(await screen.findByText(/based on how your recent workouts were started/i)).toHaveTextContent(
      'Freestyle'
    );
    expect(screen.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves a choice without dropping other preferences', async () => {
    render(<TrainingStyleCard userId="u1" />);
    await screen.findByText(/based on how/i);

    await user.click(screen.getByRole('button', { name: 'Plan' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        preferences: { units: 'lb', theme: 'dark', trainingStyle: 'plan' },
      })
    );
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Automatic removes the stored choice', async () => {
    storedPreferences = { units: 'lb', trainingStyle: 'plan' };
    render(<TrainingStyleCard userId="u1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true')
    );

    await user.click(screen.getByRole('button', { name: 'Automatic' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ preferences: { units: 'lb' } }));
  });
});
