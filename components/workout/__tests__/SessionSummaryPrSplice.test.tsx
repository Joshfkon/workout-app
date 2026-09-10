import { render, screen } from '@testing-library/react';
import { SessionSummary } from '../SessionSummary';
import { makeWorkoutSession, makeExerciseBlock, makeSetLog } from '@/test-utils/factories';
import type { ExerciseBlock } from '@/types/schema';

// The share button pulls in navigator.share / clipboard glue that's irrelevant
// to PR detection — stub it so the test stays focused on the summary logic.
jest.mock('../ShareWorkoutText', () => ({
  ShareWorkoutText: () => null,
}));

/**
 * PR detection must judge WHOLE sets, never per-column maxes over the set
 * pool. The historical bug: max(reps) from a light set combined with
 * max(weight) from a heavy set passed the "reps at comparable load" gate even
 * though no single set satisfied both — a fabricated PR.
 */

function blockWithExercise(): ExerciseBlock {
  return {
    ...makeExerciseBlock({ id: 'block-1', exerciseId: 'ex-1', targetRepRange: [8, 12] }),
    // The summary reads (block as any).exercise for name/muscle.
    exercise: { id: 'ex-1', name: 'Bench Press', primaryMuscle: 'chest' },
  } as ExerciseBlock;
}

const session = makeWorkoutSession({
  state: 'completed',
  isDeload: false,
  completedAt: '2026-01-10T10:00:00Z',
});

// previousBest.e1rm is set high so only the weight/reps gates are in play
// (100×3 @8 → e1RM 112.5; 100×12 @8 → capped e1RM 144 — both under 150).
const history = {
  'ex-1': {
    exerciseId: 'ex-1',
    exerciseName: 'Bench Press',
    previousBest: { weight: 100, reps: 10, e1rm: 150 },
  },
};

describe('SessionSummary — PR detection selects whole sets', () => {
  it('does NOT fire a reps PR when the rep max and the load qualifier come from different sets', () => {
    // 100×3 satisfies the ≥95% load gate but not the rep count; 60×15 beats
    // the rep count but not at a comparable load. No single set is a PR.
    const sets = [
      makeSetLog({ id: 's1', exerciseBlockId: 'block-1', weightKg: 100, reps: 3, rpe: 8 }),
      makeSetLog({ id: 's2', exerciseBlockId: 'block-1', weightKg: 60, reps: 15, rpe: 8 }),
    ];

    render(
      <SessionSummary
        session={session}
        exerciseBlocks={[blockWithExercise()]}
        allSets={sets}
        exerciseHistories={history}
        onSubmit={() => {}}
      />
    );

    expect(screen.queryByText(/Personal Record/i)).not.toBeInTheDocument();
  });

  it('fires a reps PR when ONE set beats the count at a comparable load (control)', () => {
    const sets = [
      makeSetLog({ id: 's1', exerciseBlockId: 'block-1', weightKg: 100, reps: 12, rpe: 8 }),
    ];

    render(
      <SessionSummary
        session={session}
        exerciseBlocks={[blockWithExercise()]}
        allSets={sets}
        exerciseHistories={history}
        onSubmit={() => {}}
      />
    );

    expect(screen.getAllByText(/Personal Record/i).length).toBeGreaterThan(0);
  });

  it('fires no PR when the only record-beating set had ugly form', () => {
    const sets = [
      makeSetLog({
        id: 's1',
        exerciseBlockId: 'block-1',
        weightKg: 120,
        reps: 10,
        rpe: 8,
        feedback: { repsInTank: 0, form: 'ugly' },
      }),
    ];

    render(
      <SessionSummary
        session={session}
        exerciseBlocks={[blockWithExercise()]}
        allSets={sets}
        exerciseHistories={history}
        onSubmit={() => {}}
      />
    );

    expect(screen.queryByText(/Personal Record/i)).not.toBeInTheDocument();
  });

  it('lets a clean set win a record even when an ugly set tied its weight', () => {
    // Old behavior vetoed the whole exercise when any ugly set matched the
    // best weight. The clean 100×12 (capped e1RM 144 > 140) is a genuine
    // performance on its own — the ugly set is merely ineligible.
    const sets = [
      makeSetLog({
        id: 's1',
        exerciseBlockId: 'block-1',
        weightKg: 100,
        reps: 12,
        rpe: 8,
        feedback: { repsInTank: 0, form: 'ugly' },
      }),
      makeSetLog({ id: 's2', exerciseBlockId: 'block-1', weightKg: 100, reps: 12, rpe: 8 }),
    ];

    render(
      <SessionSummary
        session={session}
        exerciseBlocks={[blockWithExercise()]}
        allSets={sets}
        exerciseHistories={{
          'ex-1': {
            exerciseId: 'ex-1',
            exerciseName: 'Bench Press',
            previousBest: { weight: 100, reps: 15, e1rm: 140 },
          },
        }}
        onSubmit={() => {}}
      />
    );

    expect(screen.getAllByText(/Personal Record/i).length).toBeGreaterThan(0);
  });
});
