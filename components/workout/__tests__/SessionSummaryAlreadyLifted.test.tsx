import { render, screen } from '@testing-library/react';
import { SessionSummary } from '../SessionSummary';
import { makeWorkoutSession, makeExerciseBlock, makeSetLog } from '@/test-utils/factories';
import type { ExerciseBlock } from '@/types/schema';

jest.mock('../ShareWorkoutText', () => ({
  ShareWorkoutText: () => null,
}));

/**
 * The summary must not list a PR for a set already lifted: one earlier set
 * that matched or beat it on BOTH weight and reps rules it out (same rule as
 * the live celebration, services/livePrDetector). Repeating last week's
 * 40 × 8 at a lower RPE raised its RPE-based e1RM and was listed as an e1RM PR.
 */

function blockWithExercise(): ExerciseBlock {
  return {
    ...makeExerciseBlock({ id: 'block-1', exerciseId: 'ex-1', targetRepRange: [8, 12] }),
    exercise: { id: 'ex-1', name: 'Tricep Pushdown', primaryMuscle: 'triceps' },
  } as ExerciseBlock;
}

const session = makeWorkoutSession({
  state: 'completed',
  isDeload: false,
  completedAt: '2026-11-13T10:00:00Z',
});

// Last week: 40 × 8 @8 (best e1RM ≈ 53.3) and 45 × 2 @10.
const history = {
  'ex-1': {
    exerciseId: 'ex-1',
    exerciseName: 'Tricep Pushdown',
    previousBest: {
      weight: 45,
      reps: 2,
      e1rm: 53.3,
      liftedSets: [
        { weightKg: 40, count: 8 },
        { weightKg: 45, count: 2 },
      ],
    },
  },
};

const renderWith = (weightKg: number, reps: number, rpe: number) =>
  render(
    <SessionSummary
      session={session}
      exerciseBlocks={[blockWithExercise()]}
      allSets={[makeSetLog({ id: 's1', exerciseBlockId: 'block-1', weightKg, reps, rpe })]}
      exerciseHistories={history}
      onSubmit={() => {}}
    />
  );

describe('SessionSummary — no PR for something already lifted', () => {
  it('repeating last week\'s weight and reps at a lower RPE is not a PR', () => {
    renderWith(40, 8, 7);
    expect(screen.queryByText(/Personal Record/i)).not.toBeInTheDocument();
  });

  it('beating last week\'s set on reps at the same weight is still a PR (control)', () => {
    renderWith(40, 10, 8);
    expect(screen.getAllByText(/Personal Record/i).length).toBeGreaterThan(0);
  });
});
