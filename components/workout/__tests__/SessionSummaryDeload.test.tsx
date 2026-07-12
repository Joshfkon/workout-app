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
 * T2: no PR fires from a deload session, even when the logged reps/e1RM exceed a
 * stale previous best. A deload is intentionally light — it must never surface
 * as a record.
 */

// A block with the exercise attached the way the workout page hands it in.
function blockWithExercise(): ExerciseBlock {
  return {
    ...makeExerciseBlock({ id: 'block-1', exerciseId: 'ex-1', targetRepRange: [8, 12] }),
    // The summary reads (block as any).exercise for name/muscle.
    exercise: { id: 'ex-1', name: 'Bench Press', primaryMuscle: 'chest' },
  } as ExerciseBlock;
}

// One clean working set that clearly beats the previous best below.
const beatingSets = [
  makeSetLog({ id: 's1', exerciseBlockId: 'block-1', weightKg: 120, reps: 10, rpe: 8 }),
];

// Previous best well under the logged set → a PR would normally fire.
const historyBeaten = {
  'ex-1': { exerciseId: 'ex-1', exerciseName: 'Bench Press', previousBest: { weight: 80, reps: 8, e1rm: 100 } },
};

describe('SessionSummary — deload PR suppression', () => {
  it('fires a PR on a normal session that beats the previous best (control)', () => {
    render(
      <SessionSummary
        session={makeWorkoutSession({ state: 'completed', isDeload: false, completedAt: '2026-01-10T10:00:00Z' })}
        exerciseBlocks={[blockWithExercise()]}
        allSets={beatingSets}
        exerciseHistories={historyBeaten}
        onSubmit={() => {}}
      />
    );

    expect(screen.getAllByText(/Personal Record/i).length).toBeGreaterThan(0);
  });

  it('fires NO PR on a deload session with the same record-beating sets', () => {
    render(
      <SessionSummary
        session={makeWorkoutSession({ state: 'completed', isDeload: true, completedAt: '2026-01-10T10:00:00Z' })}
        exerciseBlocks={[blockWithExercise()]}
        allSets={beatingSets}
        exerciseHistories={historyBeaten}
        onSubmit={() => {}}
      />
    );

    expect(screen.queryByText(/Personal Record/i)).not.toBeInTheDocument();
    // Falls back to the normal completion header instead of a PR celebration.
    expect(screen.getByText(/Workout Complete/i)).toBeInTheDocument();
  });
});
