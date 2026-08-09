/**
 * The manual check, automated: log a set on a rep_total exercise and the
 * NEXT prescription must update in place — no unmount, no navigating away
 * and back.
 *
 * The reported defect (docs/PRESCRIPTION_STALENESS_AUDIT.md) looked like a
 * stale render — the banner served set 2's prescription again for set 3 —
 * so this test pins the end-to-end UI behavior, not just the engine: same
 * mounted card, one more set in the `sets` prop, different number on screen.
 * It fails if the engine stops reacting OR if a future memo re-freezes the
 * component's view of the session.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ExerciseCard } from '../ExerciseCard';
import type { Exercise, ExerciseBlock, SetLog } from '@/types/schema';

jest.mock('../InlineRestTimerBar', () => ({
  InlineRestTimerBar: () => <div data-testid="inline-rest-timer" />,
}));
jest.mock('../DropsetPrompt', () => ({ DropsetPrompt: () => <div /> }));
jest.mock('../BodyweightSetEditRow', () => ({ BodyweightSetEditRow: () => <div /> }));
jest.mock('@/services/exerciseSwapper', () => ({ findSimilarExercises: jest.fn(() => []) }));

// A rep_total machine exercise: explicit progression_model, 2.5 kg stack.
const exercise: Exercise = {
  id: 'exercise-crunch',
  name: 'Abdominal Crunch Machine',
  primaryMuscle: 'abs',
  secondaryMuscles: [],
  mechanic: 'isolation',
  defaultRepRange: [6, 10],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  availableIncrementsKg: [2.5],
  progressionModel: 'rep_total',
  formCues: [],
  commonMistakes: [],
  setupNote: '',
  movementPattern: 'core',
  equipmentRequired: ['machine'],
} as Exercise;

const block: ExerciseBlock = {
  id: 'block-1',
  workoutSessionId: 'session-1',
  exerciseId: 'exercise-crunch',
  order: 1,
  supersetGroupId: null,
  supersetOrder: null,
  targetSets: 3,
  targetRepRange: [6, 10],
  targetRir: 2,
  targetWeightKg: 82.5,
  targetRestSeconds: 180,
  progressionType: null,
  suggestionReason: '',
  warmupProtocol: [],
  note: null,
  dropsetsPerSet: 0,
  dropPercentage: 0,
} as ExerciseBlock;

const setLog = (id: string, setNumber: number, weightKg: number, reps: number, rpe: number): SetLog =>
  ({
    id,
    exerciseBlockId: 'block-1',
    setNumber,
    reps,
    weightKg,
    rpe,
    restSeconds: 180,
    isWarmup: false,
    setType: 'normal',
    parentSetId: null,
    quality: 'stimulative',
    qualityReason: '',
    note: null,
    loggedAt: new Date().toISOString(),
  }) as SetLog;

// Last session: 3 × 10 @ 80 kg / 2 RIR (RPE 8) — the kg analog of the
// reported 3 × 10 @ 175 lb. The plan bumps one increment to 82.5 kg and
// exchanges the observed reps onto it: [9, 9, 9].
const previousSets = [1, 2, 3].map((n) => setLog(`prev-${n}`, n, 80, 10, 8));

const SET_1 = setLog('set-1', 1, 82.5, 9, 8); // 9 @ 2 RIR — on plan
const SHORT_HOT_SET_2 = setLog('set-2', 2, 82.5, 7, 9); // 7 @ 1 RIR — short and hot

const props = {
  exercise,
  block,
  unit: 'kg' as const,
  isActive: true,
  previousSets,
};

/** The "N kg × R @ E RIR" claim the suggestion banner renders. */
const prescriptionText = () => screen.getByText(/82\.5 kg × \d+ @ \d+ RIR/).textContent ?? '';

describe('rep_total prescription reacts to a set logged in the SAME mounted card', () => {
  it('updates the next-set prescription on set-log without a remount', () => {
    const { rerender } = render(<ExerciseCard {...props} sets={[SET_1]} />);

    // After set 1 (on plan) the ask for set 2 is the plan's 9.
    const afterSet1 = prescriptionText();
    expect(afterSet1).toMatch(/82\.5 kg × 9 @ 2 RIR/);

    // Log set 2 — 2 reps short, a full rep hotter than target. This is the
    // ONLY change: same component instance, same props otherwise. Before the
    // fix the banner re-served "82.5 kg × 9" here.
    rerender(<ExerciseCard {...props} sets={[SET_1, SHORT_HOT_SET_2]} />);

    const afterSet2 = prescriptionText();
    expect(afterSet2).not.toBe(afterSet1);
    // Set 2 showed 7 reps with 1 left = 8 in the tank, so 6 at the 2-RIR
    // target. The LOAD is held — reps absorb the decline.
    expect(afterSet2).toMatch(/82\.5 kg × 6 @ 2 RIR/);
  });

  it('says why the ask moved instead of shrinking it silently', () => {
    render(<ExerciseCard {...props} sets={[SET_1, SHORT_HOT_SET_2]} />);
    // The banner must name the trim — a target that quietly drops is the same
    // class of silent failure as one that quietly refuses to.
    expect(screen.getByText(/came in under/i)).toBeInTheDocument();
  });

  it('holds the prescription steady when the session is on plan', () => {
    // Over-correction guard at the UI level: an on-plan set must not move the
    // number just because a set was logged.
    const onPlanSet2 = setLog('set-2b', 2, 82.5, 9, 8);
    const { rerender } = render(<ExerciseCard {...props} sets={[SET_1]} />);
    const afterSet1 = prescriptionText();

    rerender(<ExerciseCard {...props} sets={[SET_1, onPlanSet2]} />);
    expect(prescriptionText()).toBe(afterSet1);
  });
});
