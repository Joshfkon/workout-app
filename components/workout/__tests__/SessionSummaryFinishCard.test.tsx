import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSummary } from '../SessionSummary';
import { makeWorkoutSession, makeExerciseBlock, makeSetLog } from '@/test-utils/factories';
import type { ExerciseBlock, SetLog } from '@/types/schema';

// The share button pulls in navigator.share / clipboard glue that's irrelevant
// here — stub it so the tests stay focused on the finish-card behavior.
jest.mock('../ShareWorkoutText', () => ({
  ShareWorkoutText: () => null,
}));

/**
 * Post-workout finish restructure:
 *  - Layer 1 (finish card, !readOnly): one compact input screen — stat strip,
 *    prefilled session RPE, deload toggle, collapsed notes. No analytics.
 *    Pump/workload are asked in the finish popup (MuscleGroupFeedbackModal)
 *    BEFORE this card renders and arrive via initialMuscleRatings — the card
 *    only forwards them on submit, it never asks.
 *  - Layer 2 (full report, readOnly): the analytics view. Zero-set muscles are
 *    filtered from Volume by Muscle and muscle keys render humanized
 *    ("glute_med" → "Glute Med").
 */

// 6-exercise fixture. The calves block has NO logged sets (skipped mid-way) —
// it must not produce a zero-set Volume-by-Muscle row.
function makeFixture(): { blocks: ExerciseBlock[]; sets: SetLog[] } {
  const defs = [
    { id: 'b1', exerciseId: 'e1', name: 'Incline Bench Press', muscle: 'chest_upper', rpes: [7, 8] },
    { id: 'b2', exerciseId: 'e2', name: 'Lat Pulldown', muscle: 'lats', rpes: [8, 7] },
    { id: 'b3', exerciseId: 'e3', name: 'Squat', muscle: 'quads', rpes: [9] },
    { id: 'b4', exerciseId: 'e4', name: 'Curl', muscle: 'biceps', rpes: [8] },
    { id: 'b5', exerciseId: 'e5', name: 'Hip Abduction', muscle: 'glute_med', rpes: [8] },
    { id: 'b6', exerciseId: 'e6', name: 'Calf Raise', muscle: 'calves', rpes: [] },
  ];

  const blocks = defs.map((d, i) => ({
    ...makeExerciseBlock({ id: d.id, exerciseId: d.exerciseId, order: i + 1 }),
    exercise: { id: d.exerciseId, name: d.name, primaryMuscle: d.muscle },
  })) as ExerciseBlock[];

  const sets: SetLog[] = [];
  defs.forEach((d) => {
    d.rpes.forEach((rpe, setIdx) => {
      sets.push(
        makeSetLog({
          id: `${d.id}-s${setIdx + 1}`,
          exerciseBlockId: d.id,
          setNumber: setIdx + 1,
          weightKg: 60,
          reps: 10,
          rpe,
        })
      );
    });
  });

  return { blocks, sets };
}

// Fixture set RPEs: 7,8,8,7,9,8 → avg 7.83 → prefill rounds to 8.
const EXPECTED_PREFILL_RPE = 8;

const finishSession = () =>
  makeWorkoutSession({
    state: 'completed',
    completedAt: '2026-07-10T10:00:00Z',
    startedAt: '2026-07-10T09:00:00Z',
    sessionRpe: null,
  });

