'use client';

import React, { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { Card, Badge, Button, ConfirmModal } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise, ExerciseBlock, SetLog, WeightUnit, SetQuality, SetFeedback, BodyweightData, ExercisePerformanceSnapshot } from '@/types/schema';
import { rpeToRir, muscleMatchesGroup } from '@/types/schema';
import { convertWeight, formatMuscleName, formatWeightValue, convertWeightForDisplay, inputWeightToKg, roundToPlateIncrement } from '@/lib/utils';
import { estimateRepsForWeight, predictAmrapReps } from '@/services/setSuggestionEngine';
import { recommendSet } from '@/services/setRecommender';
import { findSimilarExercises, calculateSimilarityScore } from '@/services/exerciseSwapper';
import { detectPlateau, type PlateauDetectionResult } from '@/services/plateauDetector';
import type { AdjustedRIRResult } from '@/services/rpeCalibration';
import type { ReadinessModulation } from '@/services/fatigueEngine';
import { lightHaptic } from '@/lib/integrations/notifications';
import { Input } from '@/components/ui';
import { IconCheck, IconChevronDown, IconCloudPause } from '@tabler/icons-react';
import { InlineRestTimerBar } from './InlineRestTimerBar';
import { DropsetPrompt } from './DropsetPrompt';
import { BodyweightSetEditRow } from './BodyweightSetEditRow';
import { SegmentedControl } from './SegmentedControl';
import { SetLoggerRow } from './SetLoggerRow';
import { SuggestionBanner } from './SuggestionBanner';
import { BottomSheet } from './BottomSheet';

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'traps', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs'];

// Read an exercise's primary muscle defensively: different call sites feed
// ExerciseCard either camelCase (primaryMuscle, mapped) or raw snake_case
// (primary_muscle) data, and DB casing can vary — normalize to lowercase so the
// swap muscle filter matches reliably.
function exercisePrimaryMuscle(ex: { primaryMuscle?: string; primary_muscle?: string }): string {
  return String(ex.primaryMuscle ?? ex.primary_muscle ?? '').toLowerCase();
}

// Get color classes for hypertrophy tier badge (compact version for workouts)
function getTierBadgeClasses(tier: string): string {
  switch (tier) {
    case 'S': return 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black';
    case 'A': return 'bg-emerald-500/30 text-emerald-400';
    case 'B': return 'bg-blue-500/30 text-blue-400';
    case 'C': return 'bg-surface-600 text-surface-400';
    case 'D': return 'bg-orange-500/30 text-orange-400';
    case 'F': return 'bg-red-500/30 text-red-400';
    default: return 'bg-surface-700 text-surface-500';
  }
}

interface ExerciseHistory {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
}

interface WarmupSetData {
  setNumber: number;
  percentOfWorking: number;
  targetReps: number;
  purpose: string;
  restSeconds?: number;  // Rest time after this warmup set
}

import {
  getInjuryRisk,
  INJURY_LABELS,
  type InjuryArea,
  type InjuryRisk
} from '@/services/injuryAwareSwapper';
import { SafetyTierBadge } from './SafetyTierBadge';
import { getFailureSafetyTier } from '@/services/exerciseSafety';

interface TemporaryInjury {
  area: string;
  severity: 1 | 2 | 3;
}

// Wrapper to use the intelligent injury swapper service
function getExerciseInjuryRiskFromService(
  exercise: { name: string; primaryMuscle: string },
  injuries: TemporaryInjury[]
): { isRisky: boolean; severity: number; reasons: string[]; risk: InjuryRisk } {
  if (injuries.length === 0) return { isRisky: false, severity: 0, reasons: [], risk: 'safe' };
  
  let worstRisk: InjuryRisk = 'safe';
  let maxSeverity = 0;
  const reasons: string[] = [];
  
  for (const injury of injuries) {
    const risk = getInjuryRisk(
      { 
        id: '', 
        name: exercise.name, 
        primaryMuscle: exercise.primaryMuscle,
        secondaryMuscles: [],
        mechanic: 'compound',
        defaultRepRange: [8, 12] as [number, number],
        defaultRir: 2,
        minWeightIncrementKg: 2.5,
        formCues: [],
        commonMistakes: [],
        setupNote: '',
        movementPattern: '',
        equipmentRequired: [],
      }, 
      injury.area as InjuryArea
    );
    
    if (risk === 'avoid') {
      worstRisk = 'avoid';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`May aggravate ${INJURY_LABELS[injury.area] || injury.area.replace('_', ' ')}`);
    } else if (risk === 'caution' && worstRisk !== 'avoid') {
      worstRisk = 'caution';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`Use caution (${INJURY_LABELS[injury.area] || injury.area.replace('_', ' ')})`);
    }
  }
  
  return {
    isRisky: worstRisk !== 'safe',
    severity: maxSeverity,
    reasons: Array.from(new Set(reasons)),
    risk: worstRisk
  };
}

type SetType = 'normal' | 'warmup' | 'dropset' | 'myorep' | 'rest_pause';

interface SetCompleteData {
  weightKg: number;
  reps: number;
  rpe: number;
  note?: string;
  setType?: SetType;
  parentSetId?: string;  // For dropsets: the ID of the parent set
  feedback?: SetFeedback;  // New feedback data
  bodyweightData?: BodyweightData;  // Bodyweight-specific data for bodyweight exercises
}

interface ExerciseCardProps {
  exercise: Exercise;
  block: ExerciseBlock;
  sets: SetLog[];
  onSetComplete?: (setData: SetCompleteData) => Promise<string | null> | void;  // Returns set ID for feedback
  onSetEdit?: (setId: string, data: { weightKg: number; reps: number; rpe: number; bodyweightData?: BodyweightData }) => void;
  onSetDelete?: (setId: string) => void;
  onSetFeedbackUpdate?: (setId: string, feedback: SetFeedback) => void;  // Update feedback on existing set
  onTargetSetsChange?: (newTargetSets: number) => void;  // Callback to add/remove planned sets
  onExerciseSwap?: (newExercise: Exercise) => void;  // Callback to swap exercise
  onExerciseDelete?: () => void;  // Callback to delete entire exercise from workout
  onBlockNoteUpdate?: (note: string | null) => void;  // Callback to update exercise block note
  onWarmupComplete?: (restSeconds: number) => void;  // Callback when a warmup set is completed
  availableExercises?: Exercise[];  // All exercises for swap suggestions
  frequentExerciseIds?: Map<string, number>;  // Exercise usage counts for sorting
  isActive?: boolean;
  unit?: WeightUnit;
  recommendedWeight?: number;  // AI-suggested weight in kg
  previousSets?: { weightKg: number; reps: number }[];  // Previous workout's sets for this exercise
  exerciseHistory?: ExerciseHistory;  // Historical data for this exercise
  warmupSets?: WarmupSetData[];  // Warmup protocol for this exercise
  workingWeight?: number;  // Working weight in kg for warmup calculations
  showSwapOnMount?: boolean;  // Auto-show swap modal when mounted (for injury-related swaps)
  currentInjuries?: TemporaryInjury[];  // Current injuries to filter swap suggestions
  onExerciseNameClick?: () => void;  // Callback when exercise name is clicked
  // Rest timer state for inline display
  showRestTimer?: boolean;
  timerSeconds?: number;
  timerInitialSeconds?: number;
  timerIsRunning?: boolean;
  timerIsFinished?: boolean;
  timerIsSkipped?: boolean;
  timerRestedSeconds?: number;
  onShowTimerControls?: () => void;
  // Dropset state from parent (auto-triggered after main set completion)
  pendingDropset?: {
    parentSetId: string;
    parentWeight: number;
    blockId: string;
    dropNumber: number;
    totalDrops: number;
  } | null;
  onDropsetCancel?: () => void;
  onDropsetStart?: () => void;  // Called when manual dropset is started (to stop timer)
  // Bodyweight exercise support
  userBodyweightKg?: number;  // User's current bodyweight for bodyweight exercises
  // RPE calibration - full adjustment result (prescribed RIR + reason) based on user's bias
  adjustedRir?: AdjustedRIRResult;
  // Readiness easing for this session (rirDelta + banner copy), from applyReadinessModulation
  readinessModulation?: ReadinessModulation | null;
  // Per-session performance history for plateau detection (services/plateauDetector)
  performanceSnapshots?: ExercisePerformanceSnapshot[];
  // One-tap plateau action: update the block's target rep range
  onRepRangeChange?: (range: [number, number]) => void;
  // AMRAP suggestion - indicates this is the last set and user should push to failure
  isAmrapSuggested?: boolean;  // If true, pre-fill RPE with 9.5 as a target
  // Plate calculator
  onPlateCalculatorOpen?: (initialWeightKg?: number) => void;  // Callback to open plate calculator modal
  // Per-set write status (P0-2): drives the saved/saving/queued glyph on
  // completed set lines. Sets absent from the map (loaded from DB) are saved.
  setSyncStatus?: Record<string, SetSyncStatus>;
}

/** Write status of a logged set (offline outbox, P0-2). */
export type SetSyncStatus = 'saving' | 'saved' | 'queued';

