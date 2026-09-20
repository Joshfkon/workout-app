import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LegacyHistoryBackfill } from '../LegacyHistoryBackfill';
import {
  countLegacyLocationRows,
  runLegacyLocationBackfill,
} from '@/lib/training/legacyLocationBackfill';

/**
 * The Settings card for assigning pre-location history to a gym. What must
 * hold: the destructive write only fires after an explicit confirm, against
 * the gym the user picked; a database that can't answer degrades to a
 * message instead of a broken button; and "nothing to assign" reads as a
 * positive state, not an empty card.
 */

jest.mock('@/lib/training/legacyLocationBackfill', () => ({
  countLegacyLocationRows: jest.fn(),
  runLegacyLocationBackfill: jest.fn(),
}));

const gymRows = [
  { id: 'gym-f19', name: 'Fitness 19', is_default: true },
  { id: 'gym-pf', name: 'Planet Fitness', is_default: false },
];

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: gymRows, error: null }),
        }),
      }),
    }),
  }),
}));

const mockCount = countLegacyLocationRows as jest.MockedFunction<typeof countLegacyLocationRows>;
const mockRun = runLegacyLocationBackfill as jest.MockedFunction<typeof runLegacyLocationBackfill>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows the unassigned counts and runs the backfill only after confirm, on the picked gym', async () => {
  const user = userEvent.setup();
  mockCount.mockResolvedValue({ sessionCount: 12, setCount: 340 });
  mockRun.mockResolvedValue({ ok: true, sessionsStamped: 12, setsStamped: 340 });

  render(<LegacyHistoryBackfill userId="user-1" />);

  const count = await screen.findByTestId('legacy-backfill-count');
  expect(count).toHaveTextContent('340 sets');
  expect(count).toHaveTextContent('12 workouts');

  // The default gym is preselected; pick the other one instead.
  const options = screen.getAllByTestId('legacy-backfill-gym-option');
  expect(options).toHaveLength(2);
  await user.click(options[1]);

  // Opening the dialog runs nothing yet.
  await user.click(screen.getByTestId('legacy-backfill-open-confirm'));
  expect(mockRun).not.toHaveBeenCalled();

  await user.click(screen.getByTestId('legacy-backfill-confirm'));

  await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
  expect(mockRun).toHaveBeenCalledWith(expect.anything(), 'gym-pf');
  expect(await screen.findByTestId('legacy-backfill-result')).toHaveTextContent(
    'Assigned 340 sets across 12 workouts to Planet Fitness.'
  );
});

it('reads as a positive done-state when nothing is unassigned', async () => {
  mockCount.mockResolvedValue({ sessionCount: 0, setCount: 0 });

  render(<LegacyHistoryBackfill userId="user-1" />);

  expect(await screen.findByTestId('legacy-backfill-done')).toBeInTheDocument();
  expect(screen.queryByTestId('legacy-backfill-open-confirm')).not.toBeInTheDocument();
});

it('degrades to a message when the database cannot answer (pre-migration)', async () => {
  mockCount.mockResolvedValue(null);

  render(<LegacyHistoryBackfill userId="user-1" />);

  expect(await screen.findByTestId('legacy-backfill-unavailable')).toBeInTheDocument();
  expect(screen.queryByTestId('legacy-backfill-open-confirm')).not.toBeInTheDocument();
});

it('surfaces an RPC failure inline and leaves the card usable', async () => {
  const user = userEvent.setup();
  mockCount.mockResolvedValue({ sessionCount: 3, setCount: 40 });
  mockRun.mockResolvedValue({ ok: false, message: 'Backfill failed' });

  render(<LegacyHistoryBackfill userId="user-1" />);

  await screen.findByTestId('legacy-backfill-count');
  await user.click(screen.getByTestId('legacy-backfill-open-confirm'));
  await user.click(screen.getByTestId('legacy-backfill-confirm'));

  expect(await screen.findByTestId('legacy-backfill-error')).toHaveTextContent('Backfill failed');
  // Still actionable — the user can retry.
  expect(screen.getByTestId('legacy-backfill-open-confirm')).toBeInTheDocument();
});