describe('SessionSummary — finish card (layer 1)', () => {
  it('is a single input screen: no analytics sections, no pump question, collapsed notes', () => {
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={() => {}}
        durationSeconds={3600}
      />
    );

    expect(screen.getByTestId('finish-card')).toBeInTheDocument();
    expect(screen.getByText(/Workout Complete/i)).toBeInTheDocument();

    // Exactly one stat strip.
    expect(screen.getAllByTestId('session-stat-strip')).toHaveLength(1);

    // Analytics live on the full report, not here.
    expect(screen.queryByText(/Set Quality Breakdown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Volume by Muscle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Effort Timeline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Intensity Distribution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Exercise Details/i)).not.toBeInTheDocument();

    // Pump/workload were captured in the finish popup — never re-asked here.
    expect(document.body.textContent).not.toMatch(/pump/i);
    expect(screen.queryByText(/Workload by muscle/i)).not.toBeInTheDocument();

    // Inputs that ARE capturable now.
    expect(screen.getByText(/How hard was this session/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /deload/i })).toBeInTheDocument();
    expect(screen.getByText('+ Add note')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Finish/i })).toBeInTheDocument();
  });

  it('prefills session RPE from the set-derived average and submits it untouched', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={onSubmit}
        durationSeconds={3600}
      />
    );

    await user.click(screen.getByRole('button', { name: /Save & Finish/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].sessionRpe).toBe(EXPECTED_PREFILL_RPE);
  });

  it('keeps a manual RPE override over the prefill', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={onSubmit}
        durationSeconds={3600}
      />
    );

    await user.click(screen.getByRole('button', { name: '6' }));
    await user.click(screen.getByRole('button', { name: /Save & Finish/i }));

    expect(onSubmit.mock.calls[0][0].sessionRpe).toBe(6);
  });

  it('submits default feedback for exactly the muscles trained today when nothing was rated', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={onSubmit}
        durationSeconds={3600}
      />
    );

    await user.click(screen.getByRole('button', { name: /Save & Finish/i }));

    const feedback = onSubmit.mock.calls[0][0].muscleFeedback;
    // calves had no logged sets → no feedback entry.
    expect(feedback.map((f: { muscleGroup: string }) => f.muscleGroup)).toEqual([
      'chest_upper',
      'lats',
      'quads',
      'biceps',
      'glute_med',
    ]);
    feedback.forEach((entry: Record<string, unknown>) => {
      expect(entry).not.toHaveProperty('pump');
      expect(entry.workload).toBe(1); // unanswered default "just right"
    });
  });

  it('forwards the finish-popup ratings (initialMuscleRatings) untouched on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={onSubmit}
        durationSeconds={3600}
        initialMuscleRatings={{
          chest_upper: { pump: 3, workload: 0 },
          quads: { workload: 3 },
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /Save & Finish/i }));

    const feedback = onSubmit.mock.calls[0][0].muscleFeedback;
    const byMuscle = Object.fromEntries(
      feedback.map((f: { muscleGroup: string }) => [f.muscleGroup, f])
    );
    expect(byMuscle.chest_upper).toEqual({ muscleGroup: 'chest_upper', pump: 3, workload: 0 });
    expect(byMuscle.quads).toEqual({ muscleGroup: 'quads', workload: 3 });
    // Unrated muscles fall back to the default workload with no pump key.
    expect(byMuscle.lats).toEqual({ muscleGroup: 'lats', workload: 1 });
  });

  it('expands the notes field from the "+ Add note" line and submits the text', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={onSubmit}
        durationSeconds={3600}
      />
    );

    await user.click(screen.getByText('+ Add note'));
    await user.type(screen.getByRole('textbox'), 'felt strong');
    await user.click(screen.getByRole('button', { name: /Save & Finish/i }));

    expect(onSubmit.mock.calls[0][0].notes).toBe('felt strong');
  });

  it('never renders raw muscle keys', () => {
    const { blocks, sets } = makeFixture();
    render(
      <SessionSummary
        session={finishSession()}
        exerciseBlocks={blocks}
        allSets={sets}
        onSubmit={() => {}}
        durationSeconds={3600}
      />
    );

    expect(document.body.textContent).not.toMatch(/glute_med/i);
  });
});

describe('SessionSummary — full report (layer 2, readOnly)', () => {
  const renderReport = () => {
    const { blocks, sets } = makeFixture();
    return render(
      <SessionSummary
        session={makeWorkoutSession({
          state: 'completed',
          completedAt: '2026-07-10T10:00:00Z',
          startedAt: '2026-07-10T09:00:00Z',
          sessionRpe: 8,
        })}
        exerciseBlocks={blocks}
        allSets={sets}
        readOnly
        durationSeconds={3600}
      />
    );
  };

  it('shows the full analytics report with a single stat strip', () => {
    renderReport();

    expect(screen.getByTestId('session-full-report')).toBeInTheDocument();
    expect(screen.getAllByTestId('session-stat-strip')).toHaveLength(1);
    expect(screen.getByText(/Set Quality Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Volume by Muscle/i)).toBeInTheDocument();
    expect(screen.getByText(/Effort Timeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Intensity Distribution/i)).toBeInTheDocument();
    expect(screen.getByText(/Exercise Details/i)).toBeInTheDocument();

    // Inputs belong to the finish card, not the report.
    expect(screen.queryByRole('button', { name: /Save & Finish/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Workload by muscle/i)).not.toBeInTheDocument();
    // No pump question here either — capture happens per-exercise in-workout.
    expect(document.body.textContent).not.toMatch(/pump/i);
  });

  it('filters zero-set muscles from Volume by Muscle and humanizes keys', () => {
    renderReport();

    // Calves block logged no sets → no row.
    expect(screen.queryByText(/calves/i)).not.toBeInTheDocument();
    // glute_med renders as "Glute Med" everywhere, raw key nowhere.
    expect(screen.getAllByText('Glute Med').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/glute_med/i);
  });
});
