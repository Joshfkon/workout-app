'use client';

import React, { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { Card, Button, ConfirmModal } from '@/components/ui';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/Accordion';
import type { Exercise, ExerciseBlock, SetLog, WeightUnit, SetQuality, SetFeedback, BodyweightData, ExercisePerformanceSnapshot, StandardMuscleGroup, SorenessRating, PumpRating0to3, WorkloadRating, SetDiscomfort } from '@/types/schema';
import { rpeToRir } from '@/types/schema';
import { SorenessChipRow, ExerciseFeedbackChips, JointPainPicker } from './FeedbackChips';
import { filterExercises, dedupeExercisesById } from '@/services/exerciseFilter';
import { convertWeight, formatMuscleName, formatWeightValue, convertWeightForDisplay, inputWeightToKg, roundToPlateIncrement } from '@/lib/utils';
import { recommendSet, recommendSessionStart, estimateRepsForWeight, predictAmrapReps, recommendSeedForSlot, resolveLastRir, prescribe, type SeedRecommendation } from '@/services/setRecommender';
import { inferSetRole, type SetRole } from '@/services/suggestionEngine/setRoles';
import { RAMP_LOAD_FRACTION, WORKING_WEIGHT_CLAMP_FRACTION } from '@/services/suggestionEngine/constants';
import { findSimilarExercises, calculateSimilarityScore } from '@/services/exerciseSwapper';
import { filterExercisesByEquipment } from '@/services/equipmentFilter';
import { detectPlateau, type PlateauDetectionResult, type PlateauGoal } from '@/services/plateauDetector';
import { getExerciseProgression, type ExerciseProgressionInsight } from '@/services/progressionInsights';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { useUserStore } from '@/stores';
import type { AdjustedRIRResult } from '@/services/rpeCalibration';
import type { ReadinessModulation } from '@/services/fatigueEngine';
import { lightHaptic } from '@/lib/integrations/notifications';
import { Input } from '@/components/ui';
import { IconBone, IconCheck, IconChevronDown, IconCloudPause, IconGripVertical, IconInfoCircle } from '@tabler/icons-react';
import { RowOverflowMenu, type RowMenuItem } from './RowOverflowMenu';
import { InlineRestTimerBar } from './InlineRestTimerBar';
import { DropsetPrompt } from './DropsetPrompt';
import { BodyweightSetEditRow } from './BodyweightSetEditRow';
import { SegmentedControl } from './SegmentedControl';
import { SetLoggerRow } from './SetLoggerRow';
import { SuggestionBanner } from './SuggestionBanner';
import { BottomSheet } from './BottomSheet';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'traps', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs'];

// Read an exercise's primary muscle defensively: different call sites feed
// ExerciseCard either camelCase (primaryMuscle, mapped) or raw snake_case
// (primary_muscle) data, and DB casing can vary — normalize to lowercase so the
// swap muscle filter matches reliably.
function exercisePrimaryMuscle(ex: { primaryMuscle?: string; primary_muscle?: string }): string {
  return String(ex.primaryMuscle ?? ex.primary_muscle ?? '').toLowerCase();
}

interface ExerciseHistory {
  lastWorkoutDate: string;
  lastWorkoutSets: {
    weightKg: number;
    reps: number;
    rpe?: number;
    /** Bodyweight composition, when recorded — drives the "BW+25" display. */
    bw?: { modification: 'none' | 'weighted' | 'assisted'; addedWeightKg?: number; assistanceWeightKg?: number };
  }[];
  /** Working sets from the session BEFORE last — regression-path evidence (Fix 4). */
  priorWorkoutSets?: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
  /** Location-scoped calibration (services/progressionScope). */
  progressionScope?: 'global' | 'local';
  /** True when this history was seeded (softened) from another location. */
  estimatedFromOtherLocation?: boolean;
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
import { getFailureSafetyTier, getRIRFloor } from '@/services/exerciseSafety';
import { getBodyPartDisplayName, getJointDisplayName, jointToBodyPart } from '@/services/discomfortTracker';
import { CONNECTIVE_TISSUE_CAP_NOTE } from '@/services/setPrescription';

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

/**
 * Entered load (kg + display label) from the logger's CURRENT stepper values,
 * for the live effort check. Bodyweight modes resolve to the effective load
 * (BW ± modification) — the same basis the logged e1RMs use.
 */
function parseEnteredLoad(args: {
  weightStr: string;
  bwLoadStr: string;
  isBodyweight: boolean;
  weightMode: 'bodyweight' | 'weighted' | 'assisted';
  userBodyweightKg?: number;
  unit: WeightUnit;
  unitLabel: string;
}): { kg: number; label: string } | null {
  const { unit, unitLabel } = args;
  if (args.isBodyweight) {
    if (!args.userBodyweightKg) return null;
    const load = parseFloat(args.bwLoadStr);
    const loadKg = isNaN(load) ? 0 : inputWeightToKg(load, unit);
    if (args.weightMode === 'weighted') {
      return {
        kg: args.userBodyweightKg + loadKg,
        label: `BW +${args.bwLoadStr || '0'} ${unitLabel}`,
      };
    }
    if (args.weightMode === 'assisted') {
      return {
        kg: args.userBodyweightKg - loadKg,
        label: `BW -${args.bwLoadStr || '0'} ${unitLabel}`,
      };
    }
    return { kg: args.userBodyweightKg, label: 'BW' };
  }
  const w = parseFloat(args.weightStr);
  if (isNaN(w) || w <= 0) return null;
  return { kg: inputWeightToKg(w, unit), label: `${args.weightStr} ${unitLabel}` };
}

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
  onCreateCustomSwap?: (initialName?: string) => void;  // Open custom-exercise creation as part of a swap
  onExerciseDelete?: () => void;  // Callback to delete entire exercise from workout
  onBlockNoteUpdate?: (note: string | null) => void;  // Callback to update exercise block note
  onWarmupComplete?: (restSeconds: number) => void;  // Callback when a warmup set is completed
  availableExercises?: Exercise[];  // All exercises for swap suggestions
  unavailableEquipmentIds?: string[];  // Location equipment blocklist — swap suggestions must respect it
  frequentExerciseIds?: Map<string, number>;  // Exercise usage counts for sorting
  isActive?: boolean;
  unit?: WeightUnit;
  recommendedWeight?: number;  // AI-suggested weight in kg
  previousSets?: { weightKg: number; reps: number; rpe?: number }[];  // Previous workout's sets for this exercise
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
  // Diet phase for plateau detection: gains expected on a bulk, holding
  // strength counts as progress on a cut
  userGoal?: PlateauGoal;
  // One-tap plateau action: update the block's target rep range
  onRepRangeChange?: (range: [number, number]) => void;
  // AMRAP suggestion - indicates this is the last set and user should push to failure
  isAmrapSuggested?: boolean;  // If true, pre-fill RPE with 9.5 as a target
  // Plate calculator
  onPlateCalculatorOpen?: (initialWeightKg?: number) => void;  // Callback to open plate calculator modal
  // Per-set write status (P0-2): drives the saved/saving/queued glyph on
  // completed set lines. Sets absent from the map (loaded from DB) are saved.
  setSyncStatus?: Record<string, SetSyncStatus>;
  // Reports the active set's live suggestion (the SuggestionBanner values,
  // e.g. "60 kg × 7") so the page's sticky rest bar shows the same target
  // instead of the block's stale planned weight. Called with null when no
  // active suggestion is shown.
  onActiveSuggestionChange?: (label: string | null) => void;
  // Enhanced Athlete Mode: does NOT change any prescription here — only
  // surfaces an inline note when the joint-stress RIR floor binds (the
  // floor itself never reads this flag; see services/exerciseSafety.ts).
  enhancedAthleteMode?: boolean;
  // Deload session: the banner holds light instead of prescribing progression,
  // and the rationale copy says so ("deload — holding light").
  isDeloadSession?: boolean;
  // Start-of-session soreness prompt for this exercise's primary muscle
  // (first exercise per muscle only; parent enforces the once-per-session cap).
  // `answered` renders the collapsed ✓ line instead of the chips.
  sorenessPrompt?: {
    muscle: StandardMuscleGroup;
    displayName: string;
    answered?: SorenessRating | null;
  } | null;
  onSorenessAnswer?: (muscle: StandardMuscleGroup, rating: SorenessRating) => void;
  // Per-exercise pump/workload chips on the card's completed state. Values
  // are read from block.pump / block.workload.
  onExerciseFeedbackChange?: (feedback: { pump?: PumpRating0to3; workload?: WorkloadRating }) => void;
  // Exercise-level pain pattern notice (≥3 flags in 6 weeks): one-time,
  // dismissible, links to the swap picker's Similar tab.
  painNotice?: { joint: string; count: number } | null;
  onPainNoticeDismiss?: () => void;
  // Set-level joint pain on COMPLETED rows: parent persists the feedback and
  // records the pain event.
  onSetJointPain?: (setId: string, discomfort: SetDiscomfort) => void;
  // Cold start (no logged history for this exercise): the transfer-aware
  // estimate computed by the page. Supersedes the block's stored target (which
  // may predate transfer estimation) and names its source rung in the banner
  // ("estimated from your Lying Leg Curl strength" vs "from your training
  // profile"), so the user knows where the number came from.
  coldStartSuggestion?: ColdStartSuggestion;
  // --- Compact title-row chrome (the page's old standalone header row folded
  // into the card's own title row). All of these are page-owned wiring; the
  // card only positions them. The old position badge / set-count badge /
  // superset slot letter render in the exercise info view (and the page's
  // collapsed row) instead of this title row. ---
  // This block's index in the page's block array, passed back to the drag and
  // menu callbacks below.
  listIndex?: number;
  // True while the page shows this block as a collapsed list row and hides the
  // card with CSS (kept mounted so in-progress set inputs survive collapse).
  // Gates the controls that would otherwise duplicate the collapsed row's
  // (row-menu-trigger testid).
  isCollapsed?: boolean;
  // Drag-activation handlers for the title-row grip. Must be identity-stable
  // (latest-ref wrappers in the page): the memo comparator ignores them.
  onDragHandleStart?: (index: number, clientY: number) => void;
  onDragHandleEnd?: () => void;
  onDragHandleCancel?: () => void;
  // Builds the row overflow (⋮) menu items. Identity-stable, called at render.
  getMenuItems?: (index: number) => RowMenuItem[];
  // Collapse chevron handler (page collapse UI state). Identity-stable.
  onToggleCollapse?: (blockId: string) => void;
}

/** Cold-start estimate + provenance for a no-history exercise. */
export interface ColdStartSuggestion {
  weightKg: number;
  /** Short banner reason naming the estimation source. */
  reason: string;
  /** Full rationale sentence for the info sheet. */
  explanation: string;
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
  onCreateCustomSwap,
  onExerciseDelete,
  onBlockNoteUpdate,
  onWarmupComplete,
  availableExercises = [],
  unavailableEquipmentIds = [],
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
  userGoal,
  onRepRangeChange,
  isAmrapSuggested = false,
  onPlateCalculatorOpen,
  onActiveSuggestionChange,
  enhancedAthleteMode = false,
  isDeloadSession = false,
  coldStartSuggestion,
  sorenessPrompt = null,
  onSorenessAnswer,
  onExerciseFeedbackChange,
  painNotice = null,
  onPainNoticeDismiss,
  onSetJointPain,
  listIndex,
  isCollapsed = false,
  onDragHandleStart,
  onDragHandleEnd,
  onDragHandleCancel,
  getMenuItems,
  onToggleCollapse,
}: ExerciseCardProps) {
  // Prescribed RIR: calibration-adjusted target when available, eased further
  // by the session's readiness modulation (Phase 1.3/1.5 fold-in).
  const baseTargetRir = adjustedRir?.hasAdjustment ? adjustedRir.prescribedRIR : block.targetRir;
  const effectiveTargetRir = Math.max(
    0,
    Math.min(4, baseTargetRir + (readinessModulation?.rirDelta ?? 0))
  );

  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [jointPickerSetId, setJointPickerSetId] = useState<string | null>(null);
  const [completedWarmups, setCompletedWarmups] = useState<Set<number>>(new Set());
  const [editingWarmupId, setEditingWarmupId] = useState<number | null>(null);
  const [customWarmupWeights, setCustomWarmupWeights] = useState<Map<number, number>>(new Map());
  const [warmupWeightInput, setWarmupWeightInput] = useState('');
  const [isWarmupExpanded, setIsWarmupExpanded] = useState(false);
  const [showRpeGuide, setShowRpeGuide] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const { inset: swapKeyboardInset, scrollContainerRef: swapSheetRef } =
    useKeyboardInset<HTMLDivElement>(showSwapModal);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [swapTab, setSwapTab] = useState<'similar' | 'browse'>('similar');
  const [swapSearch, setSwapSearch] = useState('');
  const [isCompletingSet, setIsCompletingSet] = useState(false); // Prevent double-clicks
  const [dropsetMode, setDropsetMode] = useState<{ parentSetId: string; parentWeight: number } | null>(null);
  // Plateau suggestions bottom sheet (opened from the header pill)
  const [showPlateauSheet, setShowPlateauSheet] = useState(false);
  // Expanded last-session history detail (behind the header meta line)
  const [showHistory, setShowHistory] = useState(false);

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

  // Shared, de-duped candidate pool for BOTH swap tabs. The page feeds
  // availableExercises as blocks.map(b => b.exercise).concat(fullLibrary), so an
  // exercise both in the workout and the library appears twice — de-dupe by id
  // once here so neither the Similar nor the Browse list can render a row (or a
  // React key) twice.
  const swapCandidates = useMemo(
    () => dedupeExercisesById(availableExercises).filter(ex => ex.id !== exercise.id),
    [availableExercises, exercise.id]
  );

  // Calculate similar exercises for swap suggestions, filtering out injury-risky
  // ones and exercises the current location has no equipment for
  const similarExercises = useMemo(() => {
    if (swapCandidates.length === 0) return [];

    const equipmentFeasible = filterExercisesByEquipment(
      swapCandidates.map(ex => ({ ...ex, equipment: ex.equipmentRequired })),
      unavailableEquipmentIds
    );

    const similar = findSimilarExercises(exercise, equipmentFeasible)
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
  }, [exercise, swapCandidates, unavailableEquipmentIds, currentInjuries]);
  
  // Count safe alternatives
  const safeAlternatives = similarExercises.filter(s => !s.injuryRisk.isRisky);
  const hasInjuries = currentInjuries.length > 0;

  // Browse-tab results: the shared filter (query composes with the muscle chip;
  // query matches name/muscles/equipment case-insensitively), then frequency /
  // A-Z sort. Fed from the de-duped pool so rows and keys stay unique. An empty
  // result renders a proper empty state — never the unfiltered list.
  const swapBrowseResults = filterExercises(swapCandidates, {
    query: swapSearch,
    muscleGroup: swapMuscleFilter || null,
  }).sort((a, b) => {
    const freqA = frequentExerciseIds.get(a.id) || 0;
    const freqB = frequentExerciseIds.get(b.id) || 0;
    if (freqA !== freqB) return freqB - freqA;
    return a.name.localeCompare(b.name);
  });

  // State for pending set inputs (one per pending set)
  const [pendingInputs, setPendingInputs] = useState<{
    weight: string;
    reps: string;
    rpe: string;
  }[]>([]);

  const completedSets = sets.filter((s) => !s.isWarmup && s.setType !== 'warmup');
  const pendingSetsCount = Math.max(0, block.targetSets - completedSets.length);

  // Within-session next-set recommendation (services/setRecommender.ts).
  // Anchor on the freshest/strongest E1RM this exercise so late-set predictions
  // aren't double-fatigued.
  const sessionBestE1RM = useMemo(() => {
    // Duration sets carry seconds in `reps` — Epley on them fabricates an e1RM.
    if (exercise.exerciseType === 'duration_based') return undefined;
    let best = 0;
    for (const s of completedSets) {
      if (s.weightKg > 0 && s.reps > 0) {
        const rir = resolveLastRir(s, effectiveTargetRir);
        const e = s.weightKg * (1 + (s.reps + rir) / 30);
        if (e > best) best = e;
      }
    }
    return best > 0 ? best : undefined;
  }, [completedSets, effectiveTargetRir, exercise.exerciseType]);

  // Prescription e1RM ladder (unified prescribe() contract, services/setRecommender):
  //   1. session-best — a set logged THIS session (sessionBestE1RM above);
  //   2. last-session resolved — best Epley e1RM from the previous session's
  //      sets at their logged effort;
  //   3. cold-start estimate — the e1RM implied by the transfer/profile
  //      ladder's suggested weight at the mid of the rep range.
  // The stored all-time estimatedE1RM is for display and the session-start
  // WEIGHT pick only: it can disagree with the on-screen suggestion (older
  // era, other implement, different formula), so it never answers a weight
  // edit — that inconsistency is what saturated the rep estimate into the
  // constant "× 20". With no rung available, weight edits leave reps untouched.
  const lastSessionE1RM = useMemo(() => {
    if (exercise.exerciseType === 'duration_based') return undefined;
    let best = 0;
    for (const s of previousSets) {
      if (s.weightKg > 0 && s.reps > 0) {
        const rir = s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : effectiveTargetRir;
        const e = s.weightKg * (1 + (s.reps + rir) / 30);
        if (e > best) best = e;
      }
    }
    return best > 0 ? best : undefined;
  }, [previousSets, effectiveTargetRir, exercise.exerciseType]);

  const coldStartE1RM = useMemo(() => {
    if (exercise.exerciseType === 'duration_based') return undefined;
    if (!coldStartSuggestion || !(coldStartSuggestion.weightKg > 0)) return undefined;
    const mid = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
    return coldStartSuggestion.weightKg * (1 + (mid + effectiveTargetRir) / 30);
  }, [coldStartSuggestion, block.targetRepRange, effectiveTargetRir, exercise.exerciseType]);

  // Grade the next set against the effort ACTUALLY logged on `last` — read from
  // the persisted set record (feedback.repsInTank first, then rpe), never the
  // prescribed/target RIR. `resolveLastRir` is the single read-path source.
  // Cold start = first-ever session of this exercise (no logged history). The
  // starting weight was an estimate, so within-session adaptation is aggressive:
  // an easy-rated set bumps the load even mid-range (services/setRecommender).
  const isColdStartExercise = (exerciseHistory?.totalSessions ?? 0) === 0;

  const recommendNext = (last: { weightKg: number; reps: number; rpe?: number; feedback?: SetFeedback }) =>
    recommendSet({
      lastWeightKg: last.weightKg,
      lastReps: last.reps,
      lastRir: resolveLastRir(last, effectiveTargetRir),
      setsCompletedThisExercise: completedSets.length,
      sessionBestE1RMKg: sessionBestE1RM,
      targetRepRange: block.targetRepRange,
      targetRir: effectiveTargetRir,
      minIncrementKg: exercise.minWeightIncrementKg,
      coldStart: isColdStartExercise,
      exerciseType: exercise.exerciseType,
      isBodyweight: exercise.isBodyweight,
    });

  // RPE→RIR adapter for the recommender's AMRAP prediction.
  const amrapReps = (last: { reps: number; rpe?: number }) =>
    predictAmrapReps(
      { reps: last.reps, rir: last.rpe != null ? Math.max(0, 10 - last.rpe) : undefined },
      block.targetRepRange
    );

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

  // Warmup fallback weight: with no calibrated working weight for this
  // exercise (cold start in the "find working weight" state), fall back to
  // the weight typed into the active set input so the warmup protocol can
  // still render as percentages of the load the user is about to attempt.
  const typedFirstSetWeightKg = useMemo(() => {
    if (isBodyweightExercise) return 0;
    const typed = parseFloat(pendingInputs[0]?.weight ?? '');
    return Number.isFinite(typed) && typed > 0 ? inputWeightToKg(typed, unit) : 0;
  }, [isBodyweightExercise, pendingInputs, unit]);

  const warmupWorkingWeightKg = workingWeight > 0 ? workingWeight : typedFirstSetWeightKg;

  // A protocol the page generated with workingWeight 0 collapsed to the
  // single <20 kg "light activation" set — rebuild it from the typed weight
  // so the set count and percentages match the actual load. A non-empty
  // warmupSets prop is the page's eligibility signal (first exercise for a
  // not-yet-warm muscle), so an empty prop stays empty here.
  const effectiveWarmupSets = useMemo(() => {
    if (workingWeight > 0 || typedFirstSetWeightKg <= 0 || warmupSets.length === 0) {
      return warmupSets;
    }
    return generateWarmupProtocol({
      workingWeight: typedFirstSetWeightKg,
      exercise,
      isFirstExercise: listIndex === 0,
    });
  }, [warmupSets, workingWeight, typedFirstSetWeightKg, exercise, listIndex]);

  // Auto-collapse warmup sets when all are completed
  useEffect(() => {
    if (effectiveWarmupSets.length > 0 && completedWarmups.size === effectiveWarmupSets.length) {
      setIsWarmupExpanded(false);
    }
  }, [completedWarmups.size, effectiveWarmupSets.length]);

  // Weight mode state for bodyweight exercises (header-level selection)
  const [weightMode, setWeightMode] = useState<'bodyweight' | 'weighted' | 'assisted'>(
    isPureBodyweight ? 'bodyweight' : 'bodyweight'
  );

  // Added/assistance load input (display units) for weighted/assisted bodyweight
  // modes. Kept separate from pendingInputs because those seed EFFECTIVE loads.
  const [bwLoadInput, setBwLoadInput] = useState('');

  // Plateau detection for this exercise (services/plateauDetector, Phase 1.7).
  // History snapshots are threaded from the page's already-loaded exercise history.
  // referenceDate keeps stale history (an exercise resumed after months off)
  // from triggering the badge off old, no-longer-representative sessions.
  const plateau: PlateauDetectionResult | null = useMemo(() => {
    if (!performanceSnapshots || performanceSnapshots.length === 0) return null;
    const result = detectPlateau({
      exerciseId: exercise.id,
      snapshots: performanceSnapshots,
      referenceDate: new Date(),
      goal: userGoal,
    });
    return result.isPlateaued ? result : null;
  }, [performanceSnapshots, exercise.id, userGoal]);

  // Progression pace vs what's expected for the user's experience level
  // (services/progressionInsights). Complements the plateau badge: the pace
  // pill covers the non-plateaued states (ahead / on track / behind).
  const experience = useUserStore((s) => s.user?.experience ?? 'intermediate');
  const progressionInsight: ExerciseProgressionInsight | null = useMemo(() => {
    if (!performanceSnapshots || performanceSnapshots.length === 0) return null;
    return getExerciseProgression({
      exerciseId: exercise.id,
      snapshots: performanceSnapshots,
      experience,
      referenceDate: new Date(),
      goal: userGoal,
    });
  }, [performanceSnapshots, exercise.id, experience, userGoal]);

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

  // Determine suggested weight. On a cold start, the page's transfer-aware
  // estimate supersedes the block's stored target — the stored number may be a
  // stale profile-only guess from when the workout was built.
  const suggestedWeight = isColdStartExercise && coldStartSuggestion && coldStartSuggestion.weightKg > 0
    ? coldStartSuggestion.weightKg
    : block.targetWeightKg > 0
      ? block.targetWeightKg
      : (recommendedWeight && recommendedWeight > 0 ? recommendedWeight : 0);

  // Format weight for display - use exact conversion for completed sets, rounded for suggestions
  // For completed sets, preserve exact user input; for suggestions, round to plate increments
  const displayWeight = useCallback((kg: number, preserveExact: boolean = false) => {
    return preserveExact ? convertWeightForDisplay(kg, unit) : formatWeightValue(kg, unit);
  }, [unit]);
  const weightLabel = unit === 'lb' ? 'lbs' : 'kg';

  // Weight label for a history set: bodyweight sets break out the composition
  // ("BW", "BW+25", "BW−30" in display units) instead of the blended effective
  // load, which reads as a mystery number ("222") on the card. Sets without a
  // recorded breakdown (legacy rows, or migration rows flagged _needsReview)
  // keep the effective-load display. The effective load remains the engine's
  // number everywhere — this is display only.
  const historySetWeightLabel = useCallback(
    (set: { weightKg: number; bw?: { modification: string; addedWeightKg?: number; assistanceWeightKg?: number } }): string => {
      const bw = set.bw;
      if (!bw) return String(displayWeight(set.weightKg, true));
      if (bw.modification === 'weighted' && (bw.addedWeightKg ?? 0) > 0) {
        return `BW+${displayWeight(bw.addedWeightKg!, true)}`;
      }
      if (bw.modification === 'assisted' && (bw.assistanceWeightKg ?? 0) > 0) {
        return `BW−${displayWeight(bw.assistanceWeightKg!, true)}`;
      }
      return 'BW';
    },
    [displayWeight]
  );

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

  // The previous session's FULL set list (performed order) for the all-sets
  // bump gate: a session-to-session load increase is earned only when every
  // working set cleared the top of the range, not by one strong set
  // (services/setRecommender.earnedSessionBump; ramp/back-off sets excluded
  // by role inference).
  const prevSessionSetsForGating = useMemo(
    () =>
      previousSets
        .filter((s) => s.weightKg > 0 && s.reps > 0)
        .map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          rir: s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : undefined,
        })),
    [previousSets]
  );

  // The session BEFORE last, for the regression path (Fix 4): a load
  // decrement requires TWO consecutive below-floor sessions; one bad session
  // holds. Undefined when the history shape doesn't carry it (legacy) —
  // the recommender then keeps its legacy reduce behavior.
  const priorSessionSetsForGating = useMemo(
    () =>
      exerciseHistory?.priorWorkoutSets
        ? exerciseHistory.priorWorkoutSets
            .filter((s) => s.weightKg > 0 && s.reps > 0)
            .map((s) => ({
              weightKg: s.weightKg,
              reps: s.reps,
              rir: s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : undefined,
            }))
        : undefined,
    [exerciseHistory?.priorWorkoutSets]
  );

  // Weight+reps seed for a not-yet-started exercise, anchored to the previous
  // session's set INCLUDING its effort (services/setRecommender). Holds the
  // weight when that set landed in range at roughly the target effort; steps
  // it on a clear miss — e.g. 20 reps left at 4 RIR against a 10-15 @ 2 RIR
  // target, or a rep range moved by the one-tap plateau switch — so a
  // mis-loaded session doesn't get replayed verbatim.
  //
  // NOTE: the session-list gates (prevSessionSets / priorSessionSets) are
  // deliberately NOT passed here. This seed's only call site is the one-tap
  // plateau REP-RANGE SWITCH — the previous sessions were performed under the
  // OLD range, so grading them against the new range's floor/top would
  // misread the switch as an unearned bump or a confirmed regression and
  // block the proper curve-based repricing.
  const seedFromPreviousSet = useCallback(
    (prevSet: { weightKg: number; reps: number; rpe?: number }, range: [number, number]) =>
      recommendSessionStart({
        prevWeightKg: prevSet.weightKg,
        prevReps: prevSet.reps,
        prevRir: prevSet.rpe != null ? rpeToRir(prevSet.rpe) : undefined,
        targetRepRange: range,
        targetRir: effectiveTargetRir,
        minIncrementKg: exercise.minWeightIncrementKg,
      }),
    [effectiveTargetRir, exercise.minWeightIncrementKg]
  );

  // Best recent WORKING weight last session (the top set). Doubles as the role-
  // inference reference AND the ±clamp anchor for the e1RM working prescription.
  const previousTopSetWeightKg = useMemo(
    () => previousSets.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0),
    [previousSets]
  );

  // The exercise's e1RM capacity anchor (kg) — the stored/best est. 1RM. This is
  // the number that was displayed-but-ignored before the roles fix.
  const anchorE1RMKg = exerciseHistory?.estimatedE1RM ?? 0;

  // Role-aware session-start seed for one slot (services/setRecommender).
  // The slot's role is inferred from the PREVIOUS session's set in that slot — a
  // feeder stays a feeder — so working-set progression never grades a ramp set.
  // Working slots anchor on the e1RM (clamped ±10% of recent working weight) and
  // carry a rep RANGE; ramp slots take a fixed % of the top working set with no
  // RIR claim.
  const buildSlotSeed = useCallback(
    (setIndex: number): { seed: SeedRecommendation; prevSet?: { weightKg: number; reps: number; rpe?: number } } => {
      const prevSet = previousSets[setIndex];
      const role: SetRole =
        prevSet && prevSet.weightKg > 0
          ? inferSetRole(prevSet.weightKg, previousTopSetWeightKg)
          : 'working';
      const seed = recommendSeedForSlot({
        role,
        targetRepRange: block.targetRepRange,
        targetRir: effectiveTargetRir,
        minIncrementKg: exercise.minWeightIncrementKg,
        anchorE1RMKg,
        recentWorkingWeightKg: previousTopSetWeightKg || undefined,
        prevWeightKg: prevSet?.weightKg,
        prevReps: prevSet?.reps,
        prevRir: prevSet?.rpe != null ? rpeToRir(prevSet.rpe) : undefined,
        prevSessionSets: prevSessionSetsForGating,
        priorSessionSets: priorSessionSetsForGating,
        exerciseType: exercise.exerciseType,
        isBodyweight: exercise.isBodyweight,
      });
      return { seed, prevSet };
    },
    [previousSets, previousTopSetWeightKg, anchorE1RMKg, block.targetRepRange, effectiveTargetRir, exercise.minWeightIncrementKg, exercise.exerciseType, exercise.isBodyweight, prevSessionSetsForGating, priorSessionSetsForGating]
  );

  // Curve-consistent reps for a session-start seed: answer the seeded weight
  // on the SAME e1RM ladder the weight-edit recompute uses, so the prefilled
  // (weight, reps) pair sits on one curve and round-trips through prescribe().
  // Ramp slots keep the mid-range plan (no effort target → no curve claim);
  // with no e1RM rung the mid of the range is the plan target, not a curve
  // answer, and later weight edits leave it alone.
  const seedRepsForWeight = useCallback(
    (weightKg: number, seed: SeedRecommendation): number => {
      // Duration exercises: the time-then-load policy already seeded the
      // seconds target — never replace it with a range midpoint.
      if (seed.seedReps !== undefined) return seed.seedReps;
      const midPlan = Math.round((seed.repRange[0] + seed.repRange[1]) / 2);
      if (seed.role === 'ramp' || !(weightKg > 0)) return midPlan;
      const e1rm = lastSessionE1RM ?? coldStartE1RM;
      if (!e1rm) return midPlan;
      const p = prescribe({
        e1RMKg: e1rm,
        targetRir: effectiveTargetRir,
        repRange: seed.repRange,
        weightKg,
      });
      return p ? p.reps : midPlan;
    },
    [lastSessionE1RM, coldStartE1RM, effectiveTargetRir]
  );

  // Capacity anchor for a weight-edit recompute — the prescription e1RM
  // ladder: session-best first (a set logged this session); with no reference
  // set at all, last-session resolved e1RM, then the cold-start estimate.
  // NEVER the stored all-time e1RM: it can sit far off the curve the on-screen
  // suggestion came from, and answering an edit from it is what saturated the
  // reps into the constant "× 20". A planned target weight is not an anchor
  // either — with no e1RM rung, weight edits must leave the reps field
  // untouched.
  const resolveEditAnchorE1RM = useCallback(
    (hasReferenceSet: boolean): number | undefined =>
      sessionBestE1RM ?? (hasReferenceSet ? undefined : lastSessionE1RM ?? coldStartE1RM),
    [sessionBestE1RM, lastSessionE1RM, coldStartE1RM]
  );

  // Rationale line for a weight-edit rep recompute ("35 lbs ⇒ ~6 reps @ 2 RIR
  // (from your 44.5 lbs e1RM)") — the user should see the curve working.
  const [weightEditNote, setWeightEditNote] = useState<{
    weightDisplay: string;
    reps: number;
    rir: number;
    e1rmKg: number;
  } | null>(null);

  // Track the last known completed sets count to detect changes
  const prevCompletedCountRef = useRef(completedSets.length);

  // Track whether AMRAP prefill has already occurred to avoid overwriting user edits
  const amrapPrefillDoneRef = useRef(false);

  // Track pending reps auto-calculation timeouts per set index
  // This allows canceling the debounced calculation if user manually edits reps
  const repsCalcTimeoutsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  // Dirty-field tracking per pending set index (field-edit rules): once the
  // user manually types/steps a field, it is user-owned — no automatic
  // recompute (weight-edit rep estimate, feedback-driven recalc) may overwrite
  // it. Cleared when a set is logged so the next set starts fresh.
  const manualEditsRef = useRef<Map<number, { weight?: boolean; reps?: boolean }>>(new Map());

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
    const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
    const rec = recommendNext(lastSetData);
    const smartWeight = rec.weightKg;
    const smartReps = rec.reps;

    // Update all pending inputs. Functional update so fields the user manually
    // edited (dirty-field rules) survive the recalc instead of being clobbered.
    setPendingInputs(prev => {
      const updatedInputs: { weight: string; reps: string; rpe: string }[] = [];
      for (let i = 0; i < pendingSetsCount; i++) {
        const isLastSet = i === pendingSetsCount - 1;
        // If this is the last set and AMRAP is suggested, use 9.5 for RPE
        const setRpe = (isLastSet && isAmrapSuggested) ? 9.5 : targetRpe;

        // For AMRAP sets, use bounded prediction instead of uncapped formula
        let setReps = smartReps;
        if (isLastSet && isAmrapSuggested && lastCompleted?.rpe) {
          setReps = Math.max(amrapReps(lastSetData), smartReps);
        }

        const dirty = manualEditsRef.current.get(i);
        const existing = prev[i];
        updatedInputs.push({
          weight:
            dirty?.weight && existing
              ? existing.weight
              : seedWeightString(smartWeight, lastCompleted.weightKg),
          reps: dirty?.reps && existing ? existing.reps : String(setReps),
          rpe: String(setRpe),
        });
      }
      return updatedInputs;
    });
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
      // Logging resets the field-edit state for the next set: dirty flags are
      // per-set, and any in-flight weight-edit recalc refers to the old set.
      manualEditsRef.current.clear();
      repsCalcTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      repsCalcTimeoutsRef.current.clear();
      setWeightEditNote(null);

      const targetRpe = 10 - effectiveTargetRir;
      const lastCompleted = completedSets[completedSets.length - 1];
      
      // Calculate smart defaults using the shared suggestion engine
      let smartWeight: number;
      let smartReps: number;

      if (lastCompleted) {
        const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
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
          const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
          setReps = Math.max(amrapReps(lastSetData), smartReps);
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
          const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
          const rec = recommendNext(lastSetData);
          defaultWeight = rec.weightKg;
          defaultReps = rec.reps;
        } else if (prevSet) {
          // Role-aware seed so the logger prefill matches the banner exactly
          // (working slots anchor on the e1RM; ramp slots take a % of top).
          const { seed } = buildSlotSeed(setIndex);
          defaultWeight = seed.weightKg > 0 ? seed.weightKg : suggestedWeight;
          defaultReps = seedRepsForWeight(defaultWeight, seed);
        } else {
          defaultWeight = suggestedWeight;
          defaultReps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
        }

        // If this is the last set and AMRAP is suggested, pre-fill RPE with 9.5
        if (isLastSet && isAmrapSuggested) {
          defaultRpe = 9.5;
          // For AMRAP sets, use bounded prediction
          if (lastCompleted?.rpe) {
            const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
            defaultReps = Math.max(amrapReps(lastSetData), defaultReps);
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
        const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
        predictedReps = amrapReps(lastSetData);
      }

      // Only prefill reps if we have a prediction (don't check current value -
      // this is initial prefill) AND the user hasn't already typed their own.
      const needsRepsUpdate = predictedReps !== null && !manualEditsRef.current.get(lastIndex)?.reps;

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

  const updatePendingInput = (index: number, field: 'weight' | 'reps' | 'rpe', value: string) => {
    // Mark the field user-owned before anything else (dirty-field rules).
    if (field === 'weight' || field === 'reps') {
      const dirty = manualEditsRef.current.get(index) ?? {};
      dirty[field] = true;
      manualEditsRef.current.set(index, dirty);
    }

    // A weight keystroke invalidates any recompute note; the debounced
    // estimate re-issues it if (and only if) the reps actually recompute.
    if (field === 'weight' && index === 0) {
      setWeightEditNote(null);
    }

    // If user manually edits reps, cancel any pending debounced reps calculation
    // This prevents overwriting the user's manual input
    if (field === 'reps') {
      const existingTimeout = repsCalcTimeoutsRef.current.get(index);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        repsCalcTimeoutsRef.current.delete(index);
      }
      // The reps field is user-owned now — the recompute note no longer
      // describes what's in the field.
      if (index === 0) setWeightEditNote(null);
    }

    setPendingInputs(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [field]: value };

        // If weight changed, schedule debounced auto-adjust of reps — but only
        // while the reps field still holds the suggested value. Once the user
        // has manually edited reps for this set, weight edits never touch it.
        if (field === 'weight' && value && !manualEditsRef.current.get(index)?.reps) {
          const newWeightDisplay = parseFloat(value);
          if (!isNaN(newWeightDisplay) && newWeightDisplay > 0) {
            const newWeightKg = inputWeightToKg(newWeightDisplay, unit);

            // Get reference data
            const lastCompleted = completedSets[completedSets.length - 1];
            const prevSet = previousSets[completedSets.length + index];

            let refWeight = 0;
            let refReps = 0;
            // Assume on-target effort when the reference has no RPE
            let refRir = effectiveTargetRir;

            if (lastCompleted) {
              refWeight = lastCompleted.weightKg;
              refReps = lastCompleted.reps;
              // Same persisted-RIR read as the banner (resolveLastRir), so the
              // weight-edit rep estimate can't disagree with the suggestion.
              refRir = resolveLastRir(lastCompleted, effectiveTargetRir);
            } else if (prevSet) {
              refWeight = prevSet.weightKg;
              refReps = prevSet.reps;
              refRir = resolveLastRir(prevSet, effectiveTargetRir);
            }

            const anchorE1RM = resolveEditAnchorE1RM(refWeight > 0 && refReps > 0);
            const hasE1RM = anchorE1RM !== undefined || (refWeight > 0 && refReps > 0);

            // An AMRAP row predicts reps to failure (RIR 0) — matching its
            // prescribed 9.5 RPE — not reps at the working-set RIR target.
            const rowTargetRir =
              isAmrapSuggested && index === pendingSetsCount - 1 ? 0 : effectiveTargetRir;

            const weightChanged =
              refWeight > 0 ? Math.abs(newWeightKg - refWeight) > 0.5 : true;

            if (hasE1RM && weightChanged) {
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
                // Re-check at fire time: a manual reps edit in the meantime
                // makes the field user-owned.
                if (manualEditsRef.current.get(index)?.reps) return;
                setPendingInputs(prevInputs => {
                  const newInputs = [...prevInputs];
                  // Only update reps if user hasn't manually changed it since we scheduled
                  if (newInputs[index] && newInputs[index].reps === currentReps) {
                    // Same inputs as the banner's recommendSet call, so the
                    // estimate agrees with the suggestion at the same weight.
                    const newReps = estimateRepsForWeight(newWeightKg, {
                      lastWeightKg: refWeight,
                      lastReps: refReps,
                      lastRir: refRir,
                      setsCompletedThisExercise: completedSets.length,
                      sessionBestE1RMKg: anchorE1RM,
                      targetRepRange: block.targetRepRange,
                      targetRir: rowTargetRir,
                    });
                    // null = no e1RM after all — leave the reps field untouched.
                    if (newReps != null) {
                      newInputs[index] = { ...newInputs[index], reps: String(newReps) };
                      // Show the curve working: which e1RM answered this edit.
                      const referenceE1RM =
                        refWeight > 0 && refReps > 0
                          ? refWeight * (1 + (refReps + Math.max(0, refRir)) / 30)
                          : 0;
                      const usedE1RM = Math.max(anchorE1RM ?? 0, referenceE1RM);
                      if (index === 0 && usedE1RM > 0) {
                        setWeightEditNote({
                          weightDisplay: value,
                          reps: newReps,
                          rir: rowTargetRir,
                          e1rmKg: usedE1RM,
                        });
                      }
                    }
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
  ): {
    weight: string;
    reps: string;
    repsLabel: string;
    reason: string;
    explanation: string[];
    showRir: boolean;
    role: SetRole;
  } => {
    const lastCompleted = completedSets[completedSets.length - 1];
    const explanation: string[] = [];
    let reason: string;
    let weight = '';
    let reps = Math.round((block.targetRepRange[0] + block.targetRepRange[1]) / 2);
    // The banner prescribes a rep RANGE, never a copied/predicted single count
    // presented as if it were the target (Phase 5 honesty).
    const rangeLabel = `${block.targetRepRange[0]}–${block.targetRepRange[1]}`;
    let repsLabel = rangeLabel;
    let showRir = true;
    let role: SetRole = 'working';

    // Delta between the anchor set and the weight the banner actually shows
    // (display units, after plate rounding) so the copy can't contradict the
    // numbers on screen — a raw-kg delta said "down -1.5 kg" for a 4 kg → 3 kg
    // drop. Unsigned: "up"/"down" in the sentence already carries direction.
    const deltaLabel = (anchorKg: number, shownWeight: string) => {
      const shown = parseFloat(shownWeight);
      if (!Number.isFinite(shown)) return '';
      const delta = Number(Math.abs(shown - convertWeightForDisplay(anchorKg, unit)).toFixed(1));
      return delta > 0 ? `${delta} ${weightLabel}` : '';
    };

    if (lastCompleted) {
      // Within-session: anchor to the just-completed set. This path already re-
      // anchors on whatever the user actually logged, so a logged override (Phase 4)
      // is reflected here with no stale "vs suggestion" commentary.
      const lastSetData = { weightKg: lastCompleted.weightKg, reps: lastCompleted.reps, rpe: lastCompleted.rpe, feedback: lastCompleted.feedback };
      const rec = recommendNext(lastSetData);
      weight = seedWeightString(rec.weightKg, lastCompleted.weightKg);
      reps = rec.reps;
      if (isAmrap && lastCompleted.rpe) {
        reps = Math.max(amrapReps(lastSetData), reps);
      }
      // A within-session prediction of the likely reps is a genuine forecast of
      // the fatigue-driven decline (12→11→10→9), not a copied historical target —
      // show it as the single predicted number.
      repsLabel = String(reps);
      const deltaText = deltaLabel(lastCompleted.weightKg, weight);
      if (rec.rationale === 'increase_load') {
        reason = `up ${deltaText || 'slightly'} — last set was clearly too light`;
      } else if (rec.rationale === 'reduce_load') {
        reason = `down ${deltaText || 'slightly'} — last set was harder than the target effort`;
      } else if (rec.effortVsTarget === 'easier') {
        // Held the weight, but the logged effort was BELOW target (more reps in
        // reserve than asked) — say so and aim a little higher, never "matched".
        reason = 'holding the weight — last set was easier than target, so aim for a rep or two more';
      } else if (rec.effortVsTarget === 'harder') {
        reason = 'holding the weight — last set ran a bit harder than target';
      } else {
        reason = 'holding the weight — your last set matched the target effort';
      }
      explanation.push(
        `Anchored to your last set: ${displayWeight(lastCompleted.weightKg, true)} ${weightLabel} × ${lastCompleted.reps} at RPE ${lastCompleted.rpe}. Its estimated 1RM sets the capacity this prescription works back from.`
      );
    } else {
      // Session start: role-aware seed for this slot (services/setRecommender).
      // Working slots anchor on the e1RM (clamped ±10% of recent working weight);
      // ramp/feeder slots take a % of the top working set with no RIR claim.
      const { seed, prevSet } = buildSlotSeed(completedSets.length);
      role = seed.role;
      showRir = seed.showRirTarget;
      reps = Math.round((seed.repRange[0] + seed.repRange[1]) / 2);
      repsLabel = `${seed.repRange[0]}–${seed.repRange[1]}`;

      if (seed.weightKg > 0) {
        weight = seedWeightString(seed.weightKg, prevSet?.weightKg);
      } else if (suggestedWeight > 0) {
        weight = seedWeightString(suggestedWeight);
      }

      if (seed.role === 'ramp') {
        const pct = Math.round(RAMP_LOAD_FRACTION * 100);
        reason = 'ramp set — light feeder for your working sets';
        explanation.push(
          `This is a ramp/feeder set (~${pct}% of today's top working set), so there's no RIR target and it isn't counted as junk volume.`
        );
        if (anchorE1RMKg > 0) {
          explanation.push(
            `Top working set today is prescribed from your best estimated 1RM (${displayWeight(anchorE1RMKg)} ${weightLabel}).`
          );
        }
      } else if (seed.anchorSource === 'e1rm') {
        reason = seed.clamped
          ? `working weight from your ~${displayWeight(anchorE1RMKg)} ${weightLabel} est. 1RM (held near recent working weight)`
          : `working weight from your ~${displayWeight(anchorE1RMKg)} ${weightLabel} est. 1RM`;
        explanation.push(
          `Prescribed from your best estimated 1RM (${displayWeight(anchorE1RMKg)} ${weightLabel}) for ${seed.repRange[0]}–${seed.repRange[1]} reps at ${effectiveTargetRir} RIR.`
        );
        if (seed.clamped) {
          explanation.push(
            `Capped to within ±${Math.round(WORKING_WEIGHT_CLAMP_FRACTION * 100)}% of your recent ${displayWeight(previousTopSetWeightKg)} ${weightLabel} working weight — a hot 1RM estimate can't prescribe a big jump in one session.`
          );
        }
      } else if (seed.anchorSource === 'last_session' && prevSet) {
        const prevRir = prevSet.rpe != null ? rpeToRir(prevSet.rpe) : null;
        reason = 'starting from last session';
        explanation.push(
          `No estimated 1RM on record yet, so the load is anchored to last session: ${displayWeight(prevSet.weightKg, true)} ${weightLabel} × ${prevSet.reps}${prevRir != null ? ` at ${prevRir} RIR` : ''}.`
        );
      } else if (weight && coldStartSuggestion) {
        // Name the estimation rung that produced the number (transfer from a
        // logged related exercise vs profile heuristic) — the user should know
        // which source fired.
        reason = coldStartSuggestion.reason;
        explanation.push(coldStartSuggestion.explanation);
      } else if (weight) {
        reason = 'starting point estimated from your training profile';
        explanation.push('No history for this exercise yet — the starting weight is estimated from your profile and calibrated lifts.');
      } else if (isDurationBased) {
        // Loud-skip surface (durationPolicy): the engine deliberately does not
        // fabricate a load for a timed exercise with no history — say so here
        // instead of leaving only a console warning.
        reason = 'no load prescription for this timed exercise yet';
        explanation.push(
          `Timed exercise: no history to anchor a load on, so none is suggested. Pick a weight you can hold for ~${block.targetRepRange[0]}s at the target effort — the engine progresses from what you log.`
        );
      } else {
        reason = 'enter your working weight to calibrate';
        explanation.push('Log a first set and future suggestions will anchor to it.');
      }
    }

    explanation.push(
      showRir
        ? `Target: ${block.targetRepRange[0]}–${block.targetRepRange[1]} ${isDurationBased ? 'seconds' : 'reps'} leaving ${effectiveTargetRir} in reserve (RIR ${effectiveTargetRir}).`
        : `Target: a controlled ${block.targetRepRange[0]}–${block.targetRepRange[1]} ${isDurationBased ? 'seconds' : 'reps'} — ramp sets have no effort target.`
    );

    if (showRir && adjustedRir?.hasAdjustment && adjustedRir.adjustmentReason) {
      reason += ' · calibration-adjusted';
      explanation.push(`Calibration: ${adjustedRir.adjustmentReason}.`);
    }
    if (showRir && readinessModulation?.banner) {
      reason += ' · eased for readiness';
      explanation.push(`Readiness: ${readinessModulation.banner}.`);
    }
    if (isAmrap) {
      explanation.push('Last set: push to failure (AMRAP) so the app can calibrate how you rate effort.');
    }

    // Deload session: the weight/reps still come from the (already-reduced)
    // deload prescription, but the rationale holds light rather than pushing
    // progression — and this session is excluded from PRs, e1RM trends and
    // next-week anchoring.
    if (isDeloadSession) {
      reason = 'deload — holding light';
      explanation.unshift(
        'Deload session: keeping the load easy to shed fatigue. This session is held out of PRs, e1RM trends and next session’s weight suggestion.'
      );
    }

    // 'Stop'-severity joint pain flagged on any set of THIS exercise this
    // session immediately softens the next suggestion: never progress — hold
    // at −10% of the flagged working weight instead.
    const stopFlaggedSet = [...completedSets]
      .reverse()
      .find((s) => s.feedback?.discomfort?.severity === 'stop');
    if (stopFlaggedSet && !isDeloadSession) {
      const flaggedPart = stopFlaggedSet.feedback?.discomfort?.bodyPart;
      const partLabel = flaggedPart
        ? getBodyPartDisplayName(flaggedPart).toLowerCase()
        : 'joint';
      const anchorKg = stopFlaggedSet.weightKg;
      if (anchorKg > 0) {
        weight = seedWeightString(anchorKg * 0.9);
      }
      reason = `easing off — you flagged ${partLabel} pain here`;
      explanation.unshift(
        `You stopped a set for ${partLabel} pain, so the load is backed off ~10% instead of progressing. If it still hurts, swap to a variation (⋯ menu → Swap).`
      );
    }

    return { weight, reps: String(reps), repsLabel, reason, explanation, showRir, role };
  };

  // Report the active set's live suggestion to the parent (the page's sticky
  // rest bar renders it as "next · 60 kg × 7"). Mirrors the SuggestionBanner
  // conditions/values exactly so the two surfaces can't disagree. Runs after
  // every render; the ref guard means the parent only hears actual changes.
  //
  // TODO(live-suggestion-state): this card→page callback is a point-to-point
  // patch. If any other consumer of the live recommendation appears, move the
  // suggestion into workoutStore and have the banner, rest bar, and pending
  // set pre-fills all read the same state. Known symptom of today's split
  // sources: after inline-editing a logged set, the pending next set's
  // pre-fill does not re-sync with the correction (only this banner/rest-bar
  // pair recomputes).
  const lastReportedSuggestionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!onActiveSuggestionChange) {
      // Deactivated (another card is current). Clear the guard so switching
      // back to this card always re-reports — the parent's label currently
      // belongs to the other card, so an unchanged-label suppression here
      // would leave the rest bar showing the wrong exercise's target.
      lastReportedSuggestionRef.current = undefined;
      return;
    }
    let label: string | null = null;
    if (isActive && !pendingDropset && !dropsetMode && pendingSetsCount > 0 && pendingInputs.length > 0) {
      const activeIsAmrap = isAmrapSuggested && pendingSetsCount === 1;
      const suggestion = buildSuggestionInfo(activeIsAmrap);
      const bannerWeight = isBodyweightExercise
        ? weightMode === 'bodyweight'
          ? 'BW'
          : `BW ${weightMode === 'weighted' ? '+' : '-'}${bwLoadInput || '0'} ${weightLabel}`
        : `${suggestion.weight || '—'} ${weightLabel}`;
      label = `${bannerWeight} × ${suggestion.repsLabel || '—'}${isDurationBased ? 's' : ''}`;
    }
    if (lastReportedSuggestionRef.current !== label) {
      lastReportedSuggestionRef.current = label;
      onActiveSuggestionChange(label);
    }
  });

  // Meta line under the header pills:
  // "{muscle} · last session 60 lbs × 9, × 8 @ 2 RIR"
  // Bodyweight sets with a recorded breakdown read "BW+25 lbs × 14" so the
  // added load is visible instead of the blended effective number.
  const lastSessionMeta = (() => {
    const lastSets = exerciseHistory?.lastWorkoutSets ?? [];
    if (lastSets.length === 0) return null;
    const repsPart = lastSets
      .slice(0, 3)
      .map((s) => `× ${s.reps}${isDurationBased ? 's' : ''}`)
      .join(', ');
    const rir = lastSets[0].rpe != null ? Math.max(0, Math.round(10 - lastSets[0].rpe)) : null;
    // Location-scoped calibration tag: for a local-scope exercise, mark whether
    // the last session shown is this gym's own track ("· here") or a softened
    // estimate carried over from another gym (rule 11).
    let locationTag = '';
    if (exerciseHistory?.progressionScope === 'local') {
      locationTag = exerciseHistory.estimatedFromOtherLocation
        ? ' · est. from another gym'
        : ' · here';
    }
    const weightPart = lastSets[0].bw
      ? `${historySetWeightLabel(lastSets[0])}${lastSets[0].bw.modification === 'none' ? '' : ` ${weightLabel}`}`
      : `${displayWeight(lastSets[0].weightKg, true)} ${weightLabel}`;
    return `last session ${weightPart} ${repsPart}${
      rir !== null ? ` @ ${rir} RIR` : ''
    }${locationTag}`;
  })();

  // Tooltip for the progression pace pill: E1RM trend vs expectation, plus
  // what the top set did versus the previous session (weight/rep deltas).
  const progressionTitle = (() => {
    if (!progressionInsight) return undefined;
    const sign = progressionInsight.weeklyChangePct >= 0 ? '+' : '';
    let title = `E1RM trend ${sign}${progressionInsight.weeklyChangePct}%/week · expected ~${progressionInsight.expectedWeeklyPct}%/week for your level`;
    const delta = progressionInsight.lastSessionDelta;
    if (delta && (delta.weightKg !== 0 || delta.reps !== 0)) {
      const parts: string[] = [];
      if (delta.weightKg !== 0) {
        parts.push(
          `${delta.weightKg > 0 ? '+' : ''}${convertWeightForDisplay(delta.weightKg, unit)} ${weightLabel}`
        );
      }
      if (delta.reps !== 0) {
        parts.push(`${delta.reps > 0 ? '+' : ''}${delta.reps} rep${Math.abs(delta.reps) === 1 ? '' : 's'}`);
      }
      title += ` · top set ${parts.join(', ')} vs prior session`;
    }
    return title;
  })();

  const safetyTier = getFailureSafetyTier(exercise.name);
  // Active caution flag (push_cautiously / protect). Signalled ONLY by the
  // amber tint on the title row's (i) icon; the reason renders in the
  // exercise info view.
  const isCautionedExercise = safetyTier !== 'push_freely';

  // Status pills line (plateau/pace/superset) renders only when at least one
  // pill exists — most exercises keep a single-line header.
  const showPacePill =
    !plateau &&
    !!progressionInsight &&
    (progressionInsight.pace === 'ahead' ||
      progressionInsight.pace === 'on_track' ||
      progressionInsight.pace === 'behind');
  const hasHeaderPills = !!plateau || showPacePill || !!block.supersetGroupId;

  // Enhanced mode: surface (never alter) a binding joint-stress cap. The RIR
  // floor is computed from the exercise alone; when it raises the effective
  // target above the block's prescription, the cap is actively constraining
  // intensity below what the enhanced landmarks would otherwise allow.
  const connectiveTissueCapBinds =
    enhancedAthleteMode && getRIRFloor(exercise.name) > block.targetRir;

  return (
    <Card
      variant={isActive ? 'elevated' : 'default'}
      padding="none"
      className={`relative overflow-hidden transition-all ${
        isActive ? 'ring-2 ring-primary-500/50' : ''
      }`}
    >
      {/* Header — single title row: grip · name · (i) · ⋮ · chevron. The old
          grade/caution pills line and muscle/last-session meta line moved into
          the exercise info view (the (i) / name tap target); position and set
          count render there too. Conditional status pills (plateau/pace/SS)
          keep their own line below only when one exists. */}
      <div className="p-4 sticky top-0 bg-surface-900 z-10">
        <div className="flex items-center gap-2">
          {/* Drag grip — long press to reorder. Visual icon is compact but the
              hit area stays ≥44×44 via min sizes, pulled back with negative
              margins so it doesn't inflate the title row. */}
          {onDragHandleStart && listIndex !== undefined && (
            <div
              data-drag-handle
              aria-label="Hold to reorder exercise"
              className="-my-2.5 -ml-3 flex min-h-[44px] min-w-[44px] flex-shrink-0 cursor-grab touch-none items-center justify-center text-surface-500 active:cursor-grabbing"
              onTouchStart={(e) => {
                e.stopPropagation();
                onDragHandleStart(listIndex, e.touches[0].clientY);
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                onDragHandleEnd?.();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onDragHandleStart(listIndex, e.clientY);
              }}
              onMouseUp={(e) => {
                e.stopPropagation();
                onDragHandleEnd?.();
              }}
              onMouseLeave={() => onDragHandleCancel?.()}
            >
              <IconGripVertical size={16} stroke={2} />
            </div>
          )}
          {/* Name + (i): the name takes all freed width before truncating; the
              info icon hugs the end of the name text. Both open the exercise
              info view (grade and caution reason live there). Icon-only
              caution signal: amber tint when the exercise carries an active
              caution flag — no badge, no text line. */}
          <div className="flex min-w-0 flex-1 items-center">
            <button
              onClick={onExerciseNameClick}
              className="min-w-0 truncate text-left text-[15px] font-medium text-surface-100 hover:text-primary-400 transition-colors"
            >
              {exercise.name}
            </button>
            {onExerciseNameClick && (
              <button
                onClick={onExerciseNameClick}
                aria-label={`Exercise info for ${exercise.name}`}
                data-testid="exercise-info-trigger"
                className={`-my-2.5 flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center transition-colors ${
                  isCautionedExercise
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-surface-500 hover:text-surface-300'
                }`}
              >
                <IconInfoCircle size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">
            {/* Row overflow (⋮) menu — page-built items (info, superset
                link/unlink, swap, plates, watch form, remove). Only while
                expanded: the collapsed row renders the block's single
                row-menu-trigger. */}
            {!isCollapsed && getMenuItems && listIndex !== undefined && (
              <div className="-my-2.5" onClick={(e) => e.stopPropagation()}>
                {/* getItems (not items): this card is memoized and can skip
                    renders while a NEIGHBOR's superset state changes, which
                    the page-built menu depends on ("Link with {next}"). Lazy
                    build on open always reads the freshest page state. */}
                <RowOverflowMenu
                  testId="row-menu-trigger"
                  dataBlockId={block.id}
                  ariaLabel={`Actions for ${exercise.name}`}
                  getItems={() => getMenuItems(listIndex)}
                />
              </div>
            )}
            {/* Collapse chevron (points up; the collapsed row shows the down twin) */}
            {onToggleCollapse && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(block.id);
                }}
                className="-my-2.5 -mr-2 flex min-h-[44px] min-w-[40px] items-center justify-center text-surface-400 hover:text-surface-200 transition-colors"
                aria-label="Collapse exercise"
              >
                <IconChevronDown size={20} className="rotate-180" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Status pills line — plateau / pace / superset only. The static
            grade + caution badges moved into the exercise info view; this line
            renders only when an actionable/status pill exists. */}
        {hasHeaderPills && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
            {/* Progression pace pill (services/progressionInsights) — trend vs
                the expected rate for the user's experience level. The plateau
                badge takes precedence when both would show. */}
            {showPacePill && progressionInsight && (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none flex-shrink-0 ${
                  progressionInsight.pace === 'ahead'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : progressionInsight.pace === 'on_track'
                      ? 'bg-surface-700/60 text-surface-300'
                      : 'bg-orange-500/10 text-orange-400'
                }`}
                title={progressionTitle}
              >
                {progressionInsight.pace === 'ahead'
                  ? '▲ Ahead'
                  : progressionInsight.pace === 'on_track'
                    ? 'On track'
                    : '▼ Behind'}
              </span>
            )}
            {block.supersetGroupId && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium leading-none flex-shrink-0 bg-cyan-500/20 text-cyan-400">
                SS{block.supersetOrder}
              </span>
            )}
          </div>
        )}

        {/* Meta line — muscle + last-session summary; doubles as the history
            expandable trigger when history exists */}
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

        {/* Enhanced mode: the joint-stress RIR floor is constraining this
            exercise below what the raised landmarks would allow */}
        {connectiveTissueCapBinds && (
          <p className="mt-1.5 text-[11px] text-warning-400/90">
            {CONNECTIVE_TISSUE_CAP_NOTE}
          </p>
        )}

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
                        title={
                          set.bw && set.bw.modification !== 'none'
                            ? `Effective load ${displayWeight(set.weightKg, true)} ${weightLabel}`
                            : undefined
                        }
                      >
                        {historySetWeightLabel(set)} × {set.reps}{isDurationBased ? 's' : ''}
                        {set.rpe && <span className="text-surface-500"> @{set.rpe}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Warmup sets - keep in separate table for now (legacy) */}
      {isActive && effectiveWarmupSets.length > 0 && warmupWorkingWeightKg > 0 && (
        <div className="border-b border-surface-800">
          {/* Collapsible header */}
          <button
            onClick={() => setIsWarmupExpanded(!isWarmupExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-surface-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  completedWarmups.size === effectiveWarmupSets.length
                    ? 'bg-success-500/20 text-success-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                {completedWarmups.size === effectiveWarmupSets.length ? '✓' : completedWarmups.size}
              </div>
              <span className="text-sm font-medium text-surface-200">
                Warmup Protocol
              </span>
              <span className="text-xs text-surface-500">
                ({completedWarmups.size}/{effectiveWarmupSets.length})
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
                {effectiveWarmupSets.map((warmup) => {
                  const calculatedWeightKg = warmupWorkingWeightKg * (warmup.percentOfWorking / 100);
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
                {completedWarmups.size < effectiveWarmupSets.length && (
                  <tr className="bg-surface-800/30">
                    <td colSpan={6} className="px-3 py-1.5 text-center">
                      <button
                        onClick={() => setCompletedWarmups(new Set(effectiveWarmupSets.map(w => w.setNumber)))}
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
        {/* Exercise-level pain pattern notice (≥3 flags in 6 weeks) — one-time,
            dismissible, non-blocking. Links to the swap picker's Similar tab. */}
        {painNotice && (
          <div
            className="flex items-start gap-2 rounded-lg bg-warning-500/10 border border-warning-500/30 px-2.5 py-2 text-[12px] text-warning-300"
            data-testid="pain-pattern-notice"
          >
            <span className="flex-1">
              You&apos;ve flagged {getJointDisplayName(painNotice.joint)} pain on this {painNotice.count}× recently — consider a variation.{' '}
              <button
                type="button"
                onClick={() => {
                  setSwapTab('similar');
                  setShowSwapModal(true);
                }}
                className="underline font-medium"
              >
                See similar
              </button>
            </span>
            <button
              type="button"
              onClick={onPainNoticeDismiss}
              aria-label="Dismiss pain notice"
              className="text-warning-400/70 hover:text-warning-300 flex-shrink-0 px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Start-of-session soreness ask — one tap, collapses to a ✓ line.
            Ignoring it and logging a set dismisses it for the session. */}
        {sorenessPrompt && onSorenessAnswer && (
          <SorenessChipRow
            muscleLabel={sorenessPrompt.displayName}
            answered={sorenessPrompt.answered}
            onAnswer={(rating) => onSorenessAnswer(sorenessPrompt.muscle, rating)}
          />
        )}

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
                {onSetJointPain && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setJointPickerSetId((prev) => (prev === set.id ? null : set.id));
                    }}
                    aria-label={`Log joint pain on set ${set.setNumber}`}
                    data-testid={`set-joint-pain-${set.setNumber}`}
                    className={`flex-shrink-0 min-w-[32px] min-h-[32px] -my-1 flex items-center justify-center rounded-lg transition-colors ${
                      set.feedback?.discomfort
                        ? 'text-danger-400'
                        : 'text-surface-600 hover:text-surface-300'
                    }`}
                  >
                    <IconBone size={15} />
                  </button>
                )}
              </div>

              {/* Inline joint pain picker for this completed set (two taps) */}
              {jointPickerSetId === set.id && onSetJointPain && (
                <JointPainPicker
                  onPick={(joint, severity) => {
                    onSetJointPain(set.id, { bodyPart: jointToBodyPart(joint), severity });
                    setJointPickerSetId(null);
                  }}
                  onCancel={() => setJointPickerSetId(null)}
                />
              )}

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

          // Live effort check for the ENTERED weight × reps (the stepper
          // values, not the suggestion): predicted RIR on the SAME e1RM the
          // prescription came from, via the engine's own curve
          // (setRecommender.estimateRepsForWeight with targetRir 0 = rep-max
          // at that weight; predicted RIR = rep-max − entered reps). The
          // banner debounces and renders the amber warning state itself so
          // the 250ms flip re-renders only the banner.
          const effortCheck = (() => {
            if (isDurationBased) return null;
            const enteredReps = parseInt(input.reps);
            if (isNaN(enteredReps) || enteredReps < 1) return null;

            const entered = parseEnteredLoad({
              weightStr: input.weight,
              bwLoadStr: bwLoadInput,
              isBodyweight: isBodyweightExercise,
              weightMode,
              userBodyweightKg,
              unit,
              unitLabel: weightLabel,
            });
            if (!entered || !(entered.kg > 0)) return null;
            const enteredKg = entered.kg;

            const lastCompleted = completedSets[completedSets.length - 1];
            let maxReps: number | null;
            if (lastCompleted) {
              // Within-session: same capacity anchor as recommendSet —
              // max(session-best e1RM, Epley of the last set at its logged
              // RIR), fatigue-adjusted for sets already done.
              maxReps = estimateRepsForWeight(enteredKg, {
                lastWeightKg: lastCompleted.weightKg,
                lastReps: lastCompleted.reps,
                lastRir: resolveLastRir(lastCompleted, effectiveTargetRir),
                setsCompletedThisExercise: completedSets.length,
                sessionBestE1RMKg: sessionBestE1RM,
                targetRepRange: block.targetRepRange,
                targetRir: 0,
              });
            } else {
              // Session start: the same prescription e1RM ladder the seed's
              // rep answer used (seedRepsForWeight) — last-session resolved
              // e1RM, else the cold-start estimate. No rung → no warning.
              const e1rm = lastSessionE1RM ?? coldStartE1RM;
              maxReps = e1rm
                ? estimateRepsForWeight(enteredKg, {
                    lastWeightKg: 0,
                    lastReps: 0,
                    lastRir: 0,
                    setsCompletedThisExercise: 0,
                    sessionBestE1RMKg: e1rm,
                    targetRepRange: block.targetRepRange,
                    targetRir: 0,
                  })
                : null;
            }
            if (maxReps == null) return null;

            // Confidence: an e1RM transferred from another lift (cold-start
            // estimate; proxy = no logged working set for THIS exercise)
            // softens the copy and names the source.
            const hasOwnHistory = !!lastCompleted || lastSessionE1RM !== undefined;
            return {
              predictedRir: maxReps - enteredReps,
              weightLabel: entered.label,
              reps: enteredReps,
              softened: !hasOwnHistory,
              sourceLabel: !hasOwnHistory
                ? coldStartSuggestion?.reason ?? 'estimate from your training profile'
                : undefined,
            };
          })();

          return (
            <div className="space-y-2 pt-1">
              <SuggestionBanner
                weightLabel={bannerWeight}
                repsLabel={`${suggestion.repsLabel || '—'}${isDurationBased ? 's' : ''}`}
                rir={Math.max(0, Math.min(3, loggerTargetRir))}
                showRir={suggestion.showRir}
                roleTag={suggestion.role === 'ramp' ? 'ramp' : null}
                reason={suggestion.reason}
                explanation={suggestion.explanation}
                effortCheck={effortCheck}
                setKey={activeSetNumber}
              />
              {weightEditNote && (
                <p
                  data-testid="weight-edit-recompute-note"
                  className="px-1 text-[11px] text-primary-300"
                >
                  {weightEditNote.weightDisplay} {weightLabel} ⇒ ~{weightEditNote.reps}{' '}
                  {isDurationBased ? 'seconds' : 'reps'} @ {weightEditNote.rir} RIR (from your{' '}
                  {displayWeight(weightEditNote.e1rmKg, true)} {weightLabel} e1RM)
                </p>
              )}
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
                exerciseId={exercise.id}
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

        {/* Completed-state pump/workload chips (RP stimulus-quality question,
            once per exercise). Shown when the last planned set is logged, or
            when a partially-done exercise is no longer the active one. Both
            optional — the card completes visually regardless. */}
        {onExerciseFeedbackChange &&
          completedSets.length > 0 &&
          (pendingSetsCount === 0 || !isActive) && (
            <ExerciseFeedbackChips
              pump={block.pump}
              workload={block.workload}
              onChange={onExerciseFeedbackChange}
            />
          )}
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
            ref={swapSheetRef}
            className="relative w-full max-w-lg bg-surface-900 rounded-t-2xl sm:rounded-xl shadow-2xl border border-surface-700 overflow-hidden flex flex-col"
            style={{
              // Keep the sheet (and its search field) above the on-screen
              // keyboard; safe-area stays additive with the keyboard inset.
              marginBottom: swapKeyboardInset > 0 ? swapKeyboardInset : undefined,
              maxHeight: `min(85vh, calc(100vh - ${swapKeyboardInset}px))`,
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
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
                  {swapBrowseResults
                    .map((alt) => {
                      const altInjuryRisk = getExerciseInjuryRiskFromService({ name: alt.name, primaryMuscle: alt.primaryMuscle }, currentInjuries);
                      const usageCount = frequentExerciseIds.get(alt.id) || 0;
                      const isFrequent = usageCount >= 2;
                      
                      return (
                        <button
                          key={alt.id}
                          data-testid="swap-browse-row"
                          data-exercise-id={alt.id}
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
                  {swapBrowseResults.length === 0 && (
                    <p className="p-8 text-center text-surface-500" data-testid="swap-browse-empty">
                      {swapSearch || swapMuscleFilter ? 'No matching exercises found' : 'No exercises available'}
                    </p>
                  )}
                </>
              )}
            </div>
            
            {/* Footer: swap to a brand-new custom exercise (opens creation flow) */}
            {onCreateCustomSwap && (
              <div className="p-3 border-t border-surface-700 bg-surface-800/50">
                <button
                  onClick={() => {
                    setShowSwapModal(false);
                    onCreateCustomSwap(swapSearch.trim() || undefined);
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-primary-400 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create custom exercise
                </button>
              </div>
            )}

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
    // Per-exercise feedback chips (pump/workload live on the block)
    prevProps.block.pump === nextProps.block.pump &&
    prevProps.block.workload === nextProps.block.workload &&
    // Subjective-feedback prompts arrive ASYNC after mount (previous-session
    // lookup, pain-event fetch) — without these comparisons the card would
    // never re-render to show them.
    (prevProps.sorenessPrompt === null) === (nextProps.sorenessPrompt === null) &&
    prevProps.sorenessPrompt?.muscle === nextProps.sorenessPrompt?.muscle &&
    prevProps.sorenessPrompt?.answered === nextProps.sorenessPrompt?.answered &&
    (prevProps.painNotice === null) === (nextProps.painNotice === null) &&
    prevProps.painNotice?.joint === nextProps.painNotice?.joint &&
    prevProps.painNotice?.count === nextProps.painNotice?.count &&
    // Set-level discomfort flags drive the 'stop' suggestion softening + row icons
    prevProps.sets.every(
      (s, i) => s.feedback?.discomfort?.severity === nextProps.sets[i]?.feedback?.discomfort?.severity
    ) &&
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
    prevProps.userGoal === nextProps.userGoal &&
    prevProps.isAmrapSuggested === nextProps.isAmrapSuggested &&
    prevProps.userBodyweightKg === nextProps.userBodyweightKg &&
    prevProps.enhancedAthleteMode === nextProps.enhancedAthleteMode &&
    prevProps.isDeloadSession === nextProps.isDeloadSession &&
    // Compact title-row chrome. These drive the collapsed gating of the ⋮
    // control and the index handed back to the drag and menu callbacks — a
    // stale listIndex would reorder the wrong block. The callbacks themselves
    // are identity-stable latest-ref wrappers in the page, so they are
    // deliberately not compared.
    prevProps.listIndex === nextProps.listIndex &&
    prevProps.isCollapsed === nextProps.isCollapsed &&
    // SS pill on the pills line (covers unlink of a drag-split pair, where the
    // slot letter is null on both sides of the change)
    prevProps.block.supersetGroupId === nextProps.block.supersetGroupId &&
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
