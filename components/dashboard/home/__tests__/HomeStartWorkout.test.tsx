import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { RecentSessionRow } from '@/lib/training/repeatWorkout';
import { HomeStartWorkout } from '../HomeStartWorkout';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/hooks/useStartEmptyWorkout', () => ({
  useStartEmptyWorkout: () => ({ start: jest.fn(), isStarting: false, error: null }),
}));

// Rows per queried state: 'in_progress' feeds the resume check,
// 'completed' the last-repeatable lookup.
let mockRows: Record<string, unknown[]> = {};
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => {
    let state = '';
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        if (col === 'state') state = val;
        return chain;
      },
      order: () => chain,
      limit: () => Promise.resolve({ data: mockRows[state] ?? [], error: null }),
    };
    return { from: () => chain };
  },
}));

jest.mock('@/components/workout/BottomSheet', () => ({
  BottomSheet: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));
jest.mock('@/components/workout/SuggestedWorkoutSheet', () => ({
  SuggestedWorkoutSheet: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Suggestion sheet</div> : null),
}));
jest.mock('next/dynamic', () => () =>
  function DynamicSheet(props: { isOpen: boolean; onClose: () => void }) {
    return jest.requireMock('@/components/workout/SuggestedWorkoutSheet').SuggestedWorkoutSheet(props);
  }
);

const doneSession: RecentSessionRow = {
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
      set_logs: [{ is_warmup: false, weight_kg: 80, reps: 8 }],
    },
  ],
};

function renderIt(compact = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HomeStartWorkout userId="user-1" compact={compact} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockRows = {};
  mockPush.mockReset();
});

describe('HomeStartWorkout', () => {
  it('resumes an unfinished workout instead of starting another', async () => {
    mockRows = { in_progress: [{ id: 'sess-9' }] };
    renderIt();
    const link = await screen.findByRole('link', { name: /resume workout/i });
    expect(link).toHaveAttribute('href', '/dashboard/workout/sess-9');
    expect(screen.queryByRole('button', { name: /start workout/i })).not.toBeInTheDocument();
  });

  it('opens the shared start options when nothing is in progress', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /start workout/i }));
    expect(screen.getByText('Start empty workout')).toBeInTheDocument();
    expect(screen.getByText('AI-suggested workout')).toBeInTheDocument();
    // No completed workout yet: repeat is disabled.
    expect(screen.getByText('Available once you complete a workout')).toBeInTheDocument();
  });

  it('opens the "Repeat a workout" picker in place on Home', async () => {
    const user = userEvent.setup();
    mockRows = { completed: [doneSession] };
    renderIt();
    await user.click(screen.getByRole('button', { name: /start workout/i }));
    await waitFor(() => expect(screen.getByText('Same exercises, fresh targets')).toBeInTheDocument());
    await user.click(screen.getByText('Repeat previous workout'));
    expect(await screen.findByTestId('repeat-workout-sheet')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the AI suggestion sheet from the options', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /start workout/i }));
    await user.click(screen.getByText('AI-suggested workout'));
    expect(screen.getByText('Suggestion sheet')).toBeInTheDocument();
  });
});

describe('HomeStartWorkout — compact entry (food-focused Home)', () => {
  it('is one quiet row with a start button and a program link', async () => {
    const user = userEvent.setup();
    renderIt(true);
    expect(screen.getByTestId('home-compact-workout-entry')).toBeInTheDocument();
    expect(screen.getByText('Lifting too?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /build a program/i })).toHaveAttribute(
      'href',
      '/dashboard/mesocycle/new'
    );
    await user.click(screen.getByRole('button', { name: /start workout/i }));
    expect(screen.getByText('Start empty workout')).toBeInTheDocument();
  });
});
