/**
 * UX panel round 19 on the exercise card: the pinned Log set bar repeats the
 * strip's reason line, and an injury-shaped pick from the suggested sheet
 * says so on the card.
 */

import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { ExerciseCard } from '../ExerciseCard';
import { STICKY_LOG_SLOT_ID } from '../SetLoggerRow';
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
  name: 'Chest Press Machine',
  primaryMuscle: 'chest',
  secondaryMuscles: [],
  mechanic: 'isolation',
  defaultRepRange: [6, 10],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  availableIncrementsKg: [2.5],
  formCues: [],
  commonMistakes: [],
  setupNote: '',
  movementPattern: 'horizontal_push',
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

const previousSets = [1, 2, 3].map((n) => setLog(`prev-${n}`, n, 80, 10, 8));

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ioCallbacks: IOCallback[] = [];
beforeEach(() => {
  ioCallbacks = [];
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: IOCallback) {
      ioCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  document.getElementById(STICKY_LOG_SLOT_ID)?.remove();
});

describe('ExerciseCard, UX panel round 19', () => {
  it('repeats the strip’s "Why:" line on the pinned Log set bar', () => {
    const slot = document.createElement('div');
    slot.id = STICKY_LOG_SLOT_ID;
    document.body.appendChild(slot);
    render(<ExerciseCard exercise={exercise} block={block} unit="kg" isActive previousSets={previousSets} sets={[]} />);
    const stripWhy = screen.getByTestId('suggestion-source').textContent;
    expect(stripWhy).toBeTruthy();
    act(() => {
      for (const cb of ioCallbacks) {
        cb([
          {
            isIntersecting: false,
            intersectionRatio: 0,
            boundingClientRect: { top: 900, bottom: 952 } as DOMRectReadOnly,
            rootBounds: { top: 0, bottom: 844 } as DOMRectReadOnly,
          },
        ]);
      }
    });
    const bar = within(slot).getByTestId('sticky-log-set');
    expect(within(bar).getByTestId('sticky-log-why')).toHaveTextContent(stripWhy!);
  });

  it('shows the injury line the suggested sheet put on the block', () => {
    render(
      <ExerciseCard
        exercise={exercise}
        block={{ ...block, suggestionReason: 'Chest: 0 of 10 weekly sets done · For your shoulder: picked instead of Barbell Bench Press' }}
        unit="kg"
        isActive
        previousSets={previousSets}
        sets={[]}
      />
    );
    expect(screen.getByTestId('exercise-injury-note')).toHaveTextContent(
      'For your shoulder: picked instead of Barbell Bench Press'
    );
  });

  it('shows no injury line for an ordinary block', () => {
    render(<ExerciseCard exercise={exercise} block={block} unit="kg" isActive previousSets={previousSets} sets={[]} />);
    expect(screen.queryByTestId('exercise-injury-note')).not.toBeInTheDocument();
  });
});
