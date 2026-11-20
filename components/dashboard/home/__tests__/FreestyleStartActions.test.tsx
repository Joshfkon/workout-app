import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FreestyleStartActions, repeatLabel } from '../FreestyleStartActions';
import type { RecentSessionRow } from '@/lib/training/repeatWorkout';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockCreateRepeatSession = jest.fn();
jest.mock('@/lib/training/repeatWorkout', () => {
  const actual = jest.requireActual('@/lib/training/repeatWorkout');
  return { ...actual, createRepeatSession: (...args: unknown[]) => mockCreateRepeatSession(...args) };
});

let mockRows: RecentSessionRow[] = [];
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: mockRows, error: null }),
    };
    return { from: () => chain };
  },
}));

jest.mock('@/components/workout/SuggestedWorkoutSheet', () => ({
  SuggestedWorkoutSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>Suggestion sheet</div> : null,
}));
// Resolve the lazy sheet synchronously via the mocked module above.
jest.mock('next/dynamic', () => () =>
  function DynamicSheet(props: { isOpen: boolean; onClose: () => void }) {
    return jest.requireMock('@/components/workout/SuggestedWorkoutSheet').SuggestedWorkoutSheet(props);
  }
);

const pullSession: RecentSessionRow = {
  id: 's1',
  completed_at: '2026-11-19T18:00:00Z',
  started_at: '2026-11-19T17:00:00Z',
  duration_seconds: 3600,
  exercise_blocks: [
    {
      exercise_id: 'row',
      order: 1,
      suggestion_reason: 'Pull - Week 2 of Arnold',
      exercises: { name: 'Barbell Row', primary_muscle: 'back' },
      set_logs: [
        { is_warmup: false, weight_kg: 80, reps: 8 },
        { is_warmup: true, weight_kg: 40, reps: 10 },
      ],
    },
  ],
};

const renderActions = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FreestyleStartActions userId="u1" />
    </QueryClientProvider>
  );

describe('repeatLabel', () => {
  it('keeps the split-day name, else the top muscle', () => {
    expect(repeatLabel('Pull · Back, Biceps')).toBe('Pull');
    expect(repeatLabel('Back, Biceps')).toBe('Back');
    expect(repeatLabel('Workout')).toBe('Workout');
  });
});

describe('FreestyleStartActions', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockPush.mockReset();
    mockCreateRepeatSession.mockReset();
  });

  it('repeats the last completed workout and opens it', async () => {
    mockRows = [pullSession];
    mockCreateRepeatSession.mockResolvedValue({ sessionId: 'new-1' });
    renderActions();

    const repeat = await screen.findByRole('button', { name: 'Repeat Pull' });
    await user.click(repeat);

    expect(mockCreateRepeatSession).toHaveBeenCalledWith(expect.anything(), 'u1', [
      { exerciseId: 'row', name: 'Barbell Row', sets: [{ weight_kg: 80, reps: 8 }] },
    ]);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/workout/new-1'));
  });

  it('opens the suggestion sheet in place', async () => {
    mockRows = [pullSession];
    renderActions();
    await user.click(screen.getByRole('button', { name: 'Suggest one' }));
    expect(screen.getByText('Suggestion sheet')).toBeInTheDocument();
  });

  it('shows only "Suggest one" before the first completed workout', async () => {
    mockRows = [];
    renderActions();
    expect(screen.getByRole('button', { name: 'Suggest one' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Repeat/ })).not.toBeInTheDocument()
    );
  });
});
