'use client';

import { useState, useMemo } from 'react';
import { Button, Card, Badge } from '@/components/ui';
import type {
  WorkoutSession,
  SetLog,
  ExerciseBlock,
  WeightUnit,
  FormRating,
  StandardMuscleGroup,
  PumpRating0to3,
  WorkloadRating,
  JointPainJoint,
} from '@/types/schema';
import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  DETAILED_TO_STANDARD_MAP,
  isDetailedMuscle,
  isStandardMuscle,
  legacyToStandardMuscles,
  JOINT_PAIN_JOINTS,
} from '@/types/schema';
import { getJointDisplayName } from '@/services/discomfortTracker';
import {
  formatWorkoutDuration,
  estimateE1RM,
  deriveWorkoutLabel,
  muscleDisplayName,
  resolveWorkoutDurationSeconds,
} from '@/lib/utils';
import { getCalibrationVerdict, type CalibrationMethod } from '@/services/rpeCalibration';
import type { ShareExercise, WorkoutShareTextInput } from '@/services/workoutShareText';
import { ShareWorkoutText } from './ShareWorkoutText';

/**
 * Per-muscle end-of-session feedback captured on the finish card.
 * Pump capture is moving to per-exercise in-workout prompts (subjective-
 * feedback ticket) — the finish card no longer asks for it, so `pump` is
 * optional and only present on legacy payloads.
 */
export interface SessionMuscleFeedbackEntry {
  muscleGroup: StandardMuscleGroup;
  pump?: PumpRating0to3;
  workload: WorkloadRating;
}

const WORKLOAD_CHIP_OPTIONS: { value: WorkloadRating; label: string }[] = [
  { value: 0, label: 'Too easy' },
  { value: 1, label: 'Just right' },
  { value: 2, label: 'Pushed it' },
  { value: 3, label: 'Too much' },
];

const DEFAULT_WORKLOAD: WorkloadRating = 1;

/** Resolve a raw primaryMuscle string (detailed/standard/legacy) to a StandardMuscleGroup. */
function resolveStandardMuscle(raw: string | undefined): StandardMuscleGroup | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (isDetailedMuscle(lower)) return DETAILED_TO_STANDARD_MAP[lower];
  if (isStandardMuscle(lower)) return lower;
  const legacy = legacyToStandardMuscles(lower);
  return legacy.length > 0 ? legacy[0] : null;
}

interface ExerciseWithHistory {
  exerciseId: string;
  exerciseName: string;
  previousBest?: {
    weight: number;
    reps: number;
    e1rm: number;
  };
}

interface AMRAPCalibration {
  exerciseName: string;
  /** Fatigue-adjusted expectation on 'fatigue_adjusted_v2' records; naive on legacy rows. */
  predictedMaxReps: number;
  actualMaxReps: number;
  bias: number;
  biasInterpretation: string;
  confidenceLevel: 'low' | 'medium' | 'high';
  lastCalibrated: Date;
  dataPoints: number;
  rawPredictedMaxReps?: number;
  method?: CalibrationMethod;
  exerciseId?: string;
  weightKg: number;
}

export interface SessionSummarySubmitData {
  sessionRpe: number;
  notes: string;
  /** Per-muscle workload chips (default 1 "Just right" submits as-is when untouched). */
  muscleFeedback: SessionMuscleFeedbackEntry[];
  /** Whether the user marked this as a deload session. */
  isDeload: boolean;
  /**
   * "Any joint issues today?" — the only place joint pain is proactively
   * asked, once per session. null = not answered (skipped).
   */
  jointReport: { severity: 'minor' | 'significant'; joints: JointPainJoint[] } | null;
}

interface SessionSummaryProps {
  session: WorkoutSession;
  exerciseBlocks: ExerciseBlock[];
  /** Blocks the user skipped entirely — omitted from the text share. */
  skippedBlocks?: ExerciseBlock[];
  allSets: SetLog[];
  exerciseHistories?: Record<string, ExerciseWithHistory>;
  amrapCalibrations?: AMRAPCalibration[];
  enhancedAthleteMode?: boolean;
  unit?: WeightUnit;
  /**
   * Frozen workout duration in seconds, snapshotted once at finish (excludes
   * paused time). The summary renders THIS — never a live clock. Omit only for
   * legacy completed sessions with no snapshot; then the wall-clock span
   * (completedAt - startedAt) is used as a fallback.
   */
  durationSeconds?: number | null;
  onSubmit?: (data: SessionSummarySubmitData) => void;
  /**
   * Save with the same payload as onSubmit, but land on this workout's full
   * report (the read-only analytics view) instead of the dashboard. Drives
   * the "View full report →" link and the noteworthy PR/calibration chip.
   */
  onSaveAndViewReport?: (data: SessionSummarySubmitData) => void;
  /**
   * Per-muscle seed from the in-workout per-exercise pump/workload chips.
   * Workload answers pre-fill the finish card's workload chips; pump answers
   * (no longer asked here) ride the submit payload so the learner still
   * receives them through session_muscle_feedback.
   */
  initialMuscleRatings?: Partial<
    Record<StandardMuscleGroup, { pump?: PumpRating0to3; workload?: WorkloadRating }>
  >;
  readOnly?: boolean;
}

// Convert kg to lbs
const kgToLbs = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;

// Estimate calories burned (rough estimate based on duration, sets, and intensity)
function estimateCaloriesBurned(durationMinutes: number, totalSets: number, avgRpe: number): number {
  // Base rate: ~5-8 cal/min for weight training
  const baseRate = 5 + (avgRpe / 10) * 3; // Higher RPE = more calories
  const setBonus = totalSets * 3; // ~3 extra calories per set
  return Math.round(durationMinutes * baseRate + setBonus);
}

