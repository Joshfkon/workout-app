/**
 * Snapshot and unit tests for ExerciseCard component
 *
 * Covers the one-tap set logger flow (SetLoggerRow + SuggestionBanner),
 * plateau badge, bodyweight handling, and the compact completed/pending
 * set lines.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseCard } from '../ExerciseCard';
import type {
  Exercise,
  ExerciseBlock,
  SetLog,
  ExercisePerformanceSnapshot,
} from '@/types/schema';

// Mock the child components that carry their own behavior/timers
jest.mock('../InlineRestTimerBar', () => ({
  InlineRestTimerBar: ({ seconds, isRunning }: any) => (
    <div data-testid="inline-rest-timer" data-seconds={seconds} data-running={isRunning}>
      Rest Timer Mock
    </div>
  ),
}));

jest.mock('../DropsetPrompt', () => ({
  DropsetPrompt: ({ onComplete, onCancel }: any) => (
    <div data-testid="dropset-prompt">
      <button onClick={() => onComplete({ weightKg: 50, reps: 8, rpe: 9 })}>Complete Dropset</button>
      <button onClick={onCancel}>Cancel Dropset</button>
    </div>
  ),
}));

jest.mock('../BodyweightSetEditRow', () => ({
  BodyweightSetEditRow: () => <div data-testid="bodyweight-edit">Bodyweight Edit Mock</div>,
}));

jest.mock('../SegmentedControl', () => ({
  SegmentedControl: ({ options, value, onChange }: any) => (
    <div data-testid="segmented-control">
      {options.map((opt: any) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          data-selected={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

// Mock exerciseSwapper
jest.mock('@/services/exerciseSwapper', () => ({
  findSimilarExercises: jest.fn(() => []),
  calculateSimilarityScore: jest.fn(() => 0.8),
}));

// Mock injuryAwareSwapper
jest.mock('@/services/injuryAwareSwapper', () => ({
  getInjuryRisk: jest.fn(() => 'safe'),
  INJURY_LABELS: {
    lower_back: 'Lower Back',
    shoulder: 'Shoulder',
    knee: 'Knee',
  },
}));

// Mock utils - include cn function used by UI components. Conversion mocks
// are faithful so unit-handling assertions stay meaningful.
jest.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
  convertWeight: jest.fn((w, from, to) => {
    if (from === to) return w;
    return to === 'lb' ? w * 2.20462 : w / 2.20462;
  }),
  formatWeight: jest.fn((w, unit) => `${w}${unit}`),
  formatMuscleName: jest.fn((m: string) => m.split(/[_\s]+/).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ')),
  formatWeightValue: jest.fn((w, unit) => (unit === 'lb' ? Math.round((w * 2.20462) / 2.5) * 2.5 : w)),
  convertWeightForDisplay: jest.fn((w, unit) =>
    unit === 'lb' ? Math.round(w * 2.20462 * 10) / 10 : Math.round(w * 10) / 10
  ),
  inputWeightToKg: jest.fn((w, unit) => (unit === 'lb' ? w / 2.20462 : w)),
  roundToPlateIncrement: jest.fn((w) => Math.round(w / 2.5) * 2.5),
  roundToIncrement: jest.fn((w, inc) => (inc > 0 ? Math.round(w / inc) * inc : w)),
  clamp: jest.fn((v, min, max) => Math.max(min, Math.min(max, v))),
  formatDuration: jest.fn((s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`),
  generateId: jest.fn(() => 'generated-id-' + Math.random().toString(36).substr(2, 9)),
}));

// Test fixtures
const createMockExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: 'exercise-1',
  name: 'Bench Press',
  primaryMuscle: 'chest',
  secondaryMuscles: ['triceps', 'shoulders'],
  mechanic: 'compound',
  defaultRepRange: [8, 12] as [number, number],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  formCues: ['Keep shoulder blades retracted', 'Maintain arch'],
  commonMistakes: ['Flaring elbows', 'Bouncing off chest'],
  setupNote: 'Set up with eyes under the bar',
  movementPattern: 'horizontal_push',
  equipmentRequired: ['barbell', 'bench'],
  ...overrides,
});

const createMockBlock = (overrides: Partial<ExerciseBlock> = {}): ExerciseBlock => ({
  id: 'block-1',
  workoutSessionId: 'session-1',
  exerciseId: 'exercise-1',
  order: 1,
  supersetGroupId: null,
  supersetOrder: null,
  targetSets: 3,
  targetRepRange: [8, 12] as [number, number],
  targetRir: 2,
  targetWeightKg: 60,
  targetRestSeconds: 180,
  progressionType: null,
  suggestionReason: '',
  warmupProtocol: [],
  note: null,
  dropsetsPerSet: 0,
  dropPercentage: 0,
  ...overrides,
});

const createMockSetLog = (overrides: Partial<SetLog> = {}): SetLog => ({
  id: 'set-1',
  exerciseBlockId: 'block-1',
  setNumber: 1,
  reps: 10,
  weightKg: 100,
  rpe: 8,
  restSeconds: 180,
  isWarmup: false,
  setType: 'normal',
  parentSetId: null,
  quality: 'stimulative',
  qualityReason: 'Good effort',
  note: null,
  loggedAt: new Date().toISOString(),
  ...overrides,
});

const createSnapshot = (
  overrides: Partial<ExercisePerformanceSnapshot> = {}
): ExercisePerformanceSnapshot => ({
  id: 'snap-1',
  userId: 'user-1',
  exerciseId: 'exercise-1',
  sessionDate: '2026-05-01',
  topSetWeightKg: 100,
  topSetReps: 8,
  topSetRpe: 8,
  totalWorkingSets: 3,
  estimatedE1RM: 120,
  ...overrides,
});

/**
 * Dates must be relative to "now": ExerciseCard passes the current date to
 * detectPlateau, which skips exercises not trained within its staleness
 * window, so fixed dates would rot as real time advances.
 */
const weeksAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toISOString().slice(0, 10);
};

/** Five weeks of flat E1RM ending today — unambiguous plateau for detectPlateau. */
const plateauedSnapshots: ExercisePerformanceSnapshot[] = [
  createSnapshot({ id: 's1', sessionDate: weeksAgo(4) }),
  createSnapshot({ id: 's2', sessionDate: weeksAgo(3) }),
  createSnapshot({ id: 's3', sessionDate: weeksAgo(2) }),
  createSnapshot({ id: 's4', sessionDate: weeksAgo(1) }),
  createSnapshot({ id: 's5', sessionDate: weeksAgo(0) }),
];

describe('ExerciseCard', () => {
  const defaultProps = {
    exercise: createMockExercise(),
    block: createMockBlock(),
    sets: [],
    unit: 'kg' as const,
    isActive: false,
  };

  describe('Snapshot Tests', () => {
    it('renders empty state (no sets logged)', () => {
      const { container } = render(<ExerciseCard {...defaultProps} />);
      expect(container).toMatchSnapshot();
    });

    it('renders with completed sets', () => {
      const sets = [
        createMockSetLog({ id: 'set-1', setNumber: 1, weightKg: 100, reps: 10, rpe: 7 }),
        createMockSetLog({ id: 'set-2', setNumber: 2, weightKg: 100, reps: 9, rpe: 8 }),
      ];

      const { container } = render(<ExerciseCard {...defaultProps} sets={sets} />);
      expect(container).toMatchSnapshot();
    });

    it('renders active state with logger row and suggestion banner', () => {
      const { container } = render(<ExerciseCard {...defaultProps} isActive={true} />);
      expect(container).toMatchSnapshot();
    });

    it('renders with exercise history', () => {
      const exerciseHistory = {
        lastWorkoutDate: '2024-01-10',
        lastWorkoutSets: [
          { weightKg: 100, reps: 10, rpe: 8 },
          { weightKg: 100, reps: 9, rpe: 9 },
        ],
        estimatedE1RM: 125,
        personalRecord: {
          weightKg: 120,
          reps: 1,
          e1rm: 120,
          date: '2023-12-15',
        },
        totalSessions: 24,
      };

      const { container } = render(
        <ExerciseCard {...defaultProps} exerciseHistory={exerciseHistory} />
      );
      expect(container).toMatchSnapshot();
    });

    it('renders in lb unit mode', () => {
      const { container } = render(
        <ExerciseCard {...defaultProps} unit="lb" recommendedWeight={100} />
      );
      expect(container).toMatchSnapshot();
    });

    it('renders with hypertrophy score tier pill', () => {
      const { container } = render(
        <ExerciseCard
          {...defaultProps}
          exercise={createMockExercise({
            hypertrophyScore: {
              tier: 'S',
              stretchUnderLoad: 5,
              resistanceProfile: 4,
              progressionEase: 5,
            },
          } as any)}
        />
      );
      expect(container).toMatchSnapshot();
    });

    it('renders bodyweight exercise', () => {
      const { container } = render(
        <ExerciseCard
          {...defaultProps}
          exercise={createMockExercise({
            id: 'pullup-1',
            name: 'Pull-ups',
            primaryMuscle: 'back',
            equipmentRequired: ['bodyweight'],
          })}
          userBodyweightKg={80}
        />
      );
      expect(container).toMatchSnapshot();
    });

    it('renders with plateau pill', () => {
      const { container } = render(
        <ExerciseCard {...defaultProps} performanceSnapshots={plateauedSnapshots} />
      );
      expect(container).toMatchSnapshot();
    });
  });

  describe('Header', () => {
    it('displays exercise name and primary muscle meta line', () => {
      render(<ExerciseCard {...defaultProps} />);
      expect(screen.getByText('Bench Press')).toBeInTheDocument();
      expect(screen.getByText(/chest/i)).toBeInTheDocument();
    });

    it('displays progress badge', () => {
      render(<ExerciseCard {...defaultProps} />);
      expect(screen.getByText(/0\/3/)).toBeInTheDocument();
    });

    it('shows last-session summary in the meta line', () => {
      render(
        <ExerciseCard
          {...defaultProps}
          exerciseHistory={{
            lastWorkoutDate: '2024-01-10',
            lastWorkoutSets: [
              { weightKg: 60, reps: 9, rpe: 8 },
              { weightKg: 60, reps: 8, rpe: 8 },
            ],
            estimatedE1RM: 80,
            personalRecord: null,
            totalSessions: 5,
          }}
        />
      );
      // "chest · last session 60 kg × 9, × 8 @ 2 RIR"
      expect(screen.getByText(/last session 60 kg × 9, × 8 @ 2 RIR/)).toBeInTheDocument();
    });

    it('calls onExerciseNameClick when exercise name is clicked', async () => {
      const user = userEvent.setup();
      const onExerciseNameClick = jest.fn();

      render(<ExerciseCard {...defaultProps} onExerciseNameClick={onExerciseNameClick} />);

      await user.click(screen.getByText('Bench Press'));
      expect(onExerciseNameClick).toHaveBeenCalled();
    });
  });

  describe('One-tap set logging (SetLoggerRow)', () => {
    it('logs a set with prefilled suggestion values in exactly one tap', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('new-set-id');

      render(
        <ExerciseCard {...defaultProps} isActive={true} onSetComplete={onSetComplete} />
      );

      // Suggestion prefill: block target weight 60kg, mid of 8-12 = 10 reps,
      // default RIR chip = block target RIR (2). One tap:
      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledTimes(1);
      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 60,
          reps: 10,
          rpe: 7.5, // rirToRpe(2)
          setType: 'normal',
          feedback: expect.objectContaining({ repsInTank: 2, form: 'clean' }),
        })
      );
    });

    it('changing the RIR chip changes the logged RIR and derived RPE', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('new-set-id');

      render(
        <ExerciseCard {...defaultProps} isActive={true} onSetComplete={onSetComplete} />
      );

      await user.click(screen.getByRole('button', { name: '0 reps in reserve (maxed)' }));
      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          rpe: 10, // rirToRpe(0)
          feedback: expect.objectContaining({ repsInTank: 0 }),
        })
      );
    });

    it('pre-selects the calibration-adjusted RIR chip when provided', async () => {
      render(
        <ExerciseCard
          {...defaultProps}
          isActive={true}
          adjustedRir={{
            prescribedRIR: 0,
            internalTargetRIR: 2,
            hasAdjustment: true,
            adjustmentReason: 'you tend to stop 2 reps early',
          }}
        />
      );

      expect(screen.getByRole('button', { name: '0 reps in reserve (maxed)' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('weight stepper respects the exercise minWeightIncrementKg', async () => {
      const user = userEvent.setup();

      render(
        <ExerciseCard
          {...defaultProps}
          exercise={createMockExercise({ minWeightIncrementKg: 2.5 })}
          isActive={true}
          onSetComplete={jest.fn().mockResolvedValue('id')}
        />
      );

      // Prefilled 60 kg; one + tap steps by exactly 2.5 kg
      await user.click(screen.getByRole('button', { name: 'Increase weight' }));
      expect(
        screen.getByRole('button', { name: /Weight: 62\.5 kg/ })
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Decrease weight' }));
      expect(screen.getByRole('button', { name: /Weight: 60 kg/ })).toBeInTheDocument();
    });

    it('reps stepper adjusts reps by one', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('id');

      render(
        <ExerciseCard {...defaultProps} isActive={true} onSetComplete={onSetComplete} />
      );

      await user.click(screen.getByRole('button', { name: 'Increase reps' }));
      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({ reps: 11 })
      );
    });

    it('preserves the exact previous-set weight when seeding (no plate rounding)', () => {
      render(
        <ExerciseCard
          {...defaultProps}
          unit="lb"
          isActive={true}
          previousSets={[{ weightKg: 100, reps: 10 }]}
          onSetComplete={jest.fn().mockResolvedValue('id')}
        />
      );

      // 100 kg = 220.5 lb exact (convertWeightForDisplay), NOT 220 (plate-rounded)
      expect(
        screen.getByRole('button', { name: /Weight: 220\.5 lbs/ })
      ).toBeInTheDocument();
    });

    it('keeps showing the AI suggestion in the banner after the user edits the weight input', async () => {
      const user = userEvent.setup();

      // 100 kg × 10 @ RPE 8 (2 RIR) exactly matches the 8-12 @ 2 RIR target,
      // so the recommender holds 100 kg and predicts 9 reps for the next set.
      const sets = [
        createMockSetLog({ id: 'set-1', setNumber: 1, weightKg: 100, reps: 10, rpe: 8 }),
      ];

      render(
        <ExerciseCard
          {...defaultProps}
          sets={sets}
          isActive={true}
          onSetComplete={jest.fn().mockResolvedValue('id')}
        />
      );

      expect(screen.getByText(/100 kg × 9 @ 2 RIR/)).toBeInTheDocument();

      // Type a completely different weight into the logger input
      await user.click(screen.getByRole('button', { name: /Weight: 100 kg/ }));
      const weightInput = screen.getByRole('spinbutton', { name: 'Weight' });
      await user.clear(weightInput);
      await user.type(weightInput, '999');

      // The logger reflects the edit, but the banner must NOT echo it —
      // it keeps showing what the recommender actually suggested.
      expect(weightInput).toHaveValue(999);
      expect(screen.getByText(/100 kg × 9 @ 2 RIR/)).toBeInTheDocument();
      expect(screen.queryByText(/999 kg ×/)).not.toBeInTheDocument();
    });

    it('shows the suggestion banner with a reason', () => {
      render(<ExerciseCard {...defaultProps} isActive={true} />);
      // No history and a target weight -> profile-based starting point reason
      expect(screen.getByText(/starting point estimated/)).toBeInTheDocument();
    });

    it('surfaces the readiness easing in the suggestion reason', () => {
      render(
        <ExerciseCard
          {...defaultProps}
          isActive={true}
          readinessModulation={{
            rirDelta: 1,
            suggestSetReduction: false,
            banner: 'Adjusted for readiness — leaving one extra rep in reserve today',
          }}
        />
      );

      expect(screen.getByText(/eased for readiness/)).toBeInTheDocument();
      // Target RIR 2 + readiness delta 1 -> chip 3 pre-selected
      expect(screen.getByRole('button', { name: '3 reps in reserve (easy)' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  });

  describe('Bodyweight support', () => {
    const bodyweightProps = {
      ...defaultProps,
      exercise: createMockExercise({
        id: 'pullup-1',
        name: 'Pull-ups',
        primaryMuscle: 'back',
        equipmentRequired: ['bodyweight'],
      }),
      userBodyweightKg: 80,
      isActive: true,
    };

    it('logs plain bodyweight sets with effectiveLoadKg = bodyweight', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('id');

      render(<ExerciseCard {...bodyweightProps} onSetComplete={onSetComplete} />);

      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 80,
          bodyweightData: expect.objectContaining({
            userBodyweightKg: 80,
            modification: 'none',
            effectiveLoadKg: 80,
          }),
        })
      );
    });

    it('weighted mode computes effectiveLoadKg = bodyweight + added load', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('id');

      render(<ExerciseCard {...bodyweightProps} onSetComplete={onSetComplete} />);

      // Switch to weighted mode via the segmented control
      await user.click(screen.getByRole('button', { name: 'Weighted' }));
      // Step the added load up by the exercise increment (2.5 kg)
      await user.click(screen.getByRole('button', { name: 'Increase weight' }));
      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 82.5,
          bodyweightData: expect.objectContaining({
            userBodyweightKg: 80,
            modification: 'weighted',
            addedWeightKg: 2.5,
            effectiveLoadKg: 82.5,
          }),
        })
      );
    });

    it('assisted mode computes effectiveLoadKg = bodyweight - assistance', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('id');

      render(<ExerciseCard {...bodyweightProps} onSetComplete={onSetComplete} />);

      await user.click(screen.getByRole('button', { name: 'Assisted' }));
      await user.click(screen.getByRole('button', { name: 'Increase weight' }));
      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 77.5,
          bodyweightData: expect.objectContaining({
            userBodyweightKg: 80,
            modification: 'assisted',
            assistanceWeightKg: 2.5,
            effectiveLoadKg: 77.5,
          }),
        })
      );
    });
  });

  describe('Feedback sheet (absorbs SetFeedbackCard)', () => {
    it('round-trips form rating and discomfort into the logged feedback', async () => {
      const user = userEvent.setup();
      const onSetComplete = jest.fn().mockResolvedValue('id');

      render(
        <ExerciseCard {...defaultProps} isActive={true} onSetComplete={onSetComplete} />
      );

      // Open the feedback sheet from the note icon
      await user.click(screen.getByRole('button', { name: 'Add set feedback' }));

      // Form rating
      await user.click(screen.getByText('Some Breakdown'));

      // Discomfort: expand, pick body part + severity, save
      await user.click(screen.getByText(/Log discomfort/));
      await user.click(screen.getByText('Lower Back'));
      await user.click(screen.getByText('Twinge'));
      await user.click(screen.getByText('Save Discomfort'));

      // Close the sheet and log the set
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await user.click(screen.getByRole('button', { name: 'Log set' }));

      expect(onSetComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: expect.objectContaining({
            form: 'some_breakdown',
            discomfort: expect.objectContaining({
              bodyPart: 'lower_back',
              severity: 'twinge',
            }),
          }),
        })
      );
    });
  });

  describe('Completed and pending set lines', () => {
    it('renders completed sets as compact lines with RIR and quality', () => {
      const sets = [
        createMockSetLog({ id: 'set-1', setNumber: 1, weightKg: 100, reps: 10, rpe: 8, quality: 'stimulative' }),
      ];

      render(<ExerciseCard {...defaultProps} sets={sets} isActive={true} />);

      expect(screen.getByText(/Set 1 · 100 kg × 10/)).toBeInTheDocument();
      // rpeToRir(8) = 2
      expect(screen.getByText(/2 RIR ·/)).toBeInTheDocument();
      expect(screen.getByText('stimulative')).toBeInTheDocument();
    });

    it('shows the logged RIR from feedback, not the lossy RPE-derived bucket', () => {
      // RIR 3 is stored as RPE 7; bucketed rpeToRir(7) = 2, so the display
      // must prefer feedback.repsInTank or a logged 3 renders as 2.
      const sets = [
        createMockSetLog({
          id: 'set-1',
          setNumber: 1,
          weightKg: 100,
          reps: 10,
          rpe: 7,
          quality: 'effective',
          feedback: { repsInTank: 3, form: 'clean' },
        }),
      ];

      render(<ExerciseCard {...defaultProps} sets={sets} isActive={true} />);

      expect(screen.getByText(/3 RIR ·/)).toBeInTheDocument();
    });

    it('renders remaining sets as muted target lines', () => {
      render(<ExerciseCard {...defaultProps} isActive={true} />);

      // Active set 1 is the logger; sets 2 and 3 are pending lines
      expect(screen.getAllByText(/60 kg × 8–12 target/)).toHaveLength(2);
    });
  });

  describe('Plateau badge (plateauDetector)', () => {
    it('shows the plateau pill when detectPlateau fires and opens the sheet', async () => {
      const user = userEvent.setup();
      const onRepRangeChange = jest.fn();
      const onExerciseSwap = jest.fn();

      render(
        <ExerciseCard
          {...defaultProps}
          performanceSnapshots={plateauedSnapshots}
          onRepRangeChange={onRepRangeChange}
          onExerciseSwap={onExerciseSwap}
        />
      );

      const pill = screen.getByRole('button', { name: 'Plateau' });
      await user.click(pill);

      expect(screen.getByText('Plateau detected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Swap exercise' })).toBeInTheDocument();

      // One-tap rep-range action parsed from the suggestions
      await user.click(screen.getByRole('button', { name: /Try 5–6 reps/ }));
      expect(onRepRangeChange).toHaveBeenCalledWith([5, 6]);
    });

    it('reseeds the untouched logger prefill when the one-tap rep range is applied', async () => {
      const user = userEvent.setup();
      const onRepRangeChange = jest.fn();

      render(
        <ExerciseCard
          {...defaultProps}
          isActive={true}
          performanceSnapshots={plateauedSnapshots}
          onRepRangeChange={onRepRangeChange}
          previousSets={[{ weightKg: 100, reps: 10 }]}
          onSetComplete={jest.fn().mockResolvedValue('id')}
        />
      );

      // Seeded from the previous session: 100 kg × 10 (inside the 8-12 target)
      expect(screen.getByRole('button', { name: /Weight: 100 kg/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reps: 10/ })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Plateau' }));
      await user.click(screen.getByRole('button', { name: /Try 5–6 reps/ }));

      expect(onRepRangeChange).toHaveBeenCalledWith([5, 6]);
      // With no completed sets the reseed effects never fire, so the button
      // itself must reprice the prefill: 100×10 @ 2 RIR → E1RM 140 kg, and
      // 140 / (1 + (6+2)/30) ≈ 110.5 → 110 at the 2.5 kg increment.
      expect(screen.getByRole('button', { name: /Weight: 110 kg/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reps: 6/ })).toBeInTheDocument();
    });

    it('reprices from the logged RPE when the previous set has one', async () => {
      const user = userEvent.setup();

      render(
        <ExerciseCard
          {...defaultProps}
          isActive={true}
          performanceSnapshots={plateauedSnapshots}
          onRepRangeChange={jest.fn()}
          previousSets={[{ weightKg: 100, reps: 10, rpe: 10 }]}
          onSetComplete={jest.fn().mockResolvedValue('id')}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Plateau' }));
      await user.click(screen.getByRole('button', { name: /Try 5–6 reps/ }));

      // 10 reps is an unambiguous overshoot of the new 5-6 range, which wins
      // over the near-failure RIR reading: the switch reprices UP off the
      // logged E1RM. 100×10 at RPE 10 (0 RIR) → E1RM 133.3 kg, not the 140 the
      // target-RIR fallback would assume: 133.3 / (1 + (6+2)/30) ≈ 105.3 → 105.
      expect(screen.getByRole('button', { name: /Weight: 105 kg/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reps: 6/ })).toBeInTheDocument();
    });

    it('keeps a zero-load seed at zero when repriced into the new range', async () => {
      const user = userEvent.setup();

      render(
        <ExerciseCard
          {...defaultProps}
          isActive={true}
          performanceSnapshots={plateauedSnapshots}
          onRepRangeChange={jest.fn()}
          previousSets={[{ weightKg: 0, reps: 10 }]}
          onSetComplete={jest.fn().mockResolvedValue('id')}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Plateau' }));
      await user.click(screen.getByRole('button', { name: /Try 5–6 reps/ }));

      // Zero-load history must not be floored up to the 2.5 kg increment, and
      // with no weight lever the reps must follow the switched range instead
      // of repeating the out-of-range 10.
      expect(screen.getByRole('button', { name: /Weight: 0 kg/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reps: 6/ })).toBeInTheDocument();
    });

    it('hides the one-tap rep-range button when the block already uses that range', async () => {
      const user = userEvent.setup();

      render(
        <ExerciseCard
          {...defaultProps}
          block={createMockBlock({ targetRepRange: [5, 6] as [number, number] })}
          performanceSnapshots={plateauedSnapshots}
          onRepRangeChange={jest.fn()}
          onExerciseSwap={jest.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Plateau' }));

      expect(screen.getByText('Plateau detected')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Try 5–6 reps/ })).not.toBeInTheDocument();
      // Swap remains available as the actionable follow-up
      expect(screen.getByRole('button', { name: 'Swap exercise' })).toBeInTheDocument();
    });

    it('does not show the plateau pill without enough history', () => {
      render(
        <ExerciseCard
          {...defaultProps}
          performanceSnapshots={plateauedSnapshots.slice(0, 2)}
        />
      );

      expect(screen.queryByRole('button', { name: 'Plateau' })).not.toBeInTheDocument();
    });
  });

  describe('Progression pace pill', () => {
    /** Five weekly sessions gaining ~1% E1RM/week — well ahead of the
     *  intermediate expectation (0.3%/wk) used when no user is in the store. */
    const progressingSnapshots: ExercisePerformanceSnapshot[] = [0, 1, 2, 3, 4].map((i) =>
      createSnapshot({
        id: `p${i}`,
        sessionDate: weeksAgo(4 - i),
        estimatedE1RM: Math.round(120 * Math.pow(1.01, i) * 10) / 10,
        topSetWeightKg: 100 + i * 2.5,
      })
    );

    it('shows the Ahead pill for a lift progressing faster than expected', () => {
      render(
        <ExerciseCard {...defaultProps} performanceSnapshots={progressingSnapshots} />
      );
      expect(screen.getByText(/Ahead/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Plateau' })).not.toBeInTheDocument();
    });

    it('suppresses the pace pill when the plateau badge is showing', () => {
      render(
        <ExerciseCard {...defaultProps} performanceSnapshots={plateauedSnapshots} />
      );
      expect(screen.getByRole('button', { name: 'Plateau' })).toBeInTheDocument();
      expect(screen.queryByText(/Ahead/)).not.toBeInTheDocument();
      expect(screen.queryByText('On track')).not.toBeInTheDocument();
      expect(screen.queryByText(/Behind/)).not.toBeInTheDocument();
    });

    it('shows no pace pill without enough history', () => {
      render(
        <ExerciseCard
          {...defaultProps}
          performanceSnapshots={progressingSnapshots.slice(0, 2)}
        />
      );
      expect(screen.queryByText(/Ahead/)).not.toBeInTheDocument();
      expect(screen.queryByText('On track')).not.toBeInTheDocument();
    });
  });

  describe('Rest Timer Integration', () => {
    it('renders the inline timer while active and resting', () => {
      render(
        <ExerciseCard
          {...defaultProps}
          isActive={true}
          showRestTimer={true}
          timerSeconds={120}
          timerInitialSeconds={180}
          timerIsRunning={true}
        />
      );

      expect(screen.getByTestId('inline-rest-timer')).toBeInTheDocument();
    });
  });

  describe('Exercise Swap', () => {
    it('shows swap modal when triggered with showSwapOnMount', () => {
      const availableExercises = [
        createMockExercise({ id: 'ex-2', name: 'Incline Bench Press' }),
        createMockExercise({ id: 'ex-3', name: 'Dumbbell Press' }),
      ];

      render(
        <ExerciseCard
          {...defaultProps}
          availableExercises={availableExercises}
          showSwapOnMount={true}
        />
      );

      expect(screen.getByText(/swap exercise/i)).toBeInTheDocument();
    });
  });
});