// PERFORMANCE: Memoized component to prevent unnecessary re-renders
export const ExerciseCard = memo(function ExerciseCard({
  exercise,
  block,
  sets,
  onSetComplete,
  onExerciseNameClick,
  onSetEdit,
  onSetDelete,
  onSetFeedbackUpdate,
  onTargetSetsChange,
  onExerciseSwap,
  onExerciseDelete,
  onBlockNoteUpdate,
  onWarmupComplete,
  availableExercises = [],
  frequentExerciseIds = new Map(),
  isActive = false,
  unit = 'kg',
  recommendedWeight,
  previousSets = [],
  exerciseHistory,
  warmupSets = [],
  workingWeight = 0,
  showSwapOnMount = false,
  currentInjuries = [],
  showRestTimer = false,
  timerSeconds = 0,
  timerInitialSeconds = 0,
  timerIsRunning = false,
  timerIsFinished = false,
  timerIsSkipped = false,
  timerRestedSeconds = 0,
  onShowTimerControls,
  pendingDropset = null,
  onDropsetCancel,
  onDropsetStart,
  userBodyweightKg,
  adjustedRir,
  readinessModulation,
  setSyncStatus,
  performanceSnapshots,
  onRepRangeChange,
  isAmrapSuggested = false,
  onPlateCalculatorOpen,
}: ExerciseCardProps) {
  // Prescribed RIR: calibration-adjusted target when available, eased further
  // by the session's readiness modulation (Phase 1.3/1.5 fold-in).
  const baseTargetRir = adjustedRir?.hasAdjustment ? adjustedRir.prescribedRIR : block.targetRir;
  const effectiveTargetRir = Math.max(
    0,
    Math.min(4, baseTargetRir + (readinessModulation?.rirDelta ?? 0))
  );

  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [completedWarmups, setCompletedWarmups] = useState<Set<number>>(new Set());
  const [editingWarmupId, setEditingWarmupId] = useState<number | null>(null);
  const [customWarmupWeights, setCustomWarmupWeights] = useState<Map<number, number>>(new Map());
  const [warmupWeightInput, setWarmupWeightInput] = useState('');
  const [isWarmupExpanded, setIsWarmupExpanded] = useState(false);
  const [showExerciseMenu, setShowExerciseMenu] = useState(false);
  const [showRpeGuide, setShowRpeGuide] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [swapTab, setSwapTab] = useState<'similar' | 'browse'>('similar');
  const [swapSearch, setSwapSearch] = useState('');
  const [isCompletingSet, setIsCompletingSet] = useState(false); // Prevent double-clicks
  const [dropsetMode, setDropsetMode] = useState<{ parentSetId: string; parentWeight: number } | null>(null);
  // Plateau suggestions bottom sheet (opened from the header pill)
  const [showPlateauSheet, setShowPlateauSheet] = useState(false);

  // Note editing state
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(block.note || '');

  // Sync noteText when block.note changes
  useEffect(() => {
    setNoteText(block.note || '');
  }, [block.note]);

  // Auto-show swap modal when showSwapOnMount is true
  useEffect(() => {
    if (showSwapOnMount) {
      setShowSwapModal(true);
    }
  }, [showSwapOnMount]);
  
  // Reset warmup completion state when this exercise becomes active
  // This ensures warmups are fresh when switching exercises out of order
  const prevIsActiveRef = useRef(isActive);
  useEffect(() => {
    // Only reset if we just became active (wasn't active before, now is)
    if (isActive && !prevIsActiveRef.current) {
      setCompletedWarmups(new Set());
      setIsWarmupExpanded(true); // Reset to expanded when exercise becomes active
    }
    prevIsActiveRef.current = isActive;
  }, [isActive]);

  // Auto-collapse warmup sets when all are completed
  useEffect(() => {
    if (warmupSets.length > 0 && completedWarmups.size === warmupSets.length) {
      setIsWarmupExpanded(false);
    }
  }, [completedWarmups.size, warmupSets.length]);
  
  const [swapMuscleFilter, setSwapMuscleFilter] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editRpe, setEditRpe] = useState('');
  
  // Swipe to delete state
  const [swipeState, setSwipeState] = useState<{
    setId: string | null;
    startX: number;
    currentX: number;
    isSwiping: boolean;
  }>({ setId: null, startX: 0, currentX: 0, isSwiping: false });

  // Calculate similar exercises for swap suggestions, filtering out injury-risky ones
  const similarExercises = useMemo(() => {
    if (availableExercises.length === 0) return [];
    
    const similar = findSimilarExercises(exercise, availableExercises)
      .slice(0, 15) // Get more to filter
      .map(ex => {
        const injuryRisk = getExerciseInjuryRiskFromService({ name: ex.name, primaryMuscle: ex.primaryMuscle }, currentInjuries);
        return {
          exercise: ex,
          score: calculateSimilarityScore(exercise, ex),
          injuryRisk
        };
      });
    
    // Sort: safe exercises first, then by similarity score
    return similar.sort((a, b) => {
      // Safe exercises come first
      if (!a.injuryRisk.isRisky && b.injuryRisk.isRisky) return -1;
      if (a.injuryRisk.isRisky && !b.injuryRisk.isRisky) return 1;
      // Then by severity (lower is better)
      if (a.injuryRisk.severity !== b.injuryRisk.severity) {
        return a.injuryRisk.severity - b.injuryRisk.severity;
      }
      // Then by similarity score
      return b.score - a.score;
    }).slice(0, 8);
  }, [exercise, availableExercises, currentInjuries]);
  
  // Count safe alternatives
  const safeAlternatives = similarExercises.filter(s => !s.injuryRisk.isRisky);
  const hasInjuries = currentInjuries.length > 0;

  // State for pending set inputs (one per pending set)
  const [pendingInputs, setPendingInputs] = useState<{
    weight: string;
    reps: string;
    rpe: string;
  }[]>([]);

  const completedSets = sets.filter((s) => !s.isWarmup && s.setType !== 'warmup');
  const pendingSetsCount = Math.max(0, block.targetSets - completedSets.length);
  const progressPercent = Math.round((completedSets.length / block.targetSets) * 100);

  // Within-session next-set recommendation (services/setRecommender.ts).
  // Anchor on the freshest/strongest E1RM this exercise so late-set predictions
  // aren't double-fatigued.
  const sessionBestE1RM = useMemo(() => {
    let best = 0;
    for (const s of completedSets) {
      if (s.weightKg > 0 && s.reps > 0) {
        const rir = s.rpe != null ? Math.max(0, 10 - s.rpe) : effectiveTargetRir;
        const e = s.weightKg * (1 + (s.reps + rir) / 30);
        if (e > best) best = e;
      }
    }
    return best > 0 ? best : undefined;
  }, [completedSets, effectiveTargetRir]);

  const recommendNext = (last: { weightKg: number; reps: number; rpe?: number }) =>
    recommendSet({
      lastWeightKg: last.weightKg,
      lastReps: last.reps,
      lastRir: last.rpe != null ? Math.max(0, 10 - last.rpe) : effectiveTargetRir,
      setsCompletedThisExercise: completedSets.length,
      sessionBestE1RMKg: sessionBestE1RM,
      targetRepRange: block.targetRepRange,
      targetRir: effectiveTargetRir,
      minIncrementKg: exercise.minWeightIncrementKg,
    });

  // Check if this is a bodyweight exercise
  // Use type assertion to access bodyweight properties that may exist on the exercise
  const exerciseWithBodyweight = exercise as any;
  const isBodyweightExercise = exerciseWithBodyweight.isBodyweight || exerciseWithBodyweight.equipment === 'bodyweight' || (exerciseWithBodyweight.equipmentRequired && exerciseWithBodyweight.equipmentRequired.includes('bodyweight'));
  // For bodyweight exercises without a specific bodyweightType set, default to allowing both weighted and assisted
  // This handles exercises like pull-ups, dips that can be done weighted or with assistance
  const bodyweightType = exerciseWithBodyweight.bodyweightType;
  const canAddWeight = isBodyweightExercise && (bodyweightType === 'weighted_possible' || bodyweightType === 'both' || !bodyweightType);
  const canUseAssistance = isBodyweightExercise && (bodyweightType === 'assisted_possible' || bodyweightType === 'both' || !bodyweightType);
  const isPureBodyweight = isBodyweightExercise && bodyweightType === 'pure';

  // Check if this is a duration-based exercise (plank, hold, etc.)
  // These exercises track seconds instead of reps
  const isDurationBased = exercise.exerciseType === 'duration_based';

  // Weight mode state for bodyweight exercises (header-level selection)
  const [weightMode, setWeightMode] = useState<'bodyweight' | 'weighted' | 'assisted'>(
    isPureBodyweight ? 'bodyweight' : 'bodyweight'
  );

  // Added/assistance load input (display units) for weighted/assisted bodyweight
  // modes. Kept separate from pendingInputs because those seed EFFECTIVE loads.
  const [bwLoadInput, setBwLoadInput] = useState('');

  // Plateau detection for this exercise (services/plateauDetector, Phase 1.7).
  // History snapshots are threaded from the page's already-loaded exercise history.
  const plateau: PlateauDetectionResult | null = useMemo(() => {
    if (!performanceSnapshots || performanceSnapshots.length === 0) return null;
    const result = detectPlateau({ exerciseId: exercise.id, snapshots: performanceSnapshots });
    return result.isPlateaued ? result : null;
  }, [performanceSnapshots, exercise.id]);

  // One-tap "Try X-Y reps" action: first rep range embedded in the suggestions.
  const plateauRepRange: [number, number] | null = useMemo(() => {
    if (!plateau) return null;
    for (const suggestion of plateau.suggestions) {
      const match = suggestion.match(/\((\d+)\s*-\s*(\d+) reps\)/);
      if (match) return [parseInt(match[1]), parseInt(match[2])];
    }
    return null;
  }, [plateau]);

  // Seed the bodyweight load input from the most recent set logged in the
  // same mode (added load for weighted, assistance for assisted).
  useEffect(() => {
    if (!isBodyweightExercise) return;
    const lastBw = [...completedSets].reverse().find((s) => s.bodyweightData)?.bodyweightData;
    if (weightMode === 'weighted') {
      const kg = lastBw?.modification === 'weighted' ? lastBw.addedWeightKg ?? 0 : 0;
      setBwLoadInput(kg > 0 ? String(convertWeightForDisplay(kg, unit)) : '');
    } else if (weightMode === 'assisted') {
      const kg = lastBw?.modification === 'assisted' ? lastBw.assistanceWeightKg ?? 0 : 0;
      setBwLoadInput(kg > 0 ? String(convertWeightForDisplay(kg, unit)) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightMode, isBodyweightExercise, completedSets.length, unit]);

  // Determine suggested weight
  const suggestedWeight = block.targetWeightKg > 0 
    ? block.targetWeightKg 
    : (recommendedWeight && recommendedWeight > 0 ? recommendedWeight : 0);

  // Format weight for display - use exact conversion for completed sets, rounded for suggestions
  // For completed sets, preserve exact user input; for suggestions, round to plate increments
  const displayWeight = useCallback((kg: number, preserveExact: boolean = false) => {
    return preserveExact ? convertWeightForDisplay(kg, unit) : formatWeightValue(kg, unit);
  }, [unit]);
  const weightLabel = unit === 'lb' ? 'lbs' : 'kg';

  // Seed string for a pending weight input. When the seed comes verbatim from
  // a logged set (recommendation held the weight, or seeding from last
  // session), preserve the user's EXACT input via convertWeightForDisplay —
  // only fresh suggestions round to plate increments (SetInputRow convention).
  const seedWeightString = useCallback(
    (kg: number, exactSourceKg?: number) => {
      if (!(kg > 0)) return '';
      return String(displayWeight(kg, exactSourceKg !== undefined && kg === exactSourceKg));
    },
    [displayWeight]
  );

  // Weight+reps seed for a not-yet-started exercise, anchored to the previous
  // session's set. When the target rep range has moved away from what that set
  // was performed at (e.g. the one-tap plateau rep-range switch), reusing the
  // set's weight would prescribe an impossible load — re-derive it from the
  // set's estimated 1RM at the new range's midpoint instead.
  const seedFromPreviousSet = useCallback(
    (prevSet: { weightKg: number; reps: number }, range: [number, number]) => {
      if (prevSet.reps >= range[0] && prevSet.reps <= range[1]) {
        return { weightKg: prevSet.weightKg, reps: prevSet.reps };
      }
      const reps = Math.round((range[0] + range[1]) / 2);
      const e1rm = prevSet.weightKg * (1 + (prevSet.reps + effectiveTargetRir) / 30);
      const rawKg = e1rm / (1 + (reps + effectiveTargetRir) / 30);
      const inc = exercise.minWeightIncrementKg || 2.5;
      return { weightKg: Math.max(inc, Math.round(rawKg / inc) * inc), reps };
    },
    [effectiveTargetRir, exercise.minWeightIncrementKg]
  );

  // Track the last known completed sets count to detect changes
  const prevCompletedCountRef = useRef(completedSets.length);

  // Track whether AMRAP prefill has already occurred to avoid overwriting user edits
  const amrapPrefillDoneRef = useRef(false);

  // Track pending reps auto-calculation timeouts per set index
  // This allows canceling the debounced calculation if user manually edits reps
  const repsCalcTimeoutsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  // Cleanup pending reps calculation timeouts on unmount
  useEffect(() => {
    return () => {
      repsCalcTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      repsCalcTimeoutsRef.current.clear();
    };
  }, []);

  // Recalculate pending inputs based on the last completed set
  const recalculatePendingInputs = useCallback(() => {
    if (pendingSetsCount === 0) return;

    const targetRpe = 10 - effectiveTargetRir;
    const lastCompleted = completedSets[completedSets.length - 1];

    if (!lastCompleted) return;

    // Calculate smart defaults using the within-session recommender
    const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
    const rec = recommendNext(lastSetData);
    const smartWeight = rec.weightKg;
    const smartReps = rec.reps;

    // Update all pending inputs
    const updatedInputs: { weight: string; reps: string; rpe: string }[] = [];
    for (let i = 0; i < pendingSetsCount; i++) {
      const isLastSet = i === pendingSetsCount - 1;
      // If this is the last set and AMRAP is suggested, use 9.5 for RPE
      const setRpe = (isLastSet && isAmrapSuggested) ? 9.5 : targetRpe;

      // For AMRAP sets, use bounded prediction instead of uncapped formula
      let setReps = smartReps;
      if (isLastSet && isAmrapSuggested && lastCompleted?.rpe) {
        setReps = Math.max(predictAmrapReps(lastSetData, suggestionCtx), smartReps);
      }

      updatedInputs.push({
        weight: seedWeightString(smartWeight, lastCompleted.weightKg),
        reps: String(setReps),
        rpe: String(setRpe),
      });
    }

    setPendingInputs(updatedInputs);
  }, [completedSets, pendingSetsCount, effectiveTargetRir, block.targetRepRange, seedWeightString, isAmrapSuggested]);
  
  // Initialize pending inputs when component mounts or when we need a full reset
  // Only reinitialize when pendingSetsCount increases (sets were added) or on first mount
  useEffect(() => {
    const prevCount = prevCompletedCountRef.current;
    const currentCount = completedSets.length;
    prevCompletedCountRef.current = currentCount;
    
    // If a set was just completed (count increased), update all pending inputs
    // based on the just-completed set's performance
    if (currentCount > prevCount) {
      const targetRpe = 10 - effectiveTargetRir;
      const lastCompleted = completedSets[completedSets.length - 1];
      
      // Calculate smart defaults using the shared suggestion engine
      let smartWeight: number;
      let smartReps: number;

      if (lastCompleted) {
        const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
        const rec = recommendNext(lastSetData);
        smartWeight = rec.weightKg;
        smartReps = rec.reps;
      } else {
        smartWeight = suggestedWeight;
        smartReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
      }

      // Create updated pending inputs - all based on the last completed set
      const updatedInputs: { weight: string; reps: string; rpe: string }[] = [];
      for (let i = 0; i < pendingSetsCount; i++) {
        const isLastSet = i === pendingSetsCount - 1;
        // If this is the last set and AMRAP is suggested, use 9.5 for RPE
        const setRpe = (isLastSet && isAmrapSuggested) ? 9.5 : targetRpe;

        // For AMRAP sets, use bounded prediction
        let setReps = smartReps;
        if (isLastSet && isAmrapSuggested && lastCompleted?.rpe) {
          const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
          setReps = Math.max(predictAmrapReps(lastSetData, suggestionCtx), smartReps);
        }

        updatedInputs.push({
          weight: seedWeightString(smartWeight, lastCompleted?.weightKg),
          reps: String(setReps),
          rpe: String(setRpe),
        });
      }

      setPendingInputs(updatedInputs);
      return;
    }
    
    // Trim pendingInputs if pendingSetsCount decreased (user removed sets via minus button)
    if (pendingInputs.length > pendingSetsCount) {
      setPendingInputs(pendingInputs.slice(0, pendingSetsCount));
      return;
    }

    // Full initialization only if:
    // - pendingInputs is empty and we need inputs
    // - OR pendingSetsCount increased (new sets were added to the target)
    if (pendingSetsCount > 0 && (pendingInputs.length === 0 || pendingInputs.length < pendingSetsCount)) {
      const newPendingInputs: { weight: string; reps: string; rpe: string }[] = [];
      const targetRpe = 10 - effectiveTargetRir;
      
      for (let i = 0; i < pendingSetsCount; i++) {
        // Keep existing input if available
        if (i < pendingInputs.length && pendingInputs[i]) {
          newPendingInputs.push(pendingInputs[i]);
          continue;
        }
        
        const setIndex = completedSets.length + i;
        const prevSet = previousSets[setIndex];
        const lastCompleted = completedSets[completedSets.length - 1];
        const isLastSet = i === pendingSetsCount - 1;
        
        let defaultWeight: number;
        let defaultReps: number;
        let defaultRpe: number;
        
        if (lastCompleted) {
          const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
          const rec = recommendNext(lastSetData);
          defaultWeight = rec.weightKg;
          defaultReps = rec.reps;
        } else if (prevSet) {
          const seeded = seedFromPreviousSet(prevSet, block.targetRepRange);
          defaultWeight = seeded.weightKg;
          defaultReps = seeded.reps;
        } else {
          defaultWeight = suggestedWeight;
          defaultReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
        }

        // If this is the last set and AMRAP is suggested, pre-fill RPE with 9.5
        if (isLastSet && isAmrapSuggested) {
          defaultRpe = 9.5;
          // For AMRAP sets, use bounded prediction
          if (lastCompleted?.rpe) {
            const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
            defaultReps = Math.max(predictAmrapReps(lastSetData, suggestionCtx), defaultReps);
          }
        } else {
          defaultRpe = targetRpe;
        }

        newPendingInputs.push({
          weight: seedWeightString(defaultWeight, lastCompleted?.weightKg ?? prevSet?.weightKg),
          reps: String(defaultReps),
          rpe: String(defaultRpe),
        });
      }
      
      setPendingInputs(newPendingInputs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSets.length, pendingSetsCount, isAmrapSuggested]);
  
  // Update RPE to 9.5 and predicted reps when AMRAP suggestion first appears
  // Only prefill once to avoid overwriting user edits
  useEffect(() => {
    // Reset prefill flag when AMRAP mode is turned off
    if (!isAmrapSuggested) {
      amrapPrefillDoneRef.current = false;
      return;
    }

    // Only prefill once when AMRAP first appears
    if (amrapPrefillDoneRef.current) {
      return;
    }

    if (isAmrapSuggested && pendingInputs.length > 0) {
      const lastIndex = pendingInputs.length - 1;
      const lastInput = pendingInputs[lastIndex];
      const lastCompleted = completedSets[completedSets.length - 1];

      // Check if we need to update RPE
      const currentRpe = parseFloat(lastInput?.rpe || '0');
      const needsRpeUpdate = lastInput && currentRpe !== 9.5;

      // Calculate predicted max reps for AMRAP using bounded prediction
      let predictedReps: number | null = null;
      if (lastCompleted?.rpe) {
        const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
        predictedReps = predictAmrapReps(lastSetData, suggestionCtx);
      }

      // Only prefill reps if we have a prediction (don't check current value - this is initial prefill)
      const needsRepsUpdate = predictedReps !== null;

      if (needsRpeUpdate || needsRepsUpdate) {
        setPendingInputs(prev => {
          const updated = [...prev];
          const updates: { rpe?: string; reps?: string } = {};
          if (needsRpeUpdate) updates.rpe = '9.5';
          if (needsRepsUpdate && predictedReps !== null) updates.reps = String(predictedReps);
          updated[lastIndex] = { ...updated[lastIndex], ...updates };
          return updated;
        });
      }

      // Mark prefill as done so we don't overwrite user edits
      amrapPrefillDoneRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAmrapSuggested, pendingInputs.length, completedSets]);
  
  // Recalculate suggestions when RPE or Form of the last completed set changes
  const lastCompletedSetRef = useRef<{ id: string; rpe: number | null; form: string | null } | null>(null);
  useEffect(() => {
    const lastCompleted = completedSets[completedSets.length - 1];
    if (lastCompleted && pendingSetsCount > 0) {
      const currentLastSet = {
        id: lastCompleted.id,
        rpe: lastCompleted.rpe || null,
        form: lastCompleted.feedback?.form || null,
      };
      
      const prevLastSet = lastCompletedSetRef.current;
      // Only recalculate if RPE or Form actually changed (not just on mount)
      if (prevLastSet && 
          prevLastSet.id === currentLastSet.id && 
          (prevLastSet.rpe !== currentLastSet.rpe || prevLastSet.form !== currentLastSet.form)) {
        recalculatePendingInputs();
      }
      
      lastCompletedSetRef.current = currentLastSet;
    } else if (!lastCompleted) {
      lastCompletedSetRef.current = null;
    }
  }, [completedSets, pendingSetsCount, recalculatePendingInputs]);

  // Swipe to delete handlers
  const handleTouchStart = (setId: string, e: React.TouchEvent) => {
    setSwipeState({
      setId,
      startX: e.touches[0].clientX,
      currentX: e.touches[0].clientX,
      isSwiping: false,
    });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeState.setId) return;
    const diff = swipeState.startX - e.touches[0].clientX;
    // Only allow left swipe
    if (diff > 10) {
      setSwipeState(prev => ({
        ...prev,
        currentX: e.touches[0].clientX,
        isSwiping: true,
      }));
    }
  };

  const handleTouchEnd = (setId: string, isCompleted: boolean) => {
    if (!swipeState.isSwiping) {
      setSwipeState({ setId: null, startX: 0, currentX: 0, isSwiping: false });
      return;
    }
    
    const swipeDistance = swipeState.startX - swipeState.currentX;
    const threshold = 100; // pixels to trigger delete
    
    if (swipeDistance > threshold) {
      if (isCompleted && onSetDelete) {
        onSetDelete(setId);
      } else if (!isCompleted) {
        // Remove pending set by reducing target sets
        if (onTargetSetsChange && Number(block.targetSets) > completedSets.length) {
          onTargetSetsChange(Number(block.targetSets) - 1);
        }
      }
    }
    
    setSwipeState({ setId: null, startX: 0, currentX: 0, isSwiping: false });
  };

  const getSwipeTransform = (setId: string) => {
    if (swipeState.setId !== setId || !swipeState.isSwiping) return {};
    const diff = Math.min(120, Math.max(0, swipeState.startX - swipeState.currentX));
    return {
      transform: `translateX(-${diff}px)`,
      transition: 'none',
    };
  };

  // Shared suggestion context for the setSuggestionEngine
  const suggestionCtx = { targetRepRange: block.targetRepRange, targetRir: effectiveTargetRir };

  const updatePendingInput = (index: number, field: 'weight' | 'reps' | 'rpe', value: string) => {
    // If user manually edits reps, cancel any pending debounced reps calculation
    // This prevents overwriting the user's manual input
    if (field === 'reps') {
      const existingTimeout = repsCalcTimeoutsRef.current.get(index);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        repsCalcTimeoutsRef.current.delete(index);
      }
    }

    setPendingInputs(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [field]: value };

        // If weight changed, schedule debounced auto-adjust of reps
        if (field === 'weight' && value) {
          const newWeightDisplay = parseFloat(value);
          if (!isNaN(newWeightDisplay) && newWeightDisplay > 0) {
            const newWeightKg = inputWeightToKg(newWeightDisplay, unit);

            // Get reference data
            const lastCompleted = completedSets[completedSets.length - 1];
            const prevSet = previousSets[completedSets.length + index];

            let refWeight = 0;
            let refReps = 0;
            let refRpe = 8; // Default RPE if not available

            if (lastCompleted) {
              refWeight = lastCompleted.weightKg;
              refReps = lastCompleted.reps;
              refRpe = lastCompleted.rpe;
            } else if (prevSet) {
              refWeight = prevSet.weightKg;
              refReps = prevSet.reps;
              // previousSets doesn't include RPE, use target RPE from block
              refRpe = 10 - effectiveTargetRir;
            } else if (suggestedWeight > 0) {
              refWeight = suggestedWeight;
              refReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
              refRpe = 10 - effectiveTargetRir;
            }

            if (refWeight > 0 && Math.abs(newWeightKg - refWeight) > 0.5) {
              // Weight changed significantly - schedule debounced reps recalculation
              // Clear any existing timeout for this index
              const existingTimeout = repsCalcTimeoutsRef.current.get(index);
              if (existingTimeout) {
                clearTimeout(existingTimeout);
              }

              // Store current reps value to check if user changes it before timeout fires
              const currentReps = updated[index].reps;

              // Schedule debounced reps update (400ms delay)
              const timeout = setTimeout(() => {
                repsCalcTimeoutsRef.current.delete(index);
                setPendingInputs(prevInputs => {
                  const newInputs = [...prevInputs];
                  // Only update reps if user hasn't manually changed it since we scheduled
                  if (newInputs[index] && newInputs[index].reps === currentReps) {
                    const newReps = estimateRepsForWeight(newWeightKg, { weightKg: refWeight, reps: refReps, rpe: refRpe }, suggestionCtx);
                    newInputs[index] = { ...newInputs[index], reps: String(newReps) };
                  }
                  return newInputs;
                });
              }, 400);

              repsCalcTimeoutsRef.current.set(index, timeout);
            }
          }
        }
      }
      return updated;
    });
  };

  // One-tap commit from the SetLoggerRow. The payload arrives in the exact
  // shape the persistence path expects: weight already converted to kg, RPE
  // derived from the selected RIR chip, feedback (form/discomfort/note sheet)
  // included, bodyweightData populated for bodyweight exercises.
  const completeLoggedSet = async (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
    feedback: SetFeedback;
    bodyweightData?: BodyweightData;
  }) => {
    if (isCompletingSet || !onSetComplete) return;
    if (isNaN(data.weightKg) || data.weightKg < 0 || data.reps < 1) return;

    // Lock to prevent double-clicks
    setIsCompletingSet(true);

    // Subtle haptic tick the moment a set is committed (native; no-op on web/iOS WKWebView).
    void lightHaptic();

    try {
      // Complete the set immediately (rest timer starts in parent)
      await onSetComplete({
        weightKg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        note: data.note,
        setType: 'normal',
        feedback: data.feedback,
        bodyweightData: data.bodyweightData,
      });
    } catch (error) {
      console.error('Set submission failed:', error);
      // Lock will be released in finally block
    } finally {
      // Always unlock after async operation completes (success or failure)
      // Small delay to prevent accidental double-taps on fast networks
      setTimeout(() => setIsCompletingSet(false), 100);
    }
  };


  // Start dropset mode with reduced weight
  const startDropset = (parentSet: SetLog) => {
    // Typical dropset reduces weight by 20-30%
    const reducedWeight = parentSet.weightKg * 0.75;
    setDropsetMode({
      parentSetId: parentSet.id,
      parentWeight: reducedWeight,
    });
    // Stop the rest timer when starting a dropset
    onDropsetStart?.();
  };
  
  // Cancel dropset mode
  const cancelDropset = () => {
    setDropsetMode(null);
  };

  const startEditing = (set: SetLog) => {
    setEditingSetId(set.id);
    setEditWeight(String(displayWeight(set.weightKg, true))); // Preserve exact value when editing
    setEditReps(String(set.reps));
    setEditRpe(String(set.rpe));
  };

  const cancelEditing = () => {
    setEditingSetId(null);
    setEditWeight('');
    setEditReps('');
    setEditRpe('');
  };

  const saveEdit = () => {
    if (!editingSetId || !onSetEdit) return;
    const weightNum = parseFloat(editWeight);
    const repsNum = parseInt(editReps);
    const rpeNum = parseFloat(editRpe);
    
    // Validate all fields have valid numbers
    if (isNaN(weightNum) || isNaN(repsNum) || isNaN(rpeNum)) {
      console.warn('Invalid edit values:', { editWeight, editReps, editRpe });
      cancelEditing();
      return;
    }
    
    // Validate reasonable ranges
    if (repsNum < 1 || rpeNum < 1 || rpeNum > 10 || weightNum < 0) {
      console.warn('Edit values out of range:', { weightNum, repsNum, rpeNum });
      cancelEditing();
      return;
    }
    
    const weightKg = inputWeightToKg(weightNum, unit);
    onSetEdit(editingSetId, { weightKg, reps: repsNum, rpe: rpeNum });
    cancelEditing();
  };

  // Handle Enter key to save edit
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  // Text color for the completed-line quality tag (mockup grammar):
  // stimulative=success, effective=neutral, junk=warning, excessive=danger.
  const qualityTextClass = (quality: SetQuality) => {
    switch (quality) {
      case 'stimulative': return 'text-success-400';
      case 'effective': return 'text-surface-400';
      case 'junk': return 'text-warning-400';
      case 'excessive': return 'text-danger-400';
      default: return 'text-surface-500';
    }
  };

  // Suggested weight/reps + reason sentence + plain-language explanation for
  // the SuggestionBanner. Computed fresh from the within-session recommender
  // (NOT from the editable pendingInputs, which only START as the suggestion)
  // so the banner keeps showing the AI suggestion after the user edits the
  // logger fields below it. Calibration / readiness modifiers are flagged
  // inline and fully explained in the info sheet.
  const buildSuggestionInfo = (
    isAmrap: boolean
  ): { weight: string; reps: string; reason: string; explanation: string[] } => {
    const lastCompleted = completedSets[completedSets.length - 1];
    const explanation: string[] = [];
    let reason: string;
    let weight = '';
    let reps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);

    const deltaLabel = (deltaKg: number) =>
      `${deltaKg > 0 ? '+' : '-'}${convertWeightForDisplay(Math.abs(deltaKg), unit)} ${weightLabel}`;

    if (lastCompleted) {
      const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe };
      const rec = recommendNext(lastSetData);
      weight = seedWeightString(rec.weightKg, lastCompleted.weightKg);
      reps = rec.reps;
      if (isAmrap && lastCompleted.rpe) {
        reps = Math.max(predictAmrapReps(lastSetData, suggestionCtx), reps);
      }
      const deltaKg = rec.weightKg - lastCompleted.weightKg;
      if (rec.rationale === 'increase_load') {
        reason = `up ${deltaLabel(deltaKg)} — last set was clearly too light`;
      } else if (rec.rationale === 'reduce_load') {
        reason = `down ${deltaLabel(deltaKg)} — last set was harder than the target effort`;
      } else {
        reason = 'holding the weight — your last set matched the target effort';
      }
      explanation.push(
        `Anchored to your last set: ${displayWeight(lastCompleted.weightKg, true)} ${weightLabel} × ${lastCompleted.reps} at RPE ${lastCompleted.rpe}. Its estimated 1RM sets the capacity this prediction works back from.`
      );
    } else {
      // Mirror the pending-input seed: previous-session set for this slot
      // first, then the block/profile-level suggested weight.
      const prevSet = previousSets[completedSets.length];
      let weightKg = 0;
      if (prevSet) {
        const seeded = seedFromPreviousSet(prevSet, block.targetRepRange);
        weightKg = seeded.weightKg;
        reps = seeded.reps;
      } else if (suggestedWeight > 0) {
        weightKg = suggestedWeight;
      }
      weight = seedWeightString(weightKg, prevSet?.weightKg);

      const lastSessionTop = exerciseHistory?.lastWorkoutSets?.[0];
      if (lastSessionTop && weightKg > 0) {
        const deltaKg = weightKg - lastSessionTop.weightKg;
        reason =
          Math.abs(deltaKg) < 0.25
            ? 'matching your last session'
            : `${deltaKg > 0 ? 'up' : 'down'} ${deltaLabel(deltaKg)} vs last session`;
        explanation.push(
          `Anchored to your last session: ${displayWeight(lastSessionTop.weightKg, true)} ${weightLabel} × ${lastSessionTop.reps}.`
        );
      } else if (weightKg > 0) {
        reason = 'starting point estimated from your training profile';
        explanation.push('No history for this exercise yet — the starting weight is estimated from your profile and calibrated lifts.');
      } else {
        reason = 'enter your working weight to calibrate';
        explanation.push('Log a first set and future suggestions will anchor to it.');
      }
      if (exerciseHistory && exerciseHistory.estimatedE1RM > 0) {
        explanation.push(
          `Best estimated 1RM on record: ${displayWeight(exerciseHistory.estimatedE1RM)} ${weightLabel}.`
        );
      }
    }

    explanation.push(
      `Target: ${block.targetRepRange[0]}-${block.targetRepRange[1]} ${isDurationBased ? 'seconds' : 'reps'} leaving ${effectiveTargetRir} in reserve (RIR ${effectiveTargetRir}).`
    );

    if (adjustedRir?.hasAdjustment && adjustedRir.adjustmentReason) {
      reason += ' · calibration-adjusted';
      explanation.push(`Calibration: ${adjustedRir.adjustmentReason}.`);
    }
    if (readinessModulation?.banner) {
      reason += ' · eased for readiness';
      explanation.push(`Readiness: ${readinessModulation.banner}.`);
    }
    if (isAmrap) {
      explanation.push('Last set: push to failure (AMRAP) so the app can calibrate how you rate effort.');
    }

    return { weight, reps: String(reps), reason, explanation };
  };

  // Single meta line under the exercise name (mockup 2.4):
  // "{muscle} · last session 60 lbs × 9, × 8 @ 2 RIR"
  const lastSessionMeta = (() => {
    const lastSets = exerciseHistory?.lastWorkoutSets ?? [];
    if (lastSets.length === 0) return null;
    const repsPart = lastSets
      .slice(0, 3)
      .map((s) => `× ${s.reps}${isDurationBased ? 's' : ''}`)
      .join(', ');
    const rir = lastSets[0].rpe != null ? Math.max(0, Math.round(10 - lastSets[0].rpe)) : null;
    return `last session ${displayWeight(lastSets[0].weightKg, true)} ${weightLabel} ${repsPart}${
      rir !== null ? ` @ ${rir} RIR` : ''
    }`;
  })();

  return (
    <Card
      variant={isActive ? 'elevated' : 'default'}
      padding="none"
      className={`relative overflow-hidden transition-all ${
        isActive ? 'ring-2 ring-primary-500/50' : ''
      }`}
    >
      {/* Header — slim: name + pills on one line, one meta line below (2.4) */}
      <div className="p-4 border-b border-surface-800 sticky top-0 bg-surface-900 z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={onExerciseNameClick}
            className="min-w-0 text-[15px] font-medium text-surface-100 truncate hover:text-primary-400 transition-colors text-left"
          >
            {exercise.name}
          </button>
          {exercise.hypertrophyScore?.tier && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none flex-shrink-0 ${getTierBadgeClasses(exercise.hypertrophyScore.tier)}`}>
              {exercise.hypertrophyScore.tier}
            </span>
          )}
          {/* Plateau badge (services/plateauDetector) — opens the suggestions sheet */}
          {plateau && (
            <button
              onClick={() => setShowPlateauSheet(true)}
              className="rounded-full px-2.5 py-1 text-[11px] font-medium leading-none flex-shrink-0 bg-warning-500/10 text-warning-400 hover:bg-warning-500/20 transition-colors"
              aria-haspopup="dialog"
            >
              Plateau
            </button>
          )}
          {block.supersetGroupId && (
            <span className="rounded-full px-2.5 py-1 text-[11px] font-medium leading-none flex-shrink-0 bg-cyan-500/20 text-cyan-400">
              SS{block.supersetOrder}
            </span>
          )}
          <SafetyTierBadge
            tier={getFailureSafetyTier(exercise.name)}
            variant="short"
            showTooltip={true}
          />
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {/* Set add/remove moved to the footer (next to "+ Add Set") to declutter the header */}
            {/* Overflow menu: secondary exercise actions (watch form, swap, plates, remove) */}
            {isActive && (onExerciseSwap || onExerciseDelete || onPlateCalculatorOpen) && (
              <div className="relative">
                <button
                  onClick={() => setShowExerciseMenu((v) => !v)}
                  className="min-w-[44px] min-h-[44px] p-2.5 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
                  title="More"
                  aria-haspopup="menu"
                  aria-expanded={showExerciseMenu}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z" />
                  </svg>
                </button>
                {showExerciseMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExerciseMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1" role="menu">
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setShowExerciseMenu(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors"
                        role="menuitem"
                      >
                        <svg className="w-4 h-4 text-red-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                        </svg>
                        Watch form
                      </a>
                      {onExerciseSwap && similarExercises.length > 0 && (
                        <button
                          onClick={() => { setShowSwapModal(true); setShowExerciseMenu(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                          role="menuitem"
                        >
                          <svg className="w-4 h-4 text-warning-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Swap exercise
                        </button>
                      )}
                      {onPlateCalculatorOpen && (
                        <button
                          onClick={() => {
                            const initialWeight = block.targetWeightKg || workingWeight || recommendedWeight || 0;
                            onPlateCalculatorOpen(initialWeight > 0 ? initialWeight : undefined);
                            setShowExerciseMenu(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                          role="menuitem"
                        >
                          <svg className="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          Plate calculator
                        </button>
                      )}
                      {onExerciseDelete && (
                        <button
                          onClick={() => {
                            setShowExerciseMenu(false);
                            if (confirm(`Remove "${exercise.name}" from this workout?`)) {
                              onExerciseDelete();
                            }
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-danger-400 hover:bg-danger-500/10 transition-colors text-left border-t border-surface-700/60 mt-1"
                          role="menuitem"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Remove exercise
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <Badge variant={progressPercent === 100 ? 'success' : 'default'}>
              {completedSets.length}/{block.targetSets}
            </Badge>
          </div>
        </div>

        {/* Meta line — doubles as the history expandable trigger */}
        <button
          onClick={() => exerciseHistory && setShowHistory(!showHistory)}
          disabled={!exerciseHistory}
          className="mt-1 flex items-center justify-between w-full gap-2 text-left"
        >
          <p className="min-w-0 text-[11px] text-surface-500 truncate">
            <span>{formatMuscleName(exercise.primaryMuscle)}</span>
            {isBodyweightExercise && ' · bodyweight'}
            {lastSessionMeta && <> · {lastSessionMeta}</>}
          </p>
          {exerciseHistory && (
            <IconChevronDown
              size={14}
              className={`flex-shrink-0 text-surface-500 transition-transform ${showHistory ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          )}
        </button>

        {/* Weight mode segmented control for bodyweight exercises */}
        {isBodyweightExercise && !isPureBodyweight && userBodyweightKg && (
          <div className="mt-2">
            <SegmentedControl
              options={[
                { value: 'bodyweight', label: 'Bodyweight', disabled: false },
                { value: 'weighted', label: 'Weighted', disabled: !canAddWeight },
                { value: 'assisted', label: 'Assisted', disabled: !canUseAssistance },
              ]}
              value={weightMode}
              onChange={(value) => setWeightMode(value as 'bodyweight' | 'weighted' | 'assisted')}
            />
          </div>
        )}

        {/* Expanded history detail (behind the meta-line expandable) */}
        {exerciseHistory && showHistory && (
          <div className="mt-3 pt-3 border-t border-surface-800">
            <div className="space-y-3">
                {/* Estimated 1RM + session count */}
                {exerciseHistory.estimatedE1RM > 0 && (
                  <p className="text-xs text-surface-400">
                    Estimated 1RM{' '}
                    <span className="text-surface-200">
                      {displayWeight(exerciseHistory.estimatedE1RM)} {weightLabel}
                    </span>
                    <span className="text-surface-600"> · </span>
                    {exerciseHistory.totalSessions} session{exerciseHistory.totalSessions === 1 ? '' : 's'}
                  </p>
                )}
                {/* Last workout */}
                {exerciseHistory.lastWorkoutSets.length > 0 && (
                  <div className="p-3 bg-surface-800/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                        Last Workout
                      </span>
                      <span className="text-xs text-surface-500">
                        {new Date(exerciseHistory.lastWorkoutDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {exerciseHistory.lastWorkoutSets.map((set, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-surface-700 rounded text-xs text-surface-300"
                        >
                          {displayWeight(set.weightKg, true)} × {set.reps}{isDurationBased ? 's' : ''}
                          {set.rpe && <span className="text-surface-500"> @{set.rpe}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Exercise resources - only show Exercise Info link here (Watch Form is in header) */}
                <div className="flex gap-2">
                  <a
                    href={`https://exrx.net/Lists/Directory`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded-lg text-xs text-surface-300 transition-colors"
                  >
                    <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Exercise Info
                  </a>
                </div>
            </div>
          </div>
        )}
      </div>

      {/* Warmup sets - keep in separate table for now (legacy) */}
      {isActive && warmupSets.length > 0 && workingWeight > 0 && (
        <div className="border-b border-surface-800">
          {/* Collapsible header */}
          <button
            onClick={() => setIsWarmupExpanded(!isWarmupExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-surface-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  completedWarmups.size === warmupSets.length
                    ? 'bg-success-500/20 text-success-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                {completedWarmups.size === warmupSets.length ? '✓' : completedWarmups.size}
              </div>
              <span className="text-sm font-medium text-surface-200">
                Warmup Protocol
              </span>
              <span className="text-xs text-surface-500">
                ({completedWarmups.size}/{warmupSets.length})
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-surface-400 transition-transform ${
                isWarmupExpanded ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Warmup table - only show when expanded */}
          {isWarmupExpanded && (
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-800/50">
                  <tr>
                    <th className="px-1.5 py-2 text-left text-surface-400 font-medium">Set</th>
                    <th className="px-1 py-2 text-center text-surface-400 font-medium">Weight</th>
                    <th className="px-1 py-2 text-center text-surface-400 font-medium">{isDurationBased ? 'Sec' : 'Reps'}</th>
                    <th className="px-1 py-2 text-center text-surface-400 font-medium">Form</th>
                    <th className="px-1 py-2 text-center text-surface-400 font-medium">Purpose</th>
                    <th className="px-1 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800">
                {warmupSets.map((warmup) => {
                  const calculatedWeightKg = workingWeight * (warmup.percentOfWorking / 100);
                  const hasCustomWeight = customWarmupWeights.has(warmup.setNumber);
                  const warmupWeightKg = hasCustomWeight 
                    ? customWarmupWeights.get(warmup.setNumber)! 
                    : calculatedWeightKg;
                  const warmupWeightForDisplayKg = hasCustomWeight
                    ? warmupWeightKg
                    : roundToPlateIncrement(warmupWeightKg, unit);
                  const warmupWeightForDisplay = parseFloat(
                    convertWeight(warmupWeightForDisplayKg, 'kg', unit).toFixed(1)
                  );
                  // For bodyweight exercises with no added weight, show "BW"
                  // For weighted/assisted bodyweight exercises, show the actual warmup weight
                  const displayWarmupWeight = warmupWeightForDisplayKg === 0
                    ? (isBodyweightExercise ? 'BW' : 'Empty')
                    : warmupWeightForDisplay;
                  const isWarmupCompleted = completedWarmups.has(warmup.setNumber);
                  const isEditingThis = editingWarmupId === warmup.setNumber;
                  
                  return (
                    <tr
                      key={`warmup-${warmup.setNumber}`}
                      className={`${isWarmupCompleted ? 'bg-amber-500/5' : 'bg-amber-500/10'}`}
                    >
                      <td className="px-1.5 py-2 text-amber-400 font-medium text-xs">
                        W{warmup.setNumber}
                      </td>
                      <td className="px-1 py-2 text-center">
                        {isEditingThis ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            value={warmupWeightInput}
                            onChange={(e) => setWarmupWeightInput(e.target.value)}
                            onBlur={() => {
                              const newWeight = parseFloat(warmupWeightInput);
                              if (!isNaN(newWeight) && newWeight >= 0) {
                                const weightInKg = inputWeightToKg(newWeight, unit);
                                setCustomWarmupWeights(prev => new Map(prev).set(warmup.setNumber, weightInKg));
                              }
                              setEditingWarmupId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const newWeight = parseFloat(warmupWeightInput);
                                if (!isNaN(newWeight) && newWeight >= 0) {
                                  const weightInKg = inputWeightToKg(newWeight, unit);
                                  setCustomWarmupWeights(prev => new Map(prev).set(warmup.setNumber, weightInKg));
                                }
                                setEditingWarmupId(null);
                              } else if (e.key === 'Escape') {
                                setEditingWarmupId(null);
                              }
                            }}
                            autoFocus
                            className="w-full px-1 py-0.5 text-center font-mono text-sm bg-surface-900 border border-amber-500 rounded text-surface-100"
                          />
                        ) : (
                          <button
                            onClick={() => {
                              setEditingWarmupId(warmup.setNumber);
                              setWarmupWeightInput(warmupWeightForDisplay.toString());
                            }}
                            className="font-mono text-surface-300 hover:text-amber-400 transition-colors"
                          >
                            {displayWarmupWeight}
                            {hasCustomWeight && <span className="text-amber-400 text-xs ml-1">*</span>}
                          </button>
                        )}
                      </td>
                      <td className="px-1 py-2 text-center font-mono text-surface-300">
                        {warmup.targetReps}
                      </td>
                      <td className="px-1 py-2 text-center text-surface-500 text-xs">—</td>
                      <td className="px-1 py-2 text-center">
                        <span className="text-xs text-amber-400/70">{warmup.purpose}</span>
                      </td>
                      <td className="px-1 py-2">
                        <button
                          onClick={() => {
                            const wasCompleted = completedWarmups.has(warmup.setNumber);
                            setCompletedWarmups(prev => {
                              const next = new Set(prev);
                              if (next.has(warmup.setNumber)) {
                                next.delete(warmup.setNumber);
                              } else {
                                next.add(warmup.setNumber);
                              }
                              return next;
                            });
                            if (!wasCompleted && onWarmupComplete) {
                              const restTime = warmup.restSeconds || 45;
                              onWarmupComplete(restTime);
                            }
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isWarmupCompleted
                              ? 'bg-amber-500 text-white'
                              : 'bg-surface-700 hover:bg-surface-600 text-surface-400'
                          }`}
                        >
                          {isWarmupCompleted ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {completedWarmups.size < warmupSets.length && (
                  <tr className="bg-surface-800/30">
                    <td colSpan={6} className="px-3 py-1.5 text-center">
                      <button
                        onClick={() => setCompletedWarmups(new Set(warmupSets.map(w => w.setNumber)))}
                        className="text-xs text-surface-500 hover:text-surface-400 transition-colors"
                      >
                        Skip warmup (already warm)
                      </button>
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Set list — compact completed lines, one-tap active logger, muted pending targets (mockup 2.1) */}
      <div className="px-3 py-3 space-y-1.5">
        {/* Completed working sets */}
        {completedSets.map((set, setIndex) => {
          const isDropsetSet = set.setType === 'dropset';
          const isLastCompletedSet = setIndex === completedSets.length - 1;

          // Editing: bodyweight sets get the dedicated edit row
          if (editingSetId === set.id && set.bodyweightData && userBodyweightKg) {
            return (
              <BodyweightSetEditRow
                key={set.id}
                set={set}
                userBodyweightKg={userBodyweightKg}
                canAddWeight={canAddWeight}
                canUseAssistance={canUseAssistance}
                isPureBodyweight={isPureBodyweight}
                unit={unit}
                onSave={(data) => {
                  if (onSetEdit) {
                    onSetEdit(set.id, {
                      weightKg: data.weightKg,
                      reps: data.reps,
                      rpe: data.rpe,
                      bodyweightData: data.bodyweightData,
                    });
                  }
                  cancelEditing();
                }}
                onCancel={cancelEditing}
              />
            );
          }

          // Editing: standard sets get inline weight/reps inputs
          if (editingSetId === set.id) {
            return (
              <div key={set.id} className="flex items-center gap-2 rounded-lg bg-primary-500/10 px-2 py-1.5">
                <span className="w-6 flex-shrink-0 text-[12px] font-medium text-surface-300 text-center">
                  {set.setNumber}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={editWeight}
                  onChange={(e) => setEditWeight(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={handleEditKeyDown}
                  step="0.5"
                  aria-label="Edit weight"
                  className="w-20 px-1 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                  autoFocus
                />
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={editReps}
                  onChange={(e) => setEditReps(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={handleEditKeyDown}
                  aria-label="Edit reps"
                  className="w-14 px-1 py-1.5 bg-surface-900 border border-surface-600 rounded text-center font-mono text-surface-100 text-sm"
                />
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={saveEdit}
                    aria-label="Save set edit"
                    className="p-2 text-success-400 hover:bg-success-500/20 rounded-lg"
                  >
                    <IconCheck size={16} />
                  </button>
                  <button
                    onClick={cancelEditing}
                    aria-label="Cancel set edit"
                    className="p-2 text-surface-400 hover:bg-surface-700 rounded-lg"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  {onSetDelete && (
                    <button
                      onClick={() => {
                        cancelEditing();
                        onSetDelete(set.id);
                      }}
                      aria-label="Delete set"
                      className="p-2 text-danger-400 hover:bg-danger-500/10 rounded-lg"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // Completed line: "✓ Set 1 · 62.5 lbs × 9    2 RIR · stimulative"
          const completedWeight = set.bodyweightData
            ? displayWeight(set.bodyweightData.effectiveLoadKg, true)
            : displayWeight(set.weightKg, true);
          const rirValue = set.feedback?.repsInTank ?? rpeToRir(set.rpe);

          return (
            <React.Fragment key={set.id}>
              <div
                className={`flex items-center gap-2 px-1 py-2 ${
                  isDropsetSet ? 'bg-purple-500/5 rounded-lg' : ''
                } ${onSetEdit ? 'cursor-pointer hover:bg-surface-800/30 rounded-lg' : ''}`}
                onClick={() => onSetEdit && startEditing(set)}
                onTouchStart={(e) => handleTouchStart(set.id, e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={() => handleTouchEnd(set.id, true)}
                style={getSwipeTransform(set.id)}
              >
                {/* Write-status glyph (P0-2): saved ✓ / saving spinner / queued ⏸ */}
                {setSyncStatus?.[set.id] === 'saving' ? (
                  <span
                    className="w-3.5 h-3.5 flex-shrink-0 rounded-full border-2 border-surface-600 border-t-surface-300 animate-spin"
                    role="status"
                    aria-label="Saving set"
                  />
                ) : setSyncStatus?.[set.id] === 'queued' ? (
                  <IconCloudPause
                    size={16}
                    className="text-warning-400 flex-shrink-0"
                    role="status"
                    aria-label="Queued — will sync when online"
                  />
                ) : (
                  <IconCheck size={16} className="text-success-400 flex-shrink-0" aria-hidden="true" />
                )}
                {isDropsetSet && (
                  <span className="text-[11px] text-purple-400 flex-shrink-0">drop</span>
                )}
                <span className="text-[13px] text-surface-300 truncate">
                  Set {set.setNumber} · {set.bodyweightData?.modification === 'none' ? 'BW ' : ''}
                  {completedWeight} {weightLabel} × {set.reps}
                  {isDurationBased ? 's' : ''}
                </span>
                <span className="ml-auto flex-shrink-0 text-[11px] text-surface-500">
                  {setSyncStatus?.[set.id] === 'queued' && (
                    <span className="text-warning-400 mr-1.5">queued</span>
                  )}
                  {rirValue} RIR · <span className={qualityTextClass(set.quality)}>{set.quality}</span>
                </span>
              </div>

              {/* Add Dropset affordance after the final completed set */}
              {isActive && isLastCompletedSet && !dropsetMode && !isDropsetSet && !pendingDropset &&
               pendingSetsCount === 0 && (!block.dropsetsPerSet || block.dropsetsPerSet === 0) && (
                <button
                  onClick={() => startDropset(set)}
                  className="w-full flex items-center justify-center gap-2 py-1.5 text-sm text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Add Dropset (reduce weight, continue to failure)
                </button>
              )}
            </React.Fragment>
          );
        })}

        {/* Auto-triggered Dropset Prompt */}
        {isActive && pendingDropset && (
          <DropsetPrompt
            parentWeight={pendingDropset.parentWeight}
            dropNumber={pendingDropset.dropNumber}
            totalDrops={pendingDropset.totalDrops}
            dropPercentage={block.dropPercentage ?? 0.25}
            unit={unit}
            exerciseEquipment={exercise.equipmentRequired}
            onComplete={(data) => {
              if (onSetComplete) {
                onSetComplete({
                  weightKg: data.weightKg,
                  reps: data.reps,
                  rpe: data.rpe,
                  setType: 'dropset',
                  parentSetId: pendingDropset.parentSetId,
                });
              }
            }}
            onCancel={() => onDropsetCancel?.()}
          />
        )}

        {/* Inline Rest Timer */}
        {isActive && (showRestTimer || (timerIsSkipped && timerRestedSeconds > 0)) && !pendingDropset && (
          <InlineRestTimerBar
            seconds={timerSeconds}
            initialSeconds={timerInitialSeconds}
            isRunning={timerIsRunning}
            isFinished={timerIsFinished}
            isSkipped={timerIsSkipped}
            restedSeconds={timerRestedSeconds}
            onShowControls={onShowTimerControls}
            variant="div"
          />
        )}

        {/* Manual dropset entry */}
        {isActive && dropsetMode && !pendingDropset && (
          <div className="flex items-center gap-2 rounded-lg bg-purple-500/20 border-l-2 border-purple-500 px-2 py-1.5">
            <span className="text-xs font-medium text-purple-400 flex-shrink-0">Drop</span>
            <input
              type="number"
              inputMode="decimal"
              defaultValue={displayWeight(dropsetMode.parentWeight).toString()}
              id="dropset-weight-input"
              step="0.5"
              aria-label="Dropset weight"
              className="w-20 px-1 py-1.5 bg-surface-900 border border-purple-500/50 rounded text-center font-mono text-surface-100 text-sm"
              autoFocus
            />
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue=""
              id="dropset-reps-input"
              placeholder="?"
              aria-label="Dropset reps"
              className="w-14 px-1 py-1.5 bg-surface-900 border border-purple-500/50 rounded text-center font-mono text-surface-100 text-sm placeholder-surface-500"
            />
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => {
                  const weightEl = document.getElementById('dropset-weight-input') as HTMLInputElement;
                  const repsEl = document.getElementById('dropset-reps-input') as HTMLInputElement;

                  const weight = parseFloat(weightEl?.value || '0');
                  const reps = parseInt(repsEl?.value || '0');
                  const rpe = 10; // dropsets are taken to/near failure

                  if (weight > 0 && reps > 0 && onSetComplete) {
                    const weightKg = inputWeightToKg(weight, unit);
                    onSetComplete({
                      weightKg,
                      reps,
                      rpe,
                      setType: 'dropset',
                      parentSetId: dropsetMode.parentSetId,
                    });
                    setDropsetMode(null);
                  }
                }}
                aria-label="Log dropset"
                className="p-2 rounded-lg bg-purple-500 hover:bg-purple-600 transition-colors text-white"
              >
                <IconCheck size={16} />
              </button>
              <button
                onClick={cancelDropset}
                aria-label="Cancel dropset"
                className="p-2 rounded-lg bg-surface-700 hover:bg-surface-600 transition-colors"
              >
                <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Active set: suggestion banner + one-tap logger */}
        {isActive && !pendingDropset && !dropsetMode && pendingSetsCount > 0 && pendingInputs.length > 0 && (() => {
          const input = pendingInputs[0];
          const activeSetNumber = completedSets.length + 1;
          const activeIsAmrap = isAmrapSuggested && pendingSetsCount === 1;
          const loggerTargetRir = activeIsAmrap ? 0 : effectiveTargetRir;
          const usesBwLoad = isBodyweightExercise && weightMode !== 'bodyweight';

          const suggestion = buildSuggestionInfo(activeIsAmrap);
          const bannerWeight = isBodyweightExercise
            ? weightMode === 'bodyweight'
              ? 'BW'
              : `BW ${weightMode === 'weighted' ? '+' : '-'}${bwLoadInput || '0'} ${weightLabel}`
            : `${suggestion.weight || '—'} ${weightLabel}`;

          return (
            <div className="space-y-2 pt-1">
              <SuggestionBanner
                weightLabel={bannerWeight}
                repsLabel={`${suggestion.reps || '—'}${isDurationBased ? 's' : ''}`}
                rir={Math.max(0, Math.min(3, loggerTargetRir))}
                reason={suggestion.reason}
                explanation={suggestion.explanation}
              />
              <SetLoggerRow
                setNumber={activeSetNumber}
                weight={usesBwLoad ? bwLoadInput : input.weight}
                reps={input.reps}
                onWeightChange={(value) =>
                  usesBwLoad ? setBwLoadInput(value) : updatePendingInput(0, 'weight', value)
                }
                onRepsChange={(value) => updatePendingInput(0, 'reps', value)}
                targetRir={loggerTargetRir}
                unit={unit}
                minIncrementKg={exercise.minWeightIncrementKg}
                disabled={isCompletingSet}
                isDurationBased={isDurationBased}
                isBodyweight={isBodyweightExercise}
                weightMode={weightMode}
                userBodyweightKg={userBodyweightKg}
                onLog={completeLoggedSet}
                onPlateCalculatorOpen={
                  onPlateCalculatorOpen && !isBodyweightExercise
                    ? () => {
                        const w = parseFloat(usesBwLoad ? bwLoadInput : input.weight);
                        onPlateCalculatorOpen(
                          !isNaN(w) && w > 0 ? inputWeightToKg(w, unit) : undefined
                        );
                      }
                    : undefined
                }
              />
            </div>
          );
        })()}

        {/* Pending sets: muted single-line targets */}
        {Array.from({ length: pendingSetsCount }).map((_, i) => {
          const isActiveLoggerSlot = isActive && !pendingDropset && !dropsetMode && i === 0;
          if (isActiveLoggerSlot) return null;

          const pendingSetNumber = completedSets.length + i + 1;
          const pendingWeight = isBodyweightExercise
            ? 'BW'
            : pendingInputs[i]?.weight ||
              (suggestedWeight > 0 ? String(displayWeight(suggestedWeight)) : '—');

          return (
            <div
              key={`pending-${pendingSetNumber}`}
              className="flex items-center gap-2 px-1 py-2 text-[12px] text-surface-500"
            >
              <span className="w-4 flex-shrink-0 text-center">{pendingSetNumber}</span>
              <span className="text-surface-700" aria-hidden="true">|</span>
              <span className="truncate">
                {pendingWeight}
                {!isBodyweightExercise && pendingWeight !== '—' ? ` ${weightLabel}` : ''} ×{' '}
                {block.targetRepRange[0]}–{block.targetRepRange[1]} target
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer actions - prominent "Add set" (mockup style) + quiet secondary links */}
      {isActive && (
        <div className="px-3 py-3 space-y-2">
          {onTargetSetsChange && (
            <button
              onClick={() => onTargetSetsChange(Number(block.targetSets) + 1)}
              disabled={Number(block.targetSets) >= 10}
              className="w-full py-2.5 rounded-lg border border-dashed border-surface-700 text-sm text-surface-400 hover:text-surface-200 hover:border-surface-500 transition-colors disabled:opacity-30"
            >
              + Add set
            </button>
          )}
          <div className="flex items-center gap-4 text-xs px-1">
            {onTargetSetsChange && (
              <button
                onClick={() => onTargetSetsChange(Math.max(1, (Number(block.targetSets) || 1) - 1))}
                disabled={Number(block.targetSets) <= completedSets.length || Number(block.targetSets) <= 1}
                className="text-surface-500 hover:text-surface-300 transition-colors disabled:opacity-30"
              >
                − Remove set
              </button>
            )}
            {onBlockNoteUpdate && (
              <button
                onClick={() => setIsEditingNote(true)}
                className="text-surface-500 hover:text-surface-300 transition-colors"
              >
                Notes
              </button>
            )}
          </div>
        </div>
      )}

      {/* Form cues accordion */}
      {exercise.formCues.length > 0 && (
        <div className="border-t border-surface-800">
          <Accordion>
            <AccordionItem id="form-cues">
              <div className="px-4">
                <AccordionTrigger id="form-cues">
                  <span className="text-sm text-surface-400">Form Cues & Tips</span>
                </AccordionTrigger>
                <AccordionContent id="form-cues">
                  <div className="space-y-3">
                    {/* Exercise Demo Video/Image */}
                    {(() => {
                      const demoGifUrl = exercise.demoGifUrl || (exercise as any).demo_gif_url;
                      const youtubeVideoId = exercise.youtubeVideoId || (exercise as any).youtube_video_id;
                      
                      if (!demoGifUrl && !youtubeVideoId) return null;
                      
                      const isVideo = demoGifUrl && (demoGifUrl.endsWith('.mp4') || demoGifUrl.endsWith('.webm') || demoGifUrl.endsWith('.mov'));
                      const isImage = demoGifUrl && !isVideo;
                      
                      return (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                            Exercise Demo
                          </p>
                          {isVideo && (
                            <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700">
                              <video
                                src={demoGifUrl}
                                className="w-full h-auto max-h-48 object-contain"
                                controls
                                loop
                                muted
                                playsInline
                                onError={(e) => {
                                  console.error('[ExerciseCard] Failed to load video:', demoGifUrl);
                                  (e.target as HTMLVideoElement).style.display = 'none';
                                }}
                              >
                                Your browser does not support the video tag.
                              </video>
                            </div>
                          )}
                          {isImage && (
                            <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={demoGifUrl}
                                alt={`${exercise.name} demonstration`}
                                className="w-full h-auto max-h-48 object-contain"
                                loading="lazy"
                                onError={(e) => {
                                  console.error('[ExerciseCard] Failed to load image:', demoGifUrl);
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                          {youtubeVideoId && (
                            <div className="relative rounded-lg overflow-hidden bg-surface-900 border border-surface-700 aspect-video">
                              <iframe
                                src={`https://www.youtube.com/embed/${youtubeVideoId}?rel=0`}
                                title={`${exercise.name} form video`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="absolute inset-0 w-full h-full"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div>
                      <h4 className="text-xs font-medium text-surface-300 uppercase tracking-wide mb-1">
                        Key Cues
                      </h4>
                      <ul className="space-y-1">
                        {exercise.formCues.map((cue, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-surface-400">
                            <span className="text-primary-400 mt-1">•</span>
                            {cue}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {exercise.commonMistakes.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-surface-300 uppercase tracking-wide mb-1">
                          Common Mistakes
                        </h4>
                        <ul className="space-y-1">
                          {exercise.commonMistakes.map((mistake, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-danger-400/80">
                              <span className="mt-1">✗</span>
                              {mistake}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {exercise.setupNote && (
                      <div className="pt-2 border-t border-surface-800">
                        <p className="text-xs text-surface-500">
                          <span className="font-medium">Setup:</span> {exercise.setupNote}
                        </p>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </div>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* Exercise Notes Section */}
      <div className="border-t border-surface-800 p-4">
        {isEditingNote ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-surface-400 uppercase tracking-wide">
              Notes
            </label>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add notes for this exercise (e.g., form reminders, weight adjustments, how it felt...)"
              className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-200 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setNoteText(block.note || '');
                  setIsEditingNote(false);
                }}
                className="px-3 py-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const newNote = noteText.trim() || null;
                  onBlockNoteUpdate?.(newNote);
                  setIsEditingNote(false);
                }}
                className="px-3 py-1.5 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : block.note ? (
          <button
            onClick={() => setIsEditingNote(true)}
            className="w-full text-left group"
          >
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-surface-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-surface-300 whitespace-pre-wrap">{block.note}</p>
                <span className="text-xs text-surface-500 group-hover:text-primary-400 transition-colors">
                  Click to edit
                </span>
              </div>
            </div>
          </button>
        ) : (
          <button
            onClick={() => setIsEditingNote(true)}
            className="flex items-center gap-2 text-sm text-surface-500 hover:text-surface-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add note
          </button>
        )}
      </div>

      {/* Swap Exercise Modal */}
      {showSwapModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowSwapModal(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div 
            className="relative w-full max-w-lg max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-xl shadow-2xl border border-surface-700 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-surface-700">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Swap Exercise</h3>
                <button
                  onClick={() => setShowSwapModal(false)}
                  className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-surface-400 mt-1">
                Replace <span className="text-surface-200 font-medium">{exercise.name}</span>
              </p>
              
              {/* Tabs */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setSwapTab('similar')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    swapTab === 'similar'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  Similar ({similarExercises.length})
                </button>
                <button
                  onClick={() => setSwapTab('browse')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    swapTab === 'browse'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  Browse All
                </button>
              </div>
            </div>
            
            {/* Search & Filter (only for Browse tab) */}
            {swapTab === 'browse' && (
              <div className="p-3 border-b border-surface-700 space-y-2">
                <Input
                  placeholder="Search exercises..."
                  value={swapSearch}
                  onChange={(e) => setSwapSearch(e.target.value)}
                />
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                  <button
                    onClick={() => setSwapMuscleFilter('')}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                      !swapMuscleFilter
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    All
                  </button>
                  {MUSCLE_GROUPS.map((muscle) => (
                    <button
                      key={muscle}
                      onClick={() => setSwapMuscleFilter(muscle)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap capitalize transition-colors ${
                        swapMuscleFilter === muscle
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                      }`}
                    >
                      {muscle}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Exercise List */}
            <div className="flex-1 overflow-y-auto p-2">
              {swapTab === 'similar' ? (
                // Similar exercises with match scores
                <>
                  {/* Injury warning banner */}
                  {hasInjuries && (
                    <div className={`mb-3 p-3 rounded-lg ${
                      safeAlternatives.length > 0 
                        ? 'bg-success-500/10 border border-success-500/20' 
                        : 'bg-warning-500/10 border border-warning-500/20'
                    }`}>
                      {safeAlternatives.length > 0 ? (
                        <p className="text-xs text-success-400">
                          ✓ <span className="font-medium">{safeAlternatives.length} safe alternative{safeAlternatives.length !== 1 ? 's' : ''}</span> found that won&apos;t aggravate your injury
                        </p>
                      ) : (
                        <p className="text-xs text-warning-400">
                          ⚠️ <span className="font-medium">No safe alternatives found</span> - all similar exercises may aggravate your injury. Consider skipping this exercise.
                        </p>
                      )}
                    </div>
                  )}
                
                  {similarExercises.map(({ exercise: alt, score, injuryRisk }) => (
                    <button
                      key={alt.id}
                      onClick={() => {
                        if (onExerciseSwap) {
                          onExerciseSwap(alt);
                          setShowSwapModal(false);
                        }
                      }}
                      className={`w-full p-3 text-left rounded-lg transition-colors flex items-center gap-3 ${
                        injuryRisk.isRisky 
                          ? 'hover:bg-danger-500/10 opacity-60' 
                          : 'hover:bg-surface-800'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${injuryRisk.isRisky ? 'text-surface-400' : 'text-surface-100'}`}>
                            {alt.name}
                          </p>
                          {injuryRisk.isRisky && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                              injuryRisk.severity === 3 
                                ? 'bg-danger-500/20 text-danger-400' 
                                : 'bg-warning-500/20 text-warning-400'
                            }`}>
                              ⚠️ {injuryRisk.severity === 3 ? 'Risky' : 'Caution'}
                            </span>
                          )}
                          {!injuryRisk.isRisky && hasInjuries && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-500/20 text-success-400 flex-shrink-0">
                              ✓ Safe
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-surface-500 capitalize">
                          {formatMuscleName(alt.primaryMuscle)} • {alt.mechanic}
                        </p>
                        {injuryRisk.isRisky && injuryRisk.reasons.length > 0 && (
                          <p className="text-[10px] text-danger-400/70 mt-0.5">
                            {injuryRisk.reasons[0]}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div 
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            score >= 80 ? 'bg-success-500/20 text-success-400' :
                            score >= 60 ? 'bg-warning-500/20 text-warning-400' :
                            'bg-surface-700 text-surface-400'
                          }`}
                        >
                          {score}%
                        </div>
                        <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                  {similarExercises.length === 0 && (
                    <div className="p-8 text-center">
                      <p className="text-surface-500">No similar exercises found</p>
                      <button
                        onClick={() => setSwapTab('browse')}
                        className="mt-2 text-primary-400 text-sm hover:underline"
                      >
                        Browse all exercises →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                // Browse all exercises with search/filter
                <>
                  {/* Injury warning in browse tab */}
                  {hasInjuries && (
                    <div className="mb-2 p-2 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                      <p className="text-xs text-warning-400">
                        ⚠️ Exercises marked with warnings may aggravate your injury
                      </p>
                    </div>
                  )}
                  {availableExercises
                    .filter(ex => {
                      // Don't show the current exercise
                      if (ex.id === exercise.id) return false;
                      // Search filter
                      if (swapSearch && !ex.name.toLowerCase().includes(swapSearch.toLowerCase())) return false;
                      // Muscle filter (normalized: tolerate camel/snake + casing)
                      if (swapMuscleFilter && !muscleMatchesGroup(exercisePrimaryMuscle(ex), swapMuscleFilter)) return false;
                      return true;
                    })
                    .sort((a, b) => {
                      // Sort by frequency (most used first)
                      const freqA = frequentExerciseIds.get(a.id) || 0;
                      const freqB = frequentExerciseIds.get(b.id) || 0;
                      if (freqA !== freqB) return freqB - freqA;
                      // Then alphabetically
                      return a.name.localeCompare(b.name);
                    })
                    .map((alt) => {
                      const altInjuryRisk = getExerciseInjuryRiskFromService({ name: alt.name, primaryMuscle: alt.primaryMuscle }, currentInjuries);
                      const usageCount = frequentExerciseIds.get(alt.id) || 0;
                      const isFrequent = usageCount >= 2;
                      
                      return (
                        <button
                          key={alt.id}
                          onClick={() => {
                            if (onExerciseSwap) {
                              onExerciseSwap(alt);
                              setShowSwapModal(false);
                            }
                          }}
                          className={`w-full p-3 text-left rounded-lg transition-colors flex items-center gap-3 ${
                            altInjuryRisk.isRisky 
                              ? 'hover:bg-danger-500/10 opacity-60' 
                              : 'hover:bg-surface-800'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`font-medium truncate ${altInjuryRisk.isRisky ? 'text-surface-400' : 'text-surface-100'}`}>
                                {alt.name}
                              </p>
                              {isFrequent && (
                                <span className="text-xs text-amber-400" title={`Used ${usageCount} times recently`}>
                                  ★
                                </span>
                              )}
                              {altInjuryRisk.isRisky && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                                  altInjuryRisk.severity === 3 
                                    ? 'bg-danger-500/20 text-danger-400' 
                                    : 'bg-warning-500/20 text-warning-400'
                                }`}>
                                  ⚠️
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-surface-500 capitalize">
                              {exercisePrimaryMuscle(alt)} • {alt.mechanic}
                            </p>
                          </div>
                          <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      );
                    })}
                  {availableExercises.filter(ex => {
                    if (ex.id === exercise.id) return false;
                    if (swapSearch && !ex.name.toLowerCase().includes(swapSearch.toLowerCase())) return false;
                    if (swapMuscleFilter && !muscleMatchesGroup(exercisePrimaryMuscle(ex), swapMuscleFilter)) return false;
                    return true;
                  }).length === 0 && (
                    <p className="p-8 text-center text-surface-500">
                      {swapSearch || swapMuscleFilter ? 'No matching exercises found' : 'No exercises available'}
                    </p>
                  )}
                </>
              )}
            </div>
            
            {/* Footer with Skip option */}
            {hasInjuries && onExerciseDelete && (
              <div className="p-3 border-t border-surface-700 bg-surface-800/50">
                <button
                  onClick={() => {
                    if (onExerciseDelete) {
                      onExerciseDelete();
                      setShowSwapModal(false);
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Skip this exercise (due to injury)
                </button>
                <p className="text-[10px] text-surface-500 text-center mt-1.5">
                  This will remove the exercise from today&apos;s workout
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plateau suggestions sheet (Phase 1.7 — opened from the header pill) */}
      {plateau && (
        <BottomSheet
          isOpen={showPlateauSheet}
          onClose={() => setShowPlateauSheet(false)}
          title="Plateau detected"
        >
          <div className="space-y-4">
            <p className="text-[13px] text-surface-400">
              No meaningful progress on {exercise.name} for{' '}
              {plateau.weeksSinceProgress >= 1
                ? `${plateau.weeksSinceProgress} week${plateau.weeksSinceProgress === 1 ? '' : 's'}`
                : 'several sessions'}
              . Here is what usually breaks it:
            </p>
            <ul className="space-y-2">
              {plateau.suggestions.map((suggestion, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-surface-300">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-warning-400 flex-shrink-0" aria-hidden="true" />
                  {suggestion}
                </li>
              ))}
            </ul>
            <div className="space-y-2 pt-1">
              {plateauRepRange && onRepRangeChange &&
                (plateauRepRange[0] !== block.targetRepRange[0] ||
                  plateauRepRange[1] !== block.targetRepRange[1]) && (
                <button
                  onClick={() => {
                    onRepRangeChange(plateauRepRange);
                    // Reseed the logger prefills right away: with no completed
                    // sets the reseed effects never fire (they anchor to a
                    // completed set), so the old low-rep prefill would stick
                    // and the tap would look like a no-op.
                    if (completedSets.length === 0) {
                      setPendingInputs(prev =>
                        prev.map((p, i) => {
                          const prevSet = previousSets[i];
                          if (!prevSet) {
                            return {
                              ...p,
                              reps: String(Math.round((plateauRepRange[0] + plateauRepRange[1]) / 2)),
                            };
                          }
                          const seeded = seedFromPreviousSet(prevSet, plateauRepRange);
                          return {
                            ...p,
                            weight: seedWeightString(seeded.weightKg, prevSet.weightKg),
                            reps: String(seeded.reps),
                          };
                        })
                      );
                    }
                    setShowPlateauSheet(false);
                  }}
                  className="w-full bg-primary-500 hover:bg-primary-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  Try {plateauRepRange[0]}–{plateauRepRange[1]} reps
                </button>
              )}
              {onExerciseSwap && (
                <button
                  onClick={() => {
                    setShowPlateauSheet(false);
                    setShowSwapModal(true);
                  }}
                  className="w-full bg-surface-800 hover:bg-surface-700 text-surface-200 rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  Swap exercise
                </button>
              )}
            </div>
          </div>
        </BottomSheet>
      )}

      {/* RPE Guide Modal */}
      {showRpeGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRpeGuide(false)}>
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-100">RPE Guide</h3>
              <button 
                onClick={() => setShowRpeGuide(false)}
                className="p-1 text-surface-400 hover:text-surface-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-surface-400 mb-4">Rate of Perceived Exertion - how hard was the set?</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-danger-400">RPE 10</span>
                <span className="text-sm text-surface-300">Max effort - 0 reps left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-warning-400">RPE 9</span>
                <span className="text-sm text-surface-300">Very hard - 1 rep left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-primary-400">RPE 8</span>
                <span className="text-sm text-surface-300">Hard - 2 reps left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-success-400">RPE 7</span>
                <span className="text-sm text-surface-300">Moderate - 3 reps left</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface-800 rounded-lg">
                <span className="font-mono font-bold text-surface-400">RPE 6</span>
                <span className="text-sm text-surface-300">Easy - 4+ reps left</span>
              </div>
            </div>
            <p className="text-xs text-surface-500 mt-4 text-center">
              Target RPE 7-8 for most working sets
            </p>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          if (onExerciseDelete) {
            onExerciseDelete();
          }
        }}
        title="Remove Exercise"
        message={`Remove "${exercise.name}" from this workout? This will delete any logged sets for this exercise.`}
        confirmText="Remove"
        cancelText="Keep"
        variant="danger"
      />
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for performance
  // Only re-render if these specific props change
  return (
    prevProps.exercise.id === nextProps.exercise.id &&
    prevProps.block.id === nextProps.block.id &&
    prevProps.block.targetSets === nextProps.block.targetSets &&
    prevProps.block.targetWeightKg === nextProps.block.targetWeightKg &&
    prevProps.block.targetRepRange[0] === nextProps.block.targetRepRange[0] &&
    prevProps.block.targetRepRange[1] === nextProps.block.targetRepRange[1] &&
    prevProps.block.targetRir === nextProps.block.targetRir &&
    prevProps.sets.length === nextProps.sets.length &&
    // Compare set content (RPE, form, weight, reps) to detect feedback updates
    prevProps.sets.every((s, i) =>
      s.id === nextProps.sets[i]?.id &&
      s.rpe === nextProps.sets[i]?.rpe &&
      s.feedback?.form === nextProps.sets[i]?.feedback?.form &&
      s.weightKg === nextProps.sets[i]?.weightKg &&
      s.reps === nextProps.sets[i]?.reps
    ) &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.unit === nextProps.unit &&
    prevProps.recommendedWeight === nextProps.recommendedWeight &&
    prevProps.warmupSets?.length === nextProps.warmupSets?.length &&
    prevProps.workingWeight === nextProps.workingWeight &&
    // Timer props - must check these so timer updates trigger re-render
    prevProps.showRestTimer === nextProps.showRestTimer &&
    prevProps.timerSeconds === nextProps.timerSeconds &&
    prevProps.timerInitialSeconds === nextProps.timerInitialSeconds &&
    prevProps.timerIsRunning === nextProps.timerIsRunning &&
    prevProps.timerIsFinished === nextProps.timerIsFinished &&
    prevProps.timerIsSkipped === nextProps.timerIsSkipped &&
    prevProps.timerRestedSeconds === nextProps.timerRestedSeconds &&
    prevProps.onShowTimerControls === nextProps.onShowTimerControls &&
    // Prescription + insight props (calibration, readiness, plateau, AMRAP)
    prevProps.adjustedRir?.prescribedRIR === nextProps.adjustedRir?.prescribedRIR &&
    prevProps.adjustedRir?.hasAdjustment === nextProps.adjustedRir?.hasAdjustment &&
    prevProps.readinessModulation?.rirDelta === nextProps.readinessModulation?.rirDelta &&
    prevProps.readinessModulation?.banner === nextProps.readinessModulation?.banner &&
    prevProps.performanceSnapshots === nextProps.performanceSnapshots &&
    prevProps.isAmrapSuggested === nextProps.isAmrapSuggested &&
    prevProps.userBodyweightKg === nextProps.userBodyweightKg &&
    // Write-status (P0-2): compare only THIS card's own sets' statuses, not the
    // whole shared map by reference. setSyncStatus is one object shared by every
    // card, so a reference check would re-render all cards whenever any set's
    // status flips; this narrow comparison re-renders a card only when one of
    // its own sets changes saved/saving/queued.
    prevProps.sets.every(
      (s) => prevProps.setSyncStatus?.[s.id] === nextProps.setSyncStatus?.[s.id]
    )
  );
});