export function SessionSummary({
  session,
  exerciseBlocks,
  skippedBlocks = [],
  allSets,
  exerciseHistories,
  amrapCalibrations = [],
  enhancedAthleteMode,
  unit = 'kg',
  durationSeconds,
  onSubmit,
  onSaveAndViewReport,
  initialMuscleRatings,
  readOnly = false,
}: SessionSummaryProps) {
  // Helper to display weight in user's preferred unit
  const displayWeight = (kg: number, decimals: number = 0) => {
    if (unit === 'lb') {
      const lbs = kgToLbs(kg);
      return decimals > 0 ? lbs.toFixed(decimals) : Math.round(lbs);
    }
    return decimals > 0 ? kg.toFixed(decimals) : Math.round(kg);
  };

  const weightUnit = unit === 'lb' ? 'lbs' : 'kg';

  // Duration blocks store SECONDS in each set's reps field — they contribute
  // sets (and hold time) but never rep counts or tonnage.
  const durationBlockIds = new Set(
    exerciseBlocks
      .filter(
        (b) =>
          (b as ExerciseBlock & { exercise?: { exerciseType?: string } }).exercise?.exerciseType ===
          'duration_based'
      )
      .map((b) => b.id)
  );
  const isDurationSet = (s: SetLog) => durationBlockIds.has(s.exerciseBlockId);

  // Calculate stats (before state hooks — the set-derived average seeds the
  // session-RPE prefill).
  const workingSets = allSets.filter((s) => !s.isWarmup);
  const totalSets = workingSets.length;
  const totalReps = workingSets.reduce((sum, s) => sum + (isDurationSet(s) ? 0 : s.reps), 0);
  const totalVolume = workingSets.reduce(
    (sum, s) => sum + (isDurationSet(s) ? 0 : s.weightKg * s.reps),
    0
  );
  const avgRpe = totalSets > 0
    ? Math.round((workingSets.reduce((sum, s) => sum + s.rpe, 0) / totalSets) * 10) / 10
    : 0;

  // Session RPE prefill: stored value first (completed sessions), otherwise
  // the computed set average. The user's manual pick sticks — this only seeds
  // the initial state.
  const prefillSessionRpe = session.sessionRpe
    ?? (totalSets > 0 ? Math.min(10, Math.max(1, Math.round(avgRpe))) : 7);
  const [sessionRpe, setSessionRpe] = useState(prefillSessionRpe);
  const [notes, setNotes] = useState(session.sessionNotes || '');
  // Notes stay collapsed to a "+ Add note" line unless the session already has
  // notes (e.g. resumed finish).
  const [notesOpen, setNotesOpen] = useState(!!session.sessionNotes);
  // "This was a deload session" — seeded from the stored flag (auto-set for
  // programmed deload weeks) so an already-flagged session shows the toggle on.
  // Drives PR suppression + the share tag live, and is persisted on submit.
  const [isDeload, setIsDeload] = useState<boolean>(session.isDeload ?? false);
  // Per-muscle workload overrides; muscles not in the map use the "Just right"
  // default. Seeded from the in-workout per-exercise chips so an answer given
  // on the exercise card is never re-asked here.
  const [muscleWorkloads, setMuscleWorkloads] = useState<
    Partial<Record<StandardMuscleGroup, WorkloadRating>>
  >(() => {
    if (!initialMuscleRatings) return {};
    const seeded: Partial<Record<StandardMuscleGroup, WorkloadRating>> = {};
    for (const [muscle, fb] of Object.entries(initialMuscleRatings)) {
      if (fb?.workload !== undefined) seeded[muscle as StandardMuscleGroup] = fb.workload;
    }
    return seeded;
  });
  // "Any joint issues today?" — null until the user taps a chip (skippable).
  const [jointIssueSeverity, setJointIssueSeverity] = useState<
    'none' | 'minor' | 'significant' | null
  >(null);
  const [jointIssueJoints, setJointIssueJoints] = useState<JointPainJoint[]>([]);
  const [showAllPRs, setShowAllPRs] = useState(false);
  const [showExerciseDetails, setShowExerciseDetails] = useState(true);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  // Guards against double-submits; navigation away happens right after
  // onSubmit, so the "Finishing…" state is only briefly visible.
  const [submitting, setSubmitting] = useState(false);

  // Duration is the frozen snapshot taken at finish (excludes paused time).
  // Never derived from Date.now(), so this screen shows a fixed value rather
  // than a live-ticking clock. Legacy completed sessions with no snapshot fall
  // back to the wall-clock span.
  const duration = resolveWorkoutDurationSeconds(
    durationSeconds,
    session.startedAt,
    session.completedAt
  );
  const durationMinutes = Math.round(duration / 60);

  // Estimated calories burned
  const caloriesBurned = estimateCaloriesBurned(durationMinutes, totalSets, avgRpe);

  // Set quality breakdown
  const qualityBreakdown = workingSets.reduce(
    (acc, set) => {
      acc[set.quality] = (acc[set.quality] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Calculate quality score (0-100)
  const qualityScore = useMemo(() => {
    if (totalSets === 0) return 0;
    const stimulative = qualityBreakdown.stimulative || 0;
    const effective = qualityBreakdown.effective || 0;
    const junk = qualityBreakdown.junk || 0;
    // Stimulative = 100pts, Effective = 75pts, Junk = 25pts, Excessive = 0pts
    const score = (stimulative * 100 + effective * 75 + junk * 25) / totalSets;
    return Math.round(score);
  }, [totalSets, qualityBreakdown]);

  // Detect Personal Records (PRs) - now incorporates form quality
  const personalRecords = useMemo(() => {
    const prs: {
      blockId: string;
      exerciseName: string;
      type: 'weight' | 'reps' | 'e1rm' | 'volume' | 'form' | 'duration';
      value: number;
      improvement: number;
      form?: FormRating;
      formNote?: string;
    }[] = [];

    // A deload session is intentionally light — no PR can fire from it, even if
    // reps happen to exceed a stale e1RM. Excluded so a light week never reads
    // as a record.
    if (isDeload) return prs;

    // Group sets by exercise
    const setsByExercise = new Map<string, SetLog[]>();
    workingSets.forEach((set) => {
      const block = exerciseBlocks.find((b) => b.id === set.exerciseBlockId);
      if (block) {
        const existing = setsByExercise.get(block.id) || [];
        existing.push(set);
        setsByExercise.set(block.id, existing);
      }
    });

    // Check each exercise for PRs
    exerciseBlocks.forEach((block) => {
      const sets = setsByExercise.get(block.id) || [];
      if (sets.length === 0) return;

      const history = exerciseHistories?.[block.exerciseId || ''];
      if (!history?.previousBest) return;

      const isDurationBlock = durationBlockIds.has(block.id);

      // Find best set this workout (considering form)
      let bestWeight = 0;
      let bestReps = 0;
      let bestE1RM = 0;
      let bestForm: FormRating = 'clean';

      sets.forEach((set) => {
        const setForm = set.feedback?.form || 'clean';

        // Skip ugly form sets for PR consideration
        if (setForm === 'ugly') return;

        if (set.weightKg > bestWeight) {
          bestWeight = set.weightKg;
          bestForm = setForm;
        }
        if (set.reps > bestReps) bestReps = set.reps;
        if (!isDurationBlock) {
          // e1RM is explicitly excluded for duration blocks: seconds through
          // Epley fabricate a 1RM.
          const e1rm = estimateE1RM(set.weightKg, set.reps);
          if (e1rm > bestE1RM) bestE1RM = e1rm;
        }
      });

      const exerciseName = (block as any).exercise?.name || 'Exercise';

      // No PR if best set had ugly form
      const hasUglyBestSet = sets.some(
        (s) => s.weightKg === bestWeight && s.feedback?.form === 'ugly'
      );
      if (hasUglyBestSet) {
        // Could add a "potential PR" note here if desired
        return;
      }

      // Duration exercise: the record is max seconds at (>=) weight — never
      // e1RM/reps. bestReps carries SECONDS here.
      if (isDurationBlock) {
        if (bestWeight > history.previousBest.weight) {
          prs.push({
            blockId: block.id,
            exerciseName,
            type: 'weight',
            value: bestWeight,
            improvement: Math.round(
              ((bestWeight - history.previousBest.weight) / history.previousBest.weight) * 100
            ),
            form: bestForm,
            formNote: bestForm === 'clean' ? 'Clean form' : 'Some breakdown',
          });
        } else if (
          bestReps > history.previousBest.reps &&
          bestWeight >= history.previousBest.weight * 0.95
        ) {
          prs.push({
            blockId: block.id,
            exerciseName,
            type: 'duration',
            value: bestReps,
            improvement: bestReps - history.previousBest.reps,
            form: bestForm,
            formNote: bestForm === 'clean' ? 'Clean form' : 'Some breakdown',
          });
        }
        return;
      }

      // Check for E1RM PR (most meaningful)
      if (bestE1RM > history.previousBest.e1rm) {
        prs.push({
          blockId: block.id,
          exerciseName,
          type: 'e1rm',
          value: bestE1RM,
          improvement: Math.round(
            ((bestE1RM - history.previousBest.e1rm) / history.previousBest.e1rm) * 100
          ),
          form: bestForm,
          formNote: bestForm === 'clean' ? 'Clean form' : 'Some breakdown',
        });
      }
      // Check for weight PR
      else if (bestWeight > history.previousBest.weight) {
        prs.push({
          blockId: block.id,
          exerciseName,
          type: 'weight',
          value: bestWeight,
          improvement: Math.round(
            ((bestWeight - history.previousBest.weight) / history.previousBest.weight) * 100
          ),
          form: bestForm,
          formNote: bestForm === 'clean' ? 'Clean form' : 'Some breakdown',
        });
      }
      // Check for reps PR (at same or higher weight)
      else if (bestReps > history.previousBest.reps && bestWeight >= history.previousBest.weight * 0.95) {
        prs.push({
          blockId: block.id,
          exerciseName,
          type: 'reps',
          value: bestReps,
          improvement: bestReps - history.previousBest.reps,
          form: bestForm,
          formNote: bestForm === 'clean' ? 'Clean form' : 'Some breakdown',
        });
      }
    });

    return prs;
  }, [workingSets, exerciseBlocks, exerciseHistories, isDeload]);

  // Wordle-style text share input (performed order; the formatter drops
  // skipped blocks so the share shows only performed work)
  const shareInput = useMemo<Omit<WorkoutShareTextInput, 'cryptic'>>(() => {
    const entries: { order: number; exercise: ShareExercise }[] = [];

    exerciseBlocks.forEach((block) => {
      const exercise = (block as any).exercise;
      const name = exercise?.name || 'Exercise';
      const sets = workingSets.filter((s) => s.exerciseBlockId === block.id);
      const amrap = amrapCalibrations.find((c) =>
        c.exerciseId ? c.exerciseId === block.exerciseId : c.exerciseName === name
      );
      // The AMRAP set is the last performed set matching the calibration record.
      const amrapIndex = amrap
        ? sets.map((s) => s.weightKg === amrap.weightKg && s.reps === amrap.actualMaxReps).lastIndexOf(true)
        : -1;

      entries.push({
        order: block.order,
        exercise: {
          name,
          primaryMuscle: exercise?.primaryMuscle,
          targetSets: block.targetSets,
          skipped: sets.length === 0,
          // Match by block, not name — the same exercise can appear in
          // multiple blocks and only the record-setting one gets the 🏆.
          hasPR: personalRecords.some((pr) => pr.blockId === block.id),
          isDuration: durationBlockIds.has(block.id),
          sets: sets.map((set, index) => ({
            reps: set.reps,
            weightKg: set.weightKg,
            rpe: set.rpe,
            isDropset: set.setType === 'dropset',
            isAmrap: index === amrapIndex,
          })),
        },
      });
    });

    skippedBlocks.forEach((block) => {
      const exercise = (block as any).exercise;
      entries.push({
        order: block.order,
        exercise: {
          name: exercise?.name || 'Exercise',
          primaryMuscle: exercise?.primaryMuscle,
          targetSets: block.targetSets,
          skipped: true,
          sets: [],
        },
      });
    });

    entries.sort((a, b) => a.order - b.order);

    const performedMuscles = exerciseBlocks
      .filter((block) => workingSets.some((s) => s.exerciseBlockId === block.id))
      .map((block) => (block as any).exercise?.primaryMuscle)
      .filter((m): m is string => !!m);

    const completedDate = session.completedAt ? new Date(session.completedAt) : new Date();

    const dateLabel = completedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    return {
      title: deriveWorkoutLabel(performedMuscles),
      // Tag deload sessions so a light week doesn't read as a failed week to
      // the group chat.
      subtitle: isDeload ? `${dateLabel} · Deload` : dateLabel,
      exercises: entries.map((e) => e.exercise),
      durationSeconds: duration,
      unit,
    };
  }, [
    exerciseBlocks,
    skippedBlocks,
    workingSets,
    amrapCalibrations,
    personalRecords,
    session.completedAt,
    duration,
    unit,
    isDeload,
  ]);

  // Volume by muscle group (muscles with zero logged sets are dropped — a
  // skipped exercise must not render an empty 0-set row).
  const volumeByMuscle = useMemo(() => {
    const volumes: Record<string, { sets: number; volume: number }> = {};

    exerciseBlocks.forEach(block => {
      const sets = workingSets.filter(s => s.exerciseBlockId === block.id);
      if (sets.length === 0) return;
      const muscle = (block as any).exercise?.primaryMuscle || 'other';

      if (!volumes[muscle]) {
        volumes[muscle] = { sets: 0, volume: 0 };
      }

      sets.forEach(set => {
        volumes[muscle].sets += 1;
        // Duration sets count toward the muscle's set tally, never tonnage.
        if (!durationBlockIds.has(block.id)) {
          volumes[muscle].volume += set.weightKg * set.reps;
        }
      });
    });

    // Sort by volume
    return Object.entries(volumes)
      .map(([muscle, data]) => ({ muscle, ...data }))
      .filter((entry) => entry.sets > 0)
      .sort((a, b) => b.volume - a.volume);
  }, [exerciseBlocks, workingSets]);

  // Intensity distribution (RPE breakdown)
  const rpeDistribution = useMemo(() => {
    const distribution = { easy: 0, moderate: 0, hard: 0, maximal: 0 };
    workingSets.forEach(set => {
      if (set.rpe <= 6) distribution.easy++;
      else if (set.rpe <= 7) distribution.moderate++;
      else if (set.rpe <= 8) distribution.hard++;
      else distribution.maximal++;
    });
    return distribution;
  }, [workingSets]);

  // Effort timeline (RPE per set in order)
  const effortTimeline = useMemo(() => {
    return workingSets.map((set, index) => ({
      setNumber: index + 1,
      rpe: set.rpe,
      exercise: exerciseBlocks.find(b => b.id === set.exerciseBlockId),
    }));
  }, [workingSets, exerciseBlocks]);

  // Exercise details with sets
  const exerciseDetails = useMemo(() => {
    return exerciseBlocks.map(block => {
      const exercise = (block as any).exercise;
      const sets = workingSets.filter(s => s.exerciseBlockId === block.id);
      const warmupSets = allSets.filter(s => s.exerciseBlockId === block.id && s.isWarmup);

      const isDuration = durationBlockIds.has(block.id);

      // Calculate stats for this exercise. Duration sets: reps carry seconds —
      // no tonnage, no e1RM; maxReps is the longest hold.
      const totalVolume = isDuration
        ? 0
        : sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
      const maxWeight = sets.length > 0 ? Math.max(...sets.map(s => s.weightKg)) : 0;
      const maxReps = sets.length > 0 ? Math.max(...sets.map(s => s.reps)) : 0;
      const avgRpe = sets.length > 0
        ? Math.round((sets.reduce((sum, s) => sum + s.rpe, 0) / sets.length) * 10) / 10
        : 0;
      const bestE1RM = !isDuration && sets.length > 0
        ? Math.max(...sets.map(s => estimateE1RM(s.weightKg, s.reps)))
        : 0;

      // Check if this exercise had a PR (never on a deload session). Duration
      // blocks defer to the modality-aware personalRecords list.
      const history = exerciseHistories?.[block.exerciseId || ''];
      const hasPR = isDuration
        ? personalRecords.some((pr) => pr.blockId === block.id)
        : !isDeload && history?.previousBest && bestE1RM > history.previousBest.e1rm;

      return {
        blockId: block.id,
        exerciseId: block.exerciseId,
        name: exercise?.name || 'Unknown Exercise',
        muscle: exercise?.primaryMuscle || 'other',
        isDuration,
        sets,
        warmupSets,
        totalVolume,
        maxWeight,
        maxReps,
        avgRpe,
        bestE1RM,
        hasPR,
        targetSets: block.targetSets,
        targetRepsMin: (block as any).targetRepsMin,
        targetRepsMax: (block as any).targetRepsMax,
      };
    }).filter(e => e.sets.length > 0); // Only show exercises with completed sets
  }, [exerciseBlocks, workingSets, allSets, exerciseHistories, isDeload, personalRecords]);

  // Muscles trained this session (blocks with at least one working set),
  // resolved to standard muscle groups — drives the per-muscle workload chips.
  const trainedMuscles = useMemo<StandardMuscleGroup[]>(() => {
    const seen = new Set<StandardMuscleGroup>();
    const muscles: StandardMuscleGroup[] = [];
    exerciseBlocks.forEach((block) => {
      const hasWorkingSets = workingSets.some((s) => s.exerciseBlockId === block.id);
      if (!hasWorkingSets) return;
      const raw = (block as ExerciseBlock & { exercise?: { primaryMuscle?: string } })
        .exercise?.primaryMuscle;
      const muscle = resolveStandardMuscle(raw);
      if (muscle && !seen.has(muscle)) {
        seen.add(muscle);
        muscles.push(muscle);
      }
    });
    return muscles;
  }, [exerciseBlocks, workingSets]);

  const getMuscleWorkload = (muscle: StandardMuscleGroup): WorkloadRating =>
    muscleWorkloads[muscle] ?? DEFAULT_WORKLOAD;

  const toggleExerciseExpanded = (blockId: string) => {
    setExpandedExercises(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  const buildSubmitData = (): SessionSummarySubmitData => ({
    sessionRpe,
    notes,
    // Pump is captured per-exercise in-workout (not asked here); a rolled-up
    // answer rides that muscle's entry so the learner still receives it. The
    // key is omitted entirely when nothing was rated.
    muscleFeedback: trainedMuscles.map((muscle) => {
      const pump = initialMuscleRatings?.[muscle]?.pump;
      return {
        muscleGroup: muscle,
        ...(pump !== undefined ? { pump } : {}),
        workload: getMuscleWorkload(muscle),
      };
    }),
    isDeload,
    jointReport:
      jointIssueSeverity === 'minor' || jointIssueSeverity === 'significant'
        ? { severity: jointIssueSeverity, joints: jointIssueJoints }
        : null,
  });

  const handleSubmit = () => {
    if (onSubmit && !submitting) {
      setSubmitting(true);
      onSubmit(buildSubmitData());
    }
  };

  const handleSaveAndViewReport = () => {
    if (onSaveAndViewReport && !submitting) {
      setSubmitting(true);
      onSaveAndViewReport(buildSubmitData());
    }
  };

  // Compact single-row stat strip: sets · reps · duration · volume · kcal.
  // The one place session totals render on either layer.
  const statStrip = (
    <Card data-testid="session-stat-strip" className="!p-3">
      <div className="flex items-stretch justify-between divide-x divide-surface-800 text-center">
        <div className="flex-1 px-1">
          <p className="text-lg font-bold text-primary-400 leading-tight">{totalSets}</p>
          <p className="text-[11px] text-surface-500">Sets</p>
        </div>
        <div className="flex-1 px-1">
          <p className="text-lg font-bold text-primary-400 leading-tight">{totalReps}</p>
          <p className="text-[11px] text-surface-500">Reps</p>
        </div>
        <div className="flex-1 px-1">
          <p className="text-lg font-bold text-primary-400 leading-tight">
            {formatWorkoutDuration(duration)}
          </p>
          <p className="text-[11px] text-surface-500">Duration</p>
        </div>
        <div className="flex-1 px-1">
          <p className="text-lg font-bold text-blue-400 leading-tight">
            {(() => {
              const vol = unit === 'lb' ? kgToLbs(totalVolume) : totalVolume;
              return vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : Math.round(vol);
            })()}
          </p>
          <p className="text-[11px] text-surface-500">Vol ({weightUnit})</p>
        </div>
        <div className="flex-1 px-1">
          <p className="text-lg font-bold text-orange-400 leading-tight">{caloriesBurned}</p>
          <p className="text-[11px] text-surface-500">kcal</p>
        </div>
      </div>
    </Card>
  );

  // ---------------------------------------------------------------------------
  // Layer 1: FINISH CARD — one compact screen of capturable-now inputs.
  // All analytics live on the full report (the saved workout's read-only view).
  // ---------------------------------------------------------------------------
  if (!readOnly) {
    const calibrationCount = amrapCalibrations.length;
    const noteworthyParts: string[] = [];
    if (personalRecords.length > 0) {
      noteworthyParts.push(
        `🏆 ${personalRecords.length} Personal Record${personalRecords.length > 1 ? 's' : ''}`
      );
    }
    if (calibrationCount > 0) {
      noteworthyParts.push('🎯 RPE calibration updated');
    }

    return (
      <div className="max-w-lg mx-auto space-y-3" data-testid="finish-card">
        {/* Header: checkmark · title · share */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center ${
            personalRecords.length > 0
              ? 'bg-gradient-to-br from-yellow-500/30 to-amber-500/30 ring-2 ring-yellow-500/50'
              : 'bg-success-500/20'
          }`}>
            {personalRecords.length > 0 ? (
              <span className="text-xl">🏆</span>
            ) : (
              <svg className="w-5 h-5 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-surface-100 leading-tight">Workout Complete!</h2>
            {personalRecords.length > 0 && (
              <p className="text-xs text-yellow-400">
                {personalRecords.length} PR{personalRecords.length > 1 ? 's' : ''} — you&apos;re getting stronger 💪
              </p>
            )}
          </div>
          <ShareWorkoutText input={shareInput} />
        </div>

        {/* One compact stat strip */}
        {statStrip}

        {/* Noteworthy one-liner → links into the full report */}
        {noteworthyParts.length > 0 && (
          <button
            type="button"
            data-testid="noteworthy-chip"
            onClick={handleSaveAndViewReport}
            disabled={submitting || !onSaveAndViewReport}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/30 text-left disabled:opacity-60"
          >
            <span className="text-sm text-yellow-400 truncate">{noteworthyParts.join(' · ')}</span>
            <span className="text-xs text-yellow-500 flex-shrink-0">→</span>
          </button>
        )}

        {/* Session RPE — prefilled from the set-derived average */}
        <Card className="!p-3">
          <h3 className="text-sm font-medium text-surface-200 mb-2">How hard was this session?</h3>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rpe) => (
              <button
                key={rpe}
                onClick={() => setSessionRpe(rpe)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  sessionRpe === rpe
                    ? rpe >= 9
                      ? 'bg-danger-500 text-white'
                      : rpe >= 7
                      ? 'bg-warning-500 text-white'
                      : 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                }`}
              >
                {rpe}
              </button>
            ))}
          </div>
          <p className="text-xs text-surface-500 mt-1.5 text-center">
            Prefilled from your set average — adjust if it felt different
          </p>
        </Card>

        {/* Per-muscle workload chips (drives weekly set progression). Pump is
            captured per-exercise during the workout, not here. */}
        {trainedMuscles.length > 0 && (
          <Card className="!p-3">
            <h3 className="text-sm font-medium text-surface-200 mb-0.5">Workload by muscle</h3>
            <p className="text-xs text-surface-500 mb-2">
              Tunes next week&apos;s sets — defaults are fine if nothing stood out.
            </p>
            <div className="space-y-2">
              {trainedMuscles.map((muscle) => {
                const workload = getMuscleWorkload(muscle);
                return (
                  <div key={muscle} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-surface-300 w-20 shrink-0 truncate">
                      {STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                    </span>
                    <div className="flex flex-1 gap-1">
                      {WORKLOAD_CHIP_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() =>
                            setMuscleWorkloads((prev) => ({ ...prev, [muscle]: option.value }))
                          }
                          className={`flex-1 rounded-full px-1.5 py-1 text-[11px] font-medium transition-colors ${
                            workload === option.value
                              ? 'bg-primary-500 text-white'
                              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Joint issues — the ONLY proactive joint-pain ask, once per session.
            Skippable by not tapping; a "none" tap records nothing but confirms. */}
        <Card className="!p-3" data-testid="joint-issues-card">
          <h3 className="text-sm font-medium text-surface-200 mb-0.5">
            Any joint issues today?
          </h3>
          <div className="flex items-center gap-1.5 mt-2">
            {(['none', 'minor', 'significant'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setJointIssueSeverity(option);
                  if (option === 'none') setJointIssueJoints([]);
                }}
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  jointIssueSeverity === option
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                }`}
                data-testid={`joint-issue-${option}`}
              >
                {option}
              </button>
            ))}
          </div>
          {(jointIssueSeverity === 'minor' || jointIssueSeverity === 'significant') && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] text-surface-500">Which:</span>
              {JOINT_PAIN_JOINTS.map((joint) => {
                const selected = jointIssueJoints.includes(joint);
                return (
                  <button
                    key={joint}
                    type="button"
                    onClick={() =>
                      setJointIssueJoints((prev) =>
                        selected ? prev.filter((j) => j !== joint) : [...prev, joint]
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      selected
                        ? 'bg-danger-500/20 text-danger-300 border border-danger-500/50'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700 border border-transparent'
                    }`}
                  >
                    {getJointDisplayName(joint)}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Deload toggle — mark a light session so it's excluded from
            progression suggestions, e1RM/PR trends and stagnation baselines
            (but still counts toward volume, history and streaks). */}
        <Card className="!p-3">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="flex-1">
              <span className="block text-sm font-medium text-surface-200">
                This was a deload session
              </span>
              <span className="block text-xs text-surface-400 mt-0.5">
                Holds light — still counts toward volume, but won&apos;t set PRs or
                anchor next session&apos;s weights.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={isDeload}
              aria-label="This was a deload session"
              onClick={() => setIsDeload((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                isDeload ? 'bg-primary-500' : 'bg-surface-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isDeload ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>
        </Card>

        {/* Notes — collapsed to a single line until tapped */}
        {notesOpen ? (
          <Card className="!p-3">
            <h3 className="text-sm font-medium text-surface-200 mb-2">Session Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did you feel? Any issues? Wins to celebrate?"
              rows={2}
              autoFocus
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 placeholder:text-surface-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </Card>
        ) : (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-surface-700 text-sm text-surface-400 hover:border-surface-500 hover:text-surface-300 transition-colors"
          >
            + Add note
          </button>
        )}

        <Button onClick={handleSubmit} size="lg" className="w-full" disabled={submitting}>
          {submitting ? 'Finishing…' : 'Save & Finish'}
        </Button>

        {onSaveAndViewReport && (
          <button
            type="button"
            onClick={handleSaveAndViewReport}
            disabled={submitting}
            className="w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition-colors disabled:opacity-60"
          >
            View full report →
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Layer 2: FULL REPORT — the saved workout's permanent analytics view
  // (rendered from history / post-save).
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-lg mx-auto space-y-6" data-testid="session-full-report">
      {/* Header */}
      <div className="text-center relative">
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
          personalRecords.length > 0
            ? 'bg-gradient-to-br from-yellow-500/30 to-amber-500/30 ring-2 ring-yellow-500/50'
            : 'bg-success-500/20'
        }`}>
          {personalRecords.length > 0 ? (
            <span className="text-3xl">🏆</span>
          ) : (
            <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <h2 className="text-2xl font-bold text-surface-100">Workout Summary</h2>
        <p className="text-surface-400 mt-1">
          {session.completedAt
            ? `Completed ${new Date(session.completedAt).toLocaleDateString()}`
            : 'Viewing past workout'}
        </p>
        <div className="mt-4 flex justify-center">
          <ShareWorkoutText input={shareInput} />
        </div>
      </div>

      {/* Personal Records Celebration */}
      {personalRecords.length > 0 && (
        <Card className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10 border-yellow-500/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🏆</span>
            <h3 className="font-semibold text-yellow-400">Personal Records</h3>
          </div>
          <div className="space-y-2">
            {(showAllPRs ? personalRecords : personalRecords.slice(0, 3)).map((pr, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-surface-900/50 rounded-lg">
                <div>
                  <p className="font-medium text-surface-100">{pr.exerciseName}</p>
                  <p className="text-xs text-surface-400">
                    {pr.type === 'e1rm' && `New Est. 1RM: ${displayWeight(pr.value)}${weightUnit}`}
                    {pr.type === 'weight' && `New Weight PR: ${displayWeight(pr.value)}${weightUnit}`}
                    {pr.type === 'reps' && `New Reps PR: ${pr.value} reps`}
                    {pr.type === 'duration' && `New Hold PR: ${pr.value}s`}
                    {pr.type === 'form' && 'Form PR: Cleaner technique!'}
                  </p>
                  {pr.formNote && (
                    <p className={`text-xs mt-0.5 ${pr.form === 'clean' ? 'text-success-400' : 'text-warning-400'}`}>
                      {pr.formNote}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <Badge variant="warning" className="bg-yellow-500/20 text-yellow-400">
                    {pr.type === 'reps' ? `+${pr.improvement}` : pr.type === 'duration' ? `+${pr.improvement}s` : pr.type === 'form' ? 'Form' : `+${pr.improvement}%`}
                  </Badge>
                </div>
              </div>
            ))}
            {personalRecords.length > 3 && (
              <button
                onClick={() => setShowAllPRs(!showAllPRs)}
                className="text-sm text-yellow-400 hover:text-yellow-300"
              >
                {showAllPRs ? 'Show less' : `+${personalRecords.length - 3} more PRs`}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* AMRAP Calibration Results */}
      {amrapCalibrations.length > 0 && (
        <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🎯</span>
            <h3 className="font-semibold text-cyan-400">RPE Calibration Results</h3>
          </div>
          <p className="text-xs text-surface-400 mb-4">
            AMRAP sets help calibrate your RPE perception for more accurate training prescriptions.
          </p>
          <div className="space-y-3">
            {amrapCalibrations.map((cal, idx) => {
              // Judgment is confidence-gated; the raw numbers below always show.
              const verdict = getCalibrationVerdict(cal, enhancedAthleteMode);
              const colorClasses = {
                gray: { bg: 'bg-surface-700/30', text: 'text-surface-300', border: 'border-surface-600/50' },
                green: { bg: 'bg-success-500/20', text: 'text-success-400', border: 'border-success-500/30' },
                yellow: { bg: 'bg-warning-500/20', text: 'text-warning-400', border: 'border-warning-500/30' },
                red: { bg: 'bg-danger-500/20', text: 'text-danger-400', border: 'border-danger-500/30' },
              };
              const colors = colorClasses[verdict.color];

              return (
                <div key={idx} className={`p-3 rounded-lg border ${colors.border} ${colors.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-surface-100">{cal.exerciseName}</span>
                    <Badge variant={verdict.badgeVariant} size="sm">
                      {verdict.badgeLabel}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-2">
                    <div>
                      <p className="text-xs text-surface-500">Predicted</p>
                      <p className="text-lg font-semibold text-surface-200">{cal.predictedMaxReps.toFixed(0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Actual</p>
                      <p className="text-lg font-semibold text-surface-100">{cal.actualMaxReps}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Bias</p>
                      <p className={`text-lg font-semibold ${colors.text}`}>
                        {cal.bias >= 0 ? '+' : ''}{cal.bias.toFixed(1)}
                      </p>
                    </div>
                  </div>
                  <p className={`text-xs ${colors.text}`}>{verdict.message}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-surface-500">
                    <span>@ {displayWeight(cal.weightKg)}{weightUnit}</span>
                    <span>•</span>
                    <span className="capitalize">{cal.confidenceLevel} confidence</span>
                    <span>•</span>
                    <span>{cal.dataPoints} data points</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Session totals — the single stat strip (same one the finish card shows) */}
      {statStrip}

      {/* Quality Score Ring */}
      {totalSets > 0 && (
        <Card>
          <div className="flex items-center gap-6">
            {/* Circular quality score */}
            <div className="relative w-24 h-24 flex-shrink-0">
              <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-surface-700"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${qualityScore}, 100`}
                  className={
                    qualityScore >= 80 ? 'text-success-500' :
                    qualityScore >= 60 ? 'text-primary-500' :
                    qualityScore >= 40 ? 'text-warning-500' : 'text-danger-500'
                  }
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold ${
                  qualityScore >= 80 ? 'text-success-400' :
                  qualityScore >= 60 ? 'text-primary-400' :
                  qualityScore >= 40 ? 'text-warning-400' : 'text-danger-400'
                }`}>
                  {qualityScore}
                </span>
                <span className="text-xs text-surface-500">Quality</span>
              </div>
            </div>

            {/* Quality breakdown */}
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-surface-200 mb-2">Set Quality Breakdown</p>
              {qualityBreakdown.stimulative > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-success-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.stimulative} Stimulative</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.stimulative / totalSets) * 100)}%
                  </span>
                </div>
              )}
              {qualityBreakdown.effective > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.effective} Effective</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.effective / totalSets) * 100)}%
                  </span>
                </div>
              )}
              {qualityBreakdown.junk > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-surface-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.junk} Junk</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.junk / totalSets) * 100)}%
                  </span>
                </div>
              )}
              {qualityBreakdown.excessive > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-danger-500" />
                  <span className="text-sm text-surface-300">{qualityBreakdown.excessive} Excessive</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {Math.round((qualityBreakdown.excessive / totalSets) * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Volume by Muscle Group */}
      {volumeByMuscle.length > 0 && (
        <Card>
          <h3 className="text-sm font-medium text-surface-200 mb-3 flex items-center gap-2">
            <span>💪</span> Volume by Muscle
          </h3>
          <div className="space-y-3">
            {volumeByMuscle.slice(0, 5).map(({ muscle, sets, volume }) => {
              const maxVolume = volumeByMuscle[0].volume;
              const percentage = (volume / maxVolume) * 100;
              return (
                <div key={muscle}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-surface-300">{muscleDisplayName(muscle)}</span>
                    <span className="text-surface-400">{sets} sets · {displayWeight(volume)}{weightUnit}</span>
                  </div>
                  <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Effort Timeline */}
      {effortTimeline.length > 0 && (
        <Card>
          <h3 className="text-sm font-medium text-surface-200 mb-3 flex items-center gap-2">
            <span>📈</span> Effort Timeline
          </h3>
          <div className="h-20 flex items-end gap-1">
            {effortTimeline.map((point, idx) => {
              const height = (point.rpe / 10) * 100;
              return (
                <div
                  key={idx}
                  className="flex-1 min-w-[4px] rounded-t transition-all duration-300 hover:opacity-80"
                  style={{
                    height: `${height}%`,
                    backgroundColor: point.rpe >= 9 ? '#ef4444' :
                                    point.rpe >= 8 ? '#f97316' :
                                    point.rpe >= 7 ? '#eab308' : '#22c55e'
                  }}
                  title={`Set ${point.setNumber}: RPE ${point.rpe}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-surface-500">
            <span>Set 1</span>
            <span>Avg: {avgRpe}</span>
            <span>Set {effortTimeline.length}</span>
          </div>
        </Card>
      )}

      {/* Intensity Distribution */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3 flex items-center gap-2">
          <span>🎯</span> Intensity Distribution
        </h3>
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-success-500/10 rounded-lg border border-success-500/20">
            <p className="text-lg font-bold text-success-400">{rpeDistribution.easy}</p>
            <p className="text-xs text-surface-500">Easy</p>
            <p className="text-xs text-surface-600">RPE 1-6</p>
          </div>
          <div className="text-center p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
            <p className="text-lg font-bold text-yellow-400">{rpeDistribution.moderate}</p>
            <p className="text-xs text-surface-500">Moderate</p>
            <p className="text-xs text-surface-600">RPE 7</p>
          </div>
          <div className="text-center p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <p className="text-lg font-bold text-orange-400">{rpeDistribution.hard}</p>
            <p className="text-xs text-surface-500">Hard</p>
            <p className="text-xs text-surface-600">RPE 8</p>
          </div>
          <div className="text-center p-2 bg-red-500/10 rounded-lg border border-red-500/20">
            <p className="text-lg font-bold text-red-400">{rpeDistribution.maximal}</p>
            <p className="text-xs text-surface-500">Max</p>
            <p className="text-xs text-surface-600">RPE 9-10</p>
          </div>
        </div>
      </Card>

      {/* Exercise Details */}
      {exerciseDetails.length > 0 && (
        <Card>
          <button
            onClick={() => setShowExerciseDetails(!showExerciseDetails)}
            className="w-full flex items-center justify-between mb-3"
          >
            <h3 className="text-sm font-medium text-surface-200 flex items-center gap-2">
              <span>📋</span> Exercise Details ({exerciseDetails.length})
            </h3>
            <svg
              className={`w-5 h-5 text-surface-400 transition-transform ${showExerciseDetails ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showExerciseDetails && (
            <div className="space-y-3">
              {exerciseDetails.map((exercise) => {
                const isExpanded = expandedExercises.has(exercise.blockId);
                return (
                  <div
                    key={exercise.blockId}
                    className="bg-surface-800/50 rounded-lg overflow-hidden"
                  >
                    {/* Exercise header */}
                    <button
                      onClick={() => toggleExerciseExpanded(exercise.blockId)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-surface-800 transition-colors"
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-surface-100">{exercise.name}</span>
                          {exercise.hasPR && (
                            <Badge variant="warning" size="sm" className="bg-yellow-500/20 text-yellow-400">
                              🏆 PR
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-surface-400">
                          <span>{muscleDisplayName(exercise.muscle)}</span>
                          <span>•</span>
                          <span>{exercise.sets.length} sets</span>
                          <span>•</span>
                          {exercise.isDuration ? (
                            <span>{exercise.sets.reduce((sum, s) => sum + s.reps, 0)}s total</span>
                          ) : (
                            <span>{displayWeight(exercise.totalVolume)}{weightUnit} vol</span>
                          )}
                          <span>•</span>
                          <span>RPE {exercise.avgRpe}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary-400">
                          {displayWeight(exercise.maxWeight)}{weightUnit}
                        </p>
                        <p className="text-xs text-surface-500">top weight</p>
                      </div>
                      <svg
                        className={`w-4 h-4 text-surface-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Expanded set details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-surface-700">
                        {/* Quick stats — duration exercises track max seconds
                            at weight, never an e1RM or tonnage */}
                        <div className="grid grid-cols-4 gap-2 py-3">
                          {exercise.isDuration ? (
                            <div className="text-center">
                              <p className="text-sm font-bold text-surface-200">{exercise.maxReps}s</p>
                              <p className="text-xs text-surface-500">Max Hold</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <p className="text-sm font-bold text-surface-200">{displayWeight(exercise.bestE1RM)}{weightUnit}</p>
                              <p className="text-xs text-surface-500">Est. 1RM</p>
                            </div>
                          )}
                          {exercise.isDuration ? (
                            <div className="text-center">
                              <p className="text-sm font-bold text-surface-200">
                                {exercise.sets.reduce((sum, s) => sum + s.reps, 0)}s
                              </p>
                              <p className="text-xs text-surface-500">Total Time</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <p className="text-sm font-bold text-surface-200">{exercise.maxReps}</p>
                              <p className="text-xs text-surface-500">Max Reps</p>
                            </div>
                          )}
                          {exercise.isDuration ? (
                            <div className="text-center">
                              <p className="text-sm font-bold text-surface-200">{displayWeight(exercise.maxWeight)}</p>
                              <p className="text-xs text-surface-500">Top Wt ({weightUnit})</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <p className="text-sm font-bold text-surface-200">{displayWeight(exercise.totalVolume)}</p>
                              <p className="text-xs text-surface-500">Vol ({weightUnit})</p>
                            </div>
                          )}
                          <div className="text-center">
                            <p className="text-sm font-bold text-surface-200">{exercise.avgRpe}</p>
                            <p className="text-xs text-surface-500">Avg RPE</p>
                          </div>
                        </div>

                        {/* Set table */}
                        <div className="bg-surface-900/50 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-surface-500 text-xs">
                                <th className="px-2 py-1.5 text-left">Set</th>
                                <th className="px-2 py-1.5 text-center">Weight</th>
                                <th className="px-2 py-1.5 text-center">{exercise.isDuration ? 'Sec' : 'Reps'}</th>
                                <th className="px-2 py-1.5 text-center">RPE</th>
                                <th className="px-2 py-1.5 text-right">Quality</th>
                              </tr>
                            </thead>
                            <tbody>
                              {exercise.warmupSets.length > 0 && (
                                <tr className="text-surface-500 bg-surface-800/30">
                                  <td colSpan={5} className="px-2 py-1 text-xs">
                                    Warmup: {exercise.warmupSets.length} sets
                                  </td>
                                </tr>
                              )}
                              {exercise.sets.map((set, idx) => (
                                <tr
                                  key={set.id}
                                  className={`border-t border-surface-800 ${
                                    set.quality === 'stimulative' ? 'bg-success-500/5' :
                                    set.quality === 'excessive' ? 'bg-danger-500/5' : ''
                                  }`}
                                >
                                  <td className="px-2 py-1.5 text-surface-400">{idx + 1}</td>
                                  <td className="px-2 py-1.5 text-center font-medium text-surface-200">
                                    {displayWeight(set.weightKg)}{weightUnit}
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-surface-200">
                                    {set.reps}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                      set.rpe >= 9 ? 'bg-red-500/20 text-red-400' :
                                      set.rpe >= 8 ? 'bg-orange-500/20 text-orange-400' :
                                      set.rpe >= 7 ? 'bg-yellow-500/20 text-yellow-400' :
                                      'bg-green-500/20 text-green-400'
                                    }`}>
                                      {set.rpe}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <span className={`text-xs ${
                                      set.quality === 'stimulative' ? 'text-success-400' :
                                      set.quality === 'effective' ? 'text-primary-400' :
                                      set.quality === 'junk' ? 'text-surface-500' :
                                      'text-danger-400'
                                    }`}>
                                      {set.quality === 'stimulative' ? '✓ Stim' :
                                       set.quality === 'effective' ? '○ Eff' :
                                       set.quality === 'junk' ? '— Junk' :
                                       '⚠ Excess'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* PR comparison: hold time for duration, e1RM otherwise */}
                        {exercise.hasPR && exerciseHistories?.[exercise.exerciseId || '']?.previousBest && (
                          <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-yellow-400">🏆 New Personal Record!</span>
                              {exercise.isDuration ? (
                                <span className="text-surface-300">
                                  {exerciseHistories[exercise.exerciseId || ''].previousBest?.reps || 0}s → <span className="font-bold text-yellow-400">{exercise.maxReps}s</span>
                                </span>
                              ) : (
                                <span className="text-surface-300">
                                  {displayWeight(exerciseHistories[exercise.exerciseId || ''].previousBest?.e1rm || 0)}{weightUnit} → <span className="font-bold text-yellow-400">{displayWeight(exercise.bestE1RM)}{weightUnit}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Session RPE */}
      <Card>
        <h3 className="text-sm font-medium text-surface-200 mb-3">Session RPE</h3>
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-lg font-bold text-lg ${
            sessionRpe >= 9
              ? 'bg-danger-500/20 text-danger-400'
              : sessionRpe >= 7
              ? 'bg-warning-500/20 text-warning-400'
              : 'bg-primary-500/20 text-primary-400'
          }`}>
            {sessionRpe}/10
          </div>
          <span className="text-surface-400 text-sm">
            {sessionRpe >= 9 ? 'Maximum Effort' : sessionRpe >= 7 ? 'Hard' : sessionRpe >= 5 ? 'Moderate' : 'Easy'}
          </span>
        </div>
      </Card>

      {/* Notes */}
      {notes && (
        <Card>
          <h3 className="text-sm font-medium text-surface-200 mb-3">Session Notes</h3>
          <p className="text-surface-300">{notes}</p>
        </Card>
      )}

      {/* Deload flag */}
      {isDeload && (
        <Card>
          <div className="flex items-center gap-2">
            <Badge variant="info" size="sm">Deload</Badge>
            <span className="text-sm text-surface-400">
              Logged as a deload session — held light on purpose.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
