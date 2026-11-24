/**
 * UX panel round 20 (4 of 6): "the suggested weight and reps were prefilled
 * without explanation" — and, from a lifter returning from injury, "may be
 * too heavy". Every prefill names its basis, says the numbers are editable,
 * claims "light" only when the engine made it so, and cautions about an
 * injury the load was NOT adjusted for. The numbers themselves never change.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ExerciseCard, injuryAreaForPrefill } from '../ExerciseCard';
import { coldStartSourceLine, injuryLoadNote } from '../whyThisWeight';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';
import type { Exercise, ExerciseBlock, SetLog } from '@/types/schema';

jest.mock('../InlineRestTimerBar', () => ({ InlineRestTimerBar: () => <div /> }));
jest.mock('../DropsetPrompt', () => ({ DropsetPrompt: () => <div /> }));
jest.mock('../BodyweightSetEditRow', () => ({ BodyweightSetEditRow: () => <div /> }));
jest.mock('@/services/exerciseSwapper', () => ({ findSimilarExercises: jest.fn(() => []) }));

const exercise = {
  id: 'ex-bench',
  name: 'Barbell Bench Press',
  primaryMuscle: 'chest',
  secondaryMuscles: [],
  mechanic: 'compound',
  defaultRepRange: [6, 10],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  availableIncrementsKg: [2.5],
  formCues: [],
  commonMistakes: [],
  setupNote: '',
  movementPattern: 'horizontal_push',
  equipmentRequired: ['barbell'],
} as unknown as Exercise;

const block = {
  id: 'block-1',
  workoutSessionId: 'session-1',
  exerciseId: 'ex-bench',
  order: 1,
  supersetGroupId: null,
  supersetOrder: null,
  targetSets: 3,
  targetRepRange: [6, 10],
  targetRir: 2,
  targetWeightKg: 60,
  targetRestSeconds: 180,
  progressionType: null,
  suggestionReason: '',
  warmupProtocol: [],
  note: null,
  dropsetsPerSet: 0,
  dropPercentage: 0,
} as unknown as ExerciseBlock;

const setLog = (n: number, weightKg: number, reps: number): SetLog =>
  ({
    id: `s${n}`,
    exerciseBlockId: 'block-1',
    setNumber: n,
    reps,
    weightKg,
    rpe: 8,
    restSeconds: 180,
    isWarmup: false,
    setType: 'normal',
    parentSetId: null,
    quality: 'stimulative',
    qualityReason: '',
    note: null,
    loggedAt: new Date().toISOString(),
  }) as SetLog;

const coldStart = (overrides: Record<string, unknown> = {}) => ({
  weightKg: 60,
  reason: 'starting point estimated from your training profile',
  explanation: 'x',
  estimateSource: 'strength_standards' as const,
  ...overrides,
});

beforeEach(() => {
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('copy helpers', () => {
  it('names the basis, and says "light" only when told to', () => {
    expect(coldStartSourceLine({ basis: 'your bodyweight', startsLight: false, pickHint: 'pick a weight you could lift ~10 times' })).toBe(
      'First time on this lift — starting estimate from your bodyweight. Adjust if it feels heavy: pick a weight you could lift ~10 times'
    );
    expect(coldStartSourceLine({ basis: 'your bodyweight', startsLight: true, pickHint: 'p' })).toContain(
      'from your bodyweight, set on the light side.'
    );
  });

  it('never claims the injury lowered the load', () => {
    expect(injuryLoadNote({ area: 'Shoulder', startsLight: false })).toBe(
      'Not adjusted for your shoulder — go lighter if it hurts'
    );
    expect(injuryLoadNote({ area: 'Shoulder', startsLight: true })).toBe(
      'Started light, but not adjusted for your shoulder — go lighter if it hurts'
    );
  });

  it('finds the injured area from the check-in, else from the suggested sheet’s note', () => {
    const ex = { name: 'Barbell Bench Press', primaryMuscle: 'chest' };
    expect(injuryAreaForPrefill(ex, [{ area: 'shoulder', severity: 2 }], null)).toBe('Shoulder');
    expect(injuryAreaForPrefill(ex, [], 'For your shoulder: picked instead of Dips')).toBe('shoulder');
    expect(injuryAreaForPrefill(ex, [], null)).toBeNull();
  });
});

describe('weight engine: startsLight describes the number, never changes it', () => {
  const est = (knownE1RM?: number) =>
    quickWeightEstimate('Barbell Bench Press', { min: 6, max: 10 }, 2, 80, 180, 15, 'intermediate', undefined, 'kg', knownE1RM);

  it('flags a cold start (no history) as light', () => {
    expect(est().startsLight).toBe(true);
  });

  it('does not flag an estimate from the lifter’s own history', () => {
    expect(est(100).startsLight).toBe(false);
  });
});

describe('ExerciseCard prefill reason (round 20)', () => {
  it('a cold start with no estimate from the page still names its basis, not a bare guess', () => {
    render(<ExerciseCard exercise={exercise} block={block} unit="kg" isActive sets={[]} previousSets={[]} />);
    const why = screen.getByTestId('suggestion-source');
    expect(why).toHaveTextContent('starting estimate from your training profile');
    expect(why).not.toHaveTextContent(/guess/);
    expect(why).not.toHaveTextContent(/light side/);
    expect(screen.getByTestId('prefill-editable-hint')).toBeInTheDocument();
  });

  it('says "light side" when the engine made this number light', () => {
    render(
      <ExerciseCard exercise={exercise} block={block} unit="kg" isActive sets={[]} previousSets={[]} coldStartSuggestion={coldStart({ startsLight: true })} />
    );
    expect(screen.getByTestId('suggestion-source')).toHaveTextContent(
      'starting estimate from typical strength for your experience and bodyweight, set on the light side'
    );
    // The number is the estimate, unchanged.
    expect(screen.getByTestId('suggestion-numbers')).toHaveTextContent(/^60 kg × 6–10/);
  });

  it('does not say "light side" without the engine flag', () => {
    render(
      <ExerciseCard exercise={exercise} block={block} unit="kg" isActive sets={[]} previousSets={[]} coldStartSuggestion={coldStart()} />
    );
    expect(screen.getByTestId('suggestion-source')).not.toHaveTextContent(/light side/);
  });

  it('cautions about a check-in injury the load was not adjusted for', () => {
    render(
      <ExerciseCard
        exercise={exercise}
        block={block}
        unit="kg"
        isActive
        sets={[]}
        previousSets={[]}
        coldStartSuggestion={coldStart({ startsLight: true })}
        currentInjuries={[{ area: 'shoulder', severity: 2 }]}
      />
    );
    expect(screen.getByTestId('suggestion-caution')).toHaveTextContent(
      'Started light, but not adjusted for your shoulder — go lighter if it hurts'
    );
    expect(screen.getByTestId('suggestion-numbers')).toHaveTextContent(/^60 kg × 6–10/);
  });

  it('shows no injury caution without an injury', () => {
    render(<ExerciseCard exercise={exercise} block={block} unit="kg" isActive sets={[]} previousSets={[]} />);
    expect(screen.queryByTestId('suggestion-caution')).not.toBeInTheDocument();
  });

  it('the editable hint is for the lift’s first set only', () => {
    render(
      <ExerciseCard exercise={exercise} block={block} unit="kg" isActive sets={[setLog(1, 60, 9)]} previousSets={[]} />
    );
    expect(screen.getByTestId('suggestion-source')).toBeInTheDocument();
    expect(screen.queryByTestId('prefill-editable-hint')).not.toBeInTheDocument();
  });
});
