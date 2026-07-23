'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateWorkoutDerivedCaches } from '@/lib/query/workoutInvalidation';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Card, Button, Badge, Input, LoadingAnimation, SkeletonExercise, ConfirmModal, ToastContainer, useToasts } from '@/components/ui';
import {
  enqueueRowUpdate,
  enqueueSetInsert,
  flushSetOutbox,
  isMissingColumnError,
  isNetworkError,
  listOutbox,
  outboxCount,
  removeQueuedSet,
  updateQueuedSet,
  withoutOptionalSetLogColumns,
} from '@/lib/offline/setOutbox';
import type { SetSyncStatus } from '@/components/workout/ExerciseCard';
import { InlineHint } from '@/components/ui/FirstTimeHint';
import { RestTimer, PauseOverlay, RowOverflowMenu, type RowMenuItem } from '@/components/workout';
import { IconGripVertical, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useRestTimer } from '@/hooks/useRestTimer';
import { useEducationStore } from '@/hooks/useEducationPreferences';

// Dynamic import ExerciseCard (118KB) to reduce initial bundle and improve page load
const ExerciseCard = dynamic(
  () => import('@/components/workout').then(m => m.ExerciseCard),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-gray-800 rounded-xl h-64 w-full" />
    )
  }
);
import { useWorkoutTimer, firstLoggedSetTime } from '@/hooks/useWorkoutTimer';

// Dynamic imports for components not needed on initial render
const WarmupProtocol = dynamic(() => import('@/components/workout').then(m => m.WarmupProtocol), { ssr: false });
const ReadinessCheckIn = dynamic(() => import('@/components/workout').then(m => m.ReadinessCheckIn), { ssr: false });
// The Muscle Readiness sheet (volume + recovery) is lazy — its content and data
// hook only load/run the first time the user opens it, so it costs the workout
// screen nothing on load.
const MuscleReadinessSheet = dynamic(() => import('@/components/workout/MuscleReadinessSheet').then(m => m.MuscleReadinessSheet), { ssr: false });
// Inline readiness for the EMPTY workout state (0 exercises): renders the same
// read-only readiness body as the sheet plus readiness-ranked Quick Add chips.
// Lazy so the hook + assembly stay out of the workout screen's initial bundle;
// it only mounts while the workout is empty, then unmounts once a block exists.
const EmptyWorkoutReadiness = dynamic(() => import('@/components/workout/EmptyWorkoutReadiness').then(m => m.EmptyWorkoutReadiness), { ssr: false });
// The summary chunk loads over the network the first time the user finishes
// a workout — without a loading fallback the screen renders BLANK until it
// arrives (looks frozen on a slow connection), so show a matching skeleton.
const SessionSummary = dynamic(() => import('@/components/workout').then(m => m.SessionSummary), {
  ssr: false,
  loading: () => (
    <div className="max-w-lg mx-auto space-y-6 animate-pulse" aria-busy="true">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800" />
        <div className="h-7 bg-surface-800 rounded w-56 mx-auto" />
        <div className="h-4 bg-surface-800 rounded w-40 mx-auto mt-2" />
      </div>
      <div className="h-40 bg-surface-800/60 rounded-xl" />
      <div className="h-32 bg-surface-800/60 rounded-xl" />
      <div className="h-32 bg-surface-800/60 rounded-xl" />
    </div>
  ),
});
const ExerciseDetailsModal = dynamic(() => import('@/components/workout').then(m => m.ExerciseDetailsModal), { ssr: false });
const PlateCalculatorModal = dynamic(() => import('@/components/workout').then(m => m.PlateCalculatorModal), { ssr: false });
import type { Exercise, ExerciseBlock, SetLog, WorkoutSession, WeightUnit, DexaRegionalData, TemporaryInjury, PreWorkoutCheckIn, SetFeedback, Rating, BodyweightData, ExerciseType, StandardMuscleGroup, ExercisePerformanceSnapshot, RepsInTank, SorenessRating, PumpRating0to3, WorkloadRating, SetDiscomfort, JointPainJoint } from '@/types/schema';
import type { SessionMuscleFeedbackEntry, SessionSummarySubmitData } from '@/components/workout/SessionSummary';
import type { MuscleSorenessRatings } from '@/components/workout/ReadinessCheckIn';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { generateWarmupProtocol, isMuscleWarmedUp } from '@/services/progressionEngine';
import { MUSCLE_GROUPS, muscleMatchesGroup, rirToRpe, rpeToRir, STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { quickWeightEstimate, quickWeightEstimateWithCalibration, type WorkingWeightRecommendation, type TransferCandidate } from '@/services/weightEstimationEngine';
import { fetchTransferCandidates } from '@/lib/training/transferCandidates';
import { inferSetRole, sessionTopSetWeightKg } from '@/services/suggestionEngine/setRoles';
import { SUGGESTION_ENGINE_VERSION } from '@/services/suggestionEngine/constants';
import { addExerciseOverride, getSessionFromProgramData, applyExerciseOverrides, type ExerciseOverride } from '@/services/mesocycleHelpers';
import { computeStapleExerciseIds } from '@/services/exerciseStaples';
import { convertWeightForDisplay, deriveWorkoutLabel, formatMuscleName, formatWeight, getLocalDateString, inputWeightToKg } from '@/lib/utils';
import { generateWorkoutCoachNotes, type WorkoutCoachNotesInput } from '@/lib/actions/coaching';
import { 
  getInjuryRisk, 
  getSafeAlternatives, 
  autoSwapForInjuries,
  getInjuryDescription,
  INJURY_LABELS,
  type InjuryArea,
  type InjuryContext,
  type InjuryRisk
} from '@/services/injuryAwareSwapper';
import { exerciseRequiresUnavailableEquipment } from '@/services/equipmentFilter';
import { CreateCustomExercise } from '@/components/exercises/CreateCustomExercise';
import { ShareWorkoutModal } from '@/components/social/sharing/ShareWorkoutModal';
import { checkSetSanity, type SanityCheckResult } from '@/services/sanityChecks';
import { RPECalibrationEngine, type CalibrationResult, type CalibrationSetLog } from '@/services/rpeCalibration';
import { applyReadinessModulation } from '@/services/fatigueEngine';
import { buildPerformanceSnapshots, type SnapshotSourceBlock } from '@/components/workout/exercisePerformance';
import { getFailureSafetyTier } from '@/services/exerciseSafety';
import { SanityCheckToast } from '@/components/workout/SanityCheckToast';
import { CalibrationResultCard } from '@/components/workout/CalibrationResultCard';
import { useWorkoutStore } from '@/stores/workoutStore';
import { WorkoutHeader, type ExerciseSegmentStatus } from './_components/WorkoutHeader';
import { WorkoutVolumeStrip } from './_components/WorkoutVolumeStrip';
import { AddExercisePicker } from './_components/AddExercisePicker';
import {
  buildExerciseHistories,
  fetchExerciseHistory,
  flattenExerciseHistoryRows,
  generateCoachMessage,
  HISTORY_SESSIONS_PER_EXERCISE,
  type ExerciseHistoryQueryRow,
} from './_lib/suggestions';
import { deriveProgressionScope, type ProgressionScope } from '@/services/progressionScope';
import {
  mapLoadedBlockRow,
  mapSetLogRow,
  mapWorkoutSessionRow,
  type LoadedBlockRow,
} from './_lib/sessionMapping';
import {
  fetchRecentMuscleSessions,
  resolvePrimaryMuscle,
  upsertSessionMuscleFeedback,
  type RecentMuscleSession,
} from './_lib/muscleFeedbackWrites';
import {
  insertJointPainEvent,
  eventFromSetDiscomfort,
  getPainNoticeDismissedAt,
  setPainNoticeDismissed,
} from './_lib/jointPainWrites';
import { getExercisePainPattern, jointToBodyPart, type ExercisePainEvent } from '@/services/discomfortTracker';
import { rollUpExerciseFeedback } from '@/services/weeklyProgressionEngine';
import { computeMuscleRecovery, recoveryConfigFor } from '@/services/muscleRecovery';
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
import { useWorkoutMuscleVolume } from '@/hooks/useWorkoutMuscleVolume';
import { useRecoveryMultipliers } from '@/hooks/useRecoveryMultipliers';
import { isStaleEmptyAdhocSession, discardStaleSession } from '../_lib/adhocSession';
import { computeSupersetAdvance } from './_lib/supersetFlow';
import {
  findStaleTargetBlocks,
  computeRecalcChanges,
  type PlannedTargetBlock,
  type RecalcChange,
} from '../_lib/staleTargets';
import { RecalcTargetsBanner } from '@/components/workout';
import { cancelWorkoutSession } from './_lib/cancelWorkout';
import { sessionIndexFromCompleted } from '@/lib/training/mesocycleProgress';
import { countCompletedSessions } from '@/lib/training/startMesocycleSession';
import { matchAdhocToPlannedSession } from '@/lib/training/adhocClaim';
import { submitFinishOptimistic, confirmClaimOptimistic } from './_lib/finishWorkout';
import type {
  AvailableExercise,
  CalibratedLift,
  ExerciseBlockWithExercise,
  ExerciseHistoryData,
  GymLocation,
  UserContext,
  UserProfileForWeights,
  WorkoutPhase,
} from './_lib/types';

// Equipment availability is checked through the shared fail-closed filter
// (services/equipmentFilter.ts) against the location's blocklist of
// equipment_types ids — no inline keyword mapping.

// Wrapper to convert injuries array to get risk info using new intelligent swapper
function getExerciseInjuryRisk(
  exercise: Exercise, 
  injuries: { area: string; severity: 1 | 2 | 3 }[]
): { isRisky: boolean; severity: number; reasons: string[]; risk: InjuryRisk } {
  if (injuries.length === 0) return { isRisky: false, severity: 0, reasons: [], risk: 'safe' };
  
  let worstRisk: InjuryRisk = 'safe';
  let maxSeverity = 0;
  const reasons: string[] = [];
  
  for (const injury of injuries) {
    const risk = getInjuryRisk(exercise, injury.area as InjuryArea);
    
    if (risk === 'avoid') {
      worstRisk = 'avoid';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`May aggravate ${INJURY_LABELS[injury.area] || injury.area}`);
    } else if (risk === 'caution' && worstRisk !== 'avoid') {
      worstRisk = 'caution';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`Use caution (${INJURY_LABELS[injury.area] || injury.area})`);
    }
  }
  
  return {
    isRisky: worstRisk !== 'safe',
    severity: maxSeverity,
    reasons: Array.from(new Set(reasons)),
    risk: worstRisk
  };
}

/**
 * Cancel-workout confirmation. Rendered from BOTH page branches (empty and
 * populated) — previously it only existed in the populated branch, so the
 * empty-workout "Cancel Workout" button silently did nothing (P0-1).
 */
function CancelWorkoutModal({
  totalCompletedSets,
  isCancelling,
  onKeepGoing,
  onConfirm,
}: {
  totalCompletedSets: number;
  isCancelling: boolean;
  onKeepGoing: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => !isCancelling && onKeepGoing()}
      />
      <div className="relative w-full max-w-sm mx-4 bg-surface-900 rounded-2xl border border-surface-800 overflow-hidden">
        <div className="p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-danger-500/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-surface-100 mb-2">Cancel Workout?</h3>
          <p className="text-sm text-surface-400 mb-6">
            {totalCompletedSets > 0
              ? `You've logged ${totalCompletedSets} set${totalCompletedSets !== 1 ? 's' : ''}. Cancelling will delete all progress and reset this workout.`
              : 'This will reset the workout so you can start fresh later.'}
          </p>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={onKeepGoing}
              disabled={isCancelling}
              className="flex-1"
            >
              Keep Going
            </Button>
            <Button
              variant="outline"
              onClick={onConfirm}
              disabled={isCancelling}
              className="flex-1 border-danger-500/50 text-danger-400 hover:bg-danger-500/10"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel Workout'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const sessionId = params.id as string;
  const fromCreate = searchParams.get('fromCreate') === 'true';
  const { preferences, updatePreference, isLoading: preferencesLoading } = useUserPreferences();
  const showBeginnerTips = useEducationStore((state) => state.showBeginnerTips);
  const pauseSession = useWorkoutStore((state) => state.pauseSession);
  const resumeSession = useWorkoutStore((state) => state.resumeSession);
  const startWorkoutSession = useWorkoutStore((state) => state.startSession);
  const endWorkoutSession = useWorkoutStore((state) => state.endSession);
  const logSetToStore = useWorkoutStore((state) => state.logSet);
  const updateSetInStore = useWorkoutStore((state) => state.updateSet);
  const deleteSetFromStore = useWorkoutStore((state) => state.deleteSet);
  const setStoreBlockIndex = useWorkoutStore((state) => state.setCurrentBlock);
  const muscleSorenessAsked = useWorkoutStore((state) => state.muscleSorenessAsked);
  const recordSorenessAsked = useWorkoutStore((state) => state.recordSorenessAsked);
  const setBlockFeedbackInStore = useWorkoutStore((state) => state.setBlockFeedback);

  // Recovery model inputs for the soreness-answer learning step: the shared
  // completed-session history (same React Query cache as the readiness sheet)
  // plus the per-muscle learned multipliers. `recoveryNow` is stamped once so
  // the model status at ask time is stable within the session.
  const [recoveryNow] = useState(() => new Date());
  const { sessions: recoveryHistorySessions } = useRecoveryHistory(recoveryNow, true);
  const { multipliers: recoveryMultipliers, applySorenessAdjustment } = useRecoveryMultipliers();

  // Toast notifications for errors
  const { toasts, dismissToast, showError, showSuccess, addToast } = useToasts();

  // --- Offline outbox state (P0-2) ---------------------------------------
  // Per-set write status drives the glyphs on completed set rows; outboxSize
  // powers the offline banner's "N sets queued".
  const [setSync, setSetSync] = useState<Record<string, SetSyncStatus>>({});
  const [isOnline, setIsOnline] = useState(true);
  const [outboxSize, setOutboxSize] = useState(0);

  const refreshOutboxCount = useCallback(() => {
    // Banner copy says "N sets queued" — don't count queued finish/feedback
    // entries left over from a previously finished offline workout.
    void outboxCount('set_logs').then(setOutboxSize).catch(() => {});
  }, []);

  // Derive per-set statuses from the outbox itself. This is the source of
  // truth no matter WHICH listener's flush drained the queue (the dashboard
  // layout also flushes on 'online'): id in outbox -> queued; a set we marked
  // queued that left the outbox -> saved. 'saving' entries with an in-flight
  // insert are left for that insert's continuation to settle.
  const reconcileSetSync = useCallback(async () => {
    try {
      const entries = await listOutbox();
      const queuedIds = new Set(entries.map(e => e.id));
      setOutboxSize(entries.filter(e => e.table === 'set_logs').length);
      setSetSync(prev => {
        let changed = false;
        const next = { ...prev };
        for (const [id, status] of Object.entries(prev)) {
          if (queuedIds.has(id) && status !== 'queued') {
            next[id] = 'queued';
            changed = true;
          } else if (!queuedIds.has(id) && status === 'queued') {
            next[id] = 'saved';
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch {
      // Outbox unavailable — leave statuses as they are.
    }
  }, []);

  // Flush queued sets whenever connectivity returns (and once on mount, in
  // case the app reopened online with a non-empty queue). A slow poll keeps
  // the glyphs honest even if the browser never fires 'online' events.
  useEffect(() => {
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    refreshOutboxCount();

    const flush = () => {
      const supabase = createUntypedClient();
      void flushSetOutbox(supabase).then(() => reconcileSetSync());
    };

    const handleOnline = () => { setIsOnline(true); flush(); };
    const handleOffline = () => { setIsOnline(false); void reconcileSetSync(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (typeof navigator === 'undefined' || navigator.onLine) flush();

    const poll = setInterval(() => {
      void reconcileSetSync();
      if (typeof navigator === 'undefined' || navigator.onLine) {
        void outboxCount().then(n => { if (n > 0) flush(); });
      }
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(poll);
    };
  }, [refreshOutboxCount, reconcileSetSync]);

  // Delete confirmation modal state for header row delete button
  const [deleteConfirmBlock, setDeleteConfirmBlock] = useState<{ id: string; name: string } | null>(null);

  const [phase, setPhase] = useState<WorkoutPhase>('loading');
  const [isFirstWorkout, setIsFirstWorkout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [blocks, setBlocks] = useState<ExerciseBlockWithExercise[]>([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState<SetLog[]>([]);
  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [restTimerDuration, setRestTimerDuration] = useState<number | null>(null); // Custom rest time (for warmups)
  // Live next-set suggestion reported by the current ExerciseCard's banner
  // (e.g. "60 kg × 7"). The sticky rest bar prefers this over the block's
  // planned target, which goes stale as soon as the suggestion moves.
  const [activeSuggestionLabel, setActiveSuggestionLabel] = useState<string | null>(null);
  // Blocks the user skipped for this session ("Skip today" on an up-next row).
  // Mirrors exercise_blocks.skipped_at; excluded from progress, summary
  // aggregates, and progression/feedback derivations.
  const [skippedBlockIds, setSkippedBlockIds] = useState<Set<string>>(new Set());
  // Ad-hoc workout that matches the mesocycle's next pending session: armed
  // by the summary-phase check, prompts after Finish to count the workout
  // toward the plan (sets mesocycle_id — never claimed silently).
  const [claimCandidate, setClaimCandidate] = useState<{ mesocycleId: string; dayName: string } | null>(null);
  const [showClaimPrompt, setShowClaimPrompt] = useState(false);
  // Session RPE from the submitted summary, kept for the claim path's
  // post-session meso updates (the summary data is gone once the prompt shows).
  const [submittedSessionRpe, setSubmittedSessionRpe] = useState<number | null>(null);
  // Session-local readiness banner state: dismissed hides the strip only;
  // "Train as planned" additionally zeroes the modulation passed down.
  const [readinessBannerDismissed, setReadinessBannerDismissed] = useState(false);
  const [readinessOverridden, setReadinessOverridden] = useState(false);
  const [exerciseHistories, setExerciseHistories] = useState<Record<string, ExerciseHistoryData>>({});
  // Cross-exercise strength summary for cold-start transfer estimation
  // (a never-trained exercise seeds from a related exercise's logged e1RM).
  const [transferCandidates, setTransferCandidates] = useState<TransferCandidate[]>([]);
  // Per-session performance snapshots per exercise (plateau detection input)
  const [performanceSnapshots, setPerformanceSnapshots] = useState<Record<string, ExercisePerformanceSnapshot[]>>({});
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  
  // Drag reorder state for exercises
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [dragOverBlockIndex, setDragOverBlockIndex] = useState<number | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const preCollapseStateRef = useRef<{ allCollapsed: boolean; collapsedBlocks: Set<string> } | null>(null);

  // Focus mode: keep only the current exercise expanded so you see just the
  // sets you're working on. Re-focuses when you advance to the next exercise;
  // manual per-card toggles between advances are preserved until the next move.
  useEffect(() => {
    if (blocks.length === 0) return;
    const currentId = blocks[currentBlockIndex]?.id;
    if (!currentId) return;
    setCollapsedBlocks(new Set(blocks.filter((b) => b.id !== currentId).map((b) => b.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlockIndex, blocks.length]);

  // Floating drag preview state
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragTouchOffset, setDragTouchOffset] = useState<number>(0); // Offset from touch point to top of element
  const [draggedBlockRect, setDraggedBlockRect] = useState<DOMRect | null>(null);
  const draggedBlockRef = useRef<HTMLDivElement | null>(null);
  const exerciseListRef = useRef<HTMLDivElement | null>(null);
  const dragTouchOffsetRef = useRef<number>(0);
  
  // Add exercise modal state
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [availableExercises, setAvailableExercises] = useState<AvailableExercise[]>([]);
  const [frequentExerciseIds, setFrequentExerciseIds] = useState<Map<string, number>>(new Map());
  const [lastDoneExercises, setLastDoneExercises] = useState<Map<string, Date>>(new Map());
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('');
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  // Empty-state "Copy last workout instead" action
  const [isCopyingLastWorkout, setIsCopyingLastWorkout] = useState(false);
  const [selectedMuscleFilter, setSelectedMuscleFilter] = useState<string | null>(null);
  // Equipment-class filter: second, orthogonal axis (multi-select union, ANDs
  // with muscle). Lives in the page so it outlives the modal like muscle does.
  const [selectedEquipmentGroups, setSelectedEquipmentGroups] = useState<string[]>([]);
  const toggleEquipmentGroup = useCallback((group: string) => {
    setSelectedEquipmentGroups(prev =>
      prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]
    );
  }, []);
  const [showMuscleDropdown, setShowMuscleDropdown] = useState(false);
  const [selectedExercisesToAdd, setSelectedExercisesToAdd] = useState<AvailableExercise[]>([]);
  const [exerciseSortOption, setExerciseSortOption] = useState<'frequency' | 'name' | 'recent'>('frequency');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  // When false, the picker collapses the long tail of rarely-used exercises
  // behind a "Show all" toggle (the default-visible set is staples + exercises
  // the user has actually performed). Always expanded while searching.
  const [showAllExercises, setShowAllExercises] = useState(false);

  // Location filter state
  const [gymLocations, setGymLocations] = useState<GymLocation[]>([]);
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<string | null>(null);
  // The location THIS session was started at (workout_sessions.location_id).
  // Stamped on every set logged here and used to scope local-scope exercise
  // history for calibration. Null = legacy/unknown session.
  const [sessionLocationId, setSessionLocationId] = useState<string | null>(null);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  // Blocklist of equipment_types ids the selected location lacks; consumed by
  // the shared fail-closed equipment filter (picker, swaps, injury adjuster).
  const [locationUnavailableEquipmentIds, setLocationUnavailableEquipmentIds] = useState<string[]>([]);
  const [unavailableExerciseIds, setUnavailableExerciseIds] = useState<Set<string>>(new Set());

  // Share workout modal state
  const [showShareModal, setShowShareModal] = useState(false);
  
  // Custom exercise creation state
  const [showCustomExercise, setShowCustomExercise] = useState(false);
  // When set, the custom-exercise modal was opened from a swap flow: on save,
  // the new exercise replaces this block instead of being added to the workout.
  const [customSwapBlockId, setCustomSwapBlockId] = useState<string | null>(null);
  // Pre-filled name when creating a custom exercise from a swap search
  const [customSwapInitialName, setCustomSwapInitialName] = useState('');
  
  // Coach message state
  const [showCoachMessage, setShowCoachMessage] = useState(true);
  const [coachMessage, setCoachMessage] = useState<ReturnType<typeof generateCoachMessage> | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileForWeights | null>(null);

  // P1-3 recalc banner (detection A). Dormant until the set_logs.edited_at
  // migration is applied — the detection query returns nothing without it.
  const [staleTargetChanges, setStaleTargetChanges] = useState<RecalcChange[]>([]);
  const [staleTargetCount, setStaleTargetCount] = useState(0);
  const [recalcDismissed, setRecalcDismissed] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const [aiCoachNotes, setAiCoachNotes] = useState<string | null>(null);
  const [isLoadingAiNotes, setIsLoadingAiNotes] = useState(false);
  const [aiCoachNotesEnabled, setAiCoachNotesEnabled] = useState(false);
  
  // Store AI context for regenerating notes when injuries change
  const [aiNotesContext, setAiNotesContext] = useState<{
    exercises: WorkoutCoachNotesInput['exercises'];
    workoutType: string;
    weekInMesocycle?: number;
    mesocycleName?: string;
    totalWeeks?: number;
  } | null>(null);
  
  // Injury report modal state
  const [showInjuryModal, setShowInjuryModal] = useState(false);
  const [showReadinessModal, setShowReadinessModal] = useState(false);
  // In-workout Muscle Readiness sheet (volume + recovery). Separate from the
  // pre-workout readiness CHECK-IN above.
  const [showMuscleReadinessSheet, setShowMuscleReadinessSheet] = useState(false);
  // Per-muscle "previous session" lookup for the soreness asks (check-in rows
  // AND the inline exercise-card chips): muscles on today's menu that a
  // completed session trained in the last 5 days. Muscles idle longer have
  // nothing to be sore from and are never asked.
  const [recentMuscleSessions, setRecentMuscleSessions] = useState<
    Partial<Record<StandardMuscleGroup, RecentMuscleSession>>
  >({});
  // Joint pain events per exercise over the trailing 6 weeks (pattern notice).
  const [painEventsByExercise, setPainEventsByExercise] = useState<
    Record<string, ExercisePainEvent[]>
  >({});
  // Bumps when a pain notice is dismissed so the memoized notices recompute.
  const [painNoticeDismissTick, setPainNoticeDismissTick] = useState(0);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showPlateCalculator, setShowPlateCalculator] = useState(false);
  const [plateCalculatorWeight, setPlateCalculatorWeight] = useState<number | undefined>(undefined);
  const [temporaryInjuries, setTemporaryInjuries] = useState<{ area: string; severity: 1 | 2 | 3 }[]>([]);
  const [userGoal, setUserGoal] = useState<'bulk' | 'cut' | 'recomp' | 'maintain' | undefined>(undefined);
  const [selectedInjuryArea, setSelectedInjuryArea] = useState<string>('');
  const [selectedInjurySeverity, setSelectedInjurySeverity] = useState<1 | 2 | 3>(1);
  
  // Today's nutrition for pre-workout check-in
  const [todayNutrition, setTodayNutrition] = useState<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    targetCalories?: number;
    targetProtein?: number;
  } | null>(null);
  
  // Today's daily check-in and weight for pre-filling pre-workout check-in
  const [todayCheckInData, setTodayCheckInData] = useState<{
    sleepHours?: number | null;
    sleepQuality?: Rating | null;
    stressLevel?: Rating | null;
    focusRating?: Rating | null;
    libidoRating?: Rating | null;
    bodyweightKg?: number | null;
  } | null>(null);
  
  // State for showing swap modal for a specific exercise due to injury
  const [showSwapForInjury, setShowSwapForInjury] = useState<string | null>(null);
  const [showPageLevelSwapModal, setShowPageLevelSwapModal] = useState(false);
  const [swapTargetBlockId, setSwapTargetBlockId] = useState<string | null>(null);
  const [swapSearchQuery, setSwapSearchQuery] = useState('');
  
  // State for exercise details modal
  const [selectedExerciseForDetails, setSelectedExerciseForDetails] = useState<Exercise | null>(null);
  
  // Cancel workout modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  // Duration + completion timestamp frozen once when the user hits Finish, so
  // the summary shows a fixed value (excludes paused time) instead of a clock
  // that keeps ticking, and the SAME number is persisted with the completion.
  const [finishSnapshot, setFinishSnapshot] = useState<{
    durationSeconds: number;
    completedAt: string;
  } | null>(null);

  // Dropset chain state - tracks pending drops after a main set
  const [pendingDropset, setPendingDropset] = useState<{
    parentSetId: string;
    parentWeight: number;
    blockId: string;
    dropNumber: number; // 1-indexed: which drop we're on
    totalDrops: number;
  } | null>(null);

  // Sanity check and calibration state
  const [sanityCheckResult, setSanityCheckResult] = useState<SanityCheckResult | null>(null);
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
  const [calibrationEngine, setCalibrationEngine] = useState(() => new RPECalibrationEngine());
  // Enhanced Athlete Mode (users.enhanced_athlete_mode): raises the sandbagging
  // threshold and drives the connective-tissue cap note on exercise cards.
  const [enhancedAthleteModeActive, setEnhancedAthleteModeActive] = useState(false);
  const calibrationEngineRef = useRef<RPECalibrationEngine>(calibrationEngine);
  const [amrapSuggestion, setAmrapSuggestion] = useState<{
    exerciseName: string;
    blockId: string;
    setNumber: number;
  } | null>(null);
  // Track which block the user accepted AMRAP for (persists after banner dismissed)
  const [amrapAcceptedBlockId, setAmrapAcceptedBlockId] = useState<string | null>(null);
  // Track all calibration results for this session (for summary display)
  const [sessionCalibrations, setSessionCalibrations] = useState<Array<CalibrationResult & { exerciseId?: string; weightKg: number; setLogId?: string }>>([]);

  // Keep ref in sync with state
  useEffect(() => {
    calibrationEngineRef.current = calibrationEngine;
  }, [calibrationEngine]);

  const currentBlock = blocks[currentBlockIndex];
  const currentExercise = currentBlock?.exercise;
  const currentBlockSets = completedSets.filter(s => s.exerciseBlockId === currentBlock?.id);

  // Memoize rest timer options to prevent hook reinitialization
  const restTimerOptions = useMemo(() => ({
    defaultSeconds: restTimerDuration ?? currentBlock?.targetRestSeconds ?? 180,
    autoStart: false,
    onComplete: () => {
      // Timer completed - could optionally auto-dismiss
    },
  }), [restTimerDuration, currentBlock?.targetRestSeconds]);

  // Rest timer hook
  const restTimer = useRestTimer(restTimerOptions);

  // Workout timer hook - tracks total workout duration with pause/resume.
  // Anchored at the FIRST LOGGED SET, not session creation: an empty session
  // has no meaningful elapsed time, so until a set lands the timer sits at 0:00
  // and a finish snapshots 0 duration. (Repro from the wild: a session left
  // open on the add-exercise bug reopened later reading 1:20:00 with no sets.)
  const timerStartedAt = useMemo(
    () => firstLoggedSetTime(completedSets),
    [completedSets]
  );
  const workoutTimer = useWorkoutTimer({
    sessionId,
    startedAt: timerStartedAt,
  });

  // Clear any stale timer when a DIFFERENT session mounts. Deliberately no
  // unmount cleanup (P0-3): minimizing the workout must leave the persisted
  // countdown running so the Resume pill can show "rest m:ss" and resuming
  // restores the timer mid-count. The mount-time dismiss above still protects
  // a new workout from inheriting an old session's timer — but only when the
  // store points at a different session; a same-session remount (minimize →
  // resume) keeps the countdown.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('workout_rest_timer_session') : null;
    if (stored !== sessionId) {
      restTimer.dismiss();
      localStorage.setItem('workout_rest_timer_session', sessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // Only depend on sessionId, not restTimer to avoid loops

  // If the hook restored a running countdown (minimize -> resume, or app
  // relaunch), surface the sticky timer bar again (P0-3/P0-5).
  useEffect(() => {
    if (restTimer.isRunning) setShowRestTimer(true);
  }, [restTimer.isRunning]);

  // P1-3 recalc detection (detection A). Runs once per session load when the
  // workout hasn't been logged into yet, on planned (target-bearing) blocks.
  // Fully defensive: if set_logs.edited_at doesn't exist (migration not
  // applied), the query errors, we swallow it, and the banner stays hidden.
  useEffect(() => {
    if (phase !== 'workout' || blocks.length === 0 || completedSets.length > 0) return;
    const targetBlocks = blocks.filter((b) => b.targetWeightKg > 0 && b.exercise);
    if (targetBlocks.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const exerciseIds = Array.from(new Set(targetBlocks.map((b) => b.exerciseId)));
        // Latest edited_at per exercise across the user's completed-session sets.
        const { data, error } = await supabase
          .from('set_logs')
          .select('edited_at, exercise_blocks!inner(exercise_id, workout_sessions!inner(user_id, state))')
          .not('edited_at', 'is', null)
          .in('exercise_blocks.exercise_id', exerciseIds)
          .eq('exercise_blocks.workout_sessions.state', 'completed');
        if (error || !data || cancelled) return; // column missing / no edits -> dormant
        const latestByExercise: Record<string, string | null> = {};
        for (const row of data as any[]) {
          const exId = row.exercise_blocks?.exercise_id;
          const ea = row.edited_at as string | null;
          if (!exId || !ea) continue;
          if (!latestByExercise[exId] || ea > (latestByExercise[exId] as string)) latestByExercise[exId] = ea;
        }
        const plannedInfos: PlannedTargetBlock[] = targetBlocks.map((b) => ({
          id: b.id,
          exerciseId: b.exerciseId,
          exerciseName: b.exercise.name,
          // Fail-safe: an unknown creation time counts as "now" so the block
          // can never be flagged stale (an epoch-0 fallback made EVERY block
          // look older than any edit, permanently re-triggering the banner).
          createdAt: b.createdAt ?? new Date().toISOString(),
          targetWeightKg: b.targetWeightKg,
        }));
        const stale = findStaleTargetBlocks(plannedInfos, latestByExercise);
        if (stale.length === 0 || cancelled) return;
        const changes = userProfile
          ? computeRecalcChanges(stale, (blk) => estimateBlockTargetKg(blk))
          : [];
        if (cancelled) return;
        setStaleTargetCount(stale.length);
        setStaleTargetChanges(changes);
      } catch {
        // dormant on any failure
      }
    })();
    return () => { cancelled = true; };
    // exerciseHistories included so changes recompute with the corrected E1RM
    // once the per-exercise history finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, blocks, userProfile, exerciseHistories]);

  // Re-run the weight estimate for a stale block against the CORRECTED history.
  // The point of the recalc is to use the edited data, so the exercise's E1RM
  // (recomputed from the corrected sets at load time) is passed as knownE1RM —
  // without it the estimate would be a weak profile-only guess that ignores the
  // very edit that triggered the banner. Uses the calibration path when lifts
  // are calibrated, matching the live suggestion logic.
  const estimateBlockTargetKg = (blk: PlannedTargetBlock): number => {
    const block = blocks.find((b) => b.id === blk.id);
    if (!block || !userProfile?.weightKg || !userProfile?.heightCm) return 0;
    const knownE1RM = exerciseHistories[block.exerciseId]?.estimatedE1RM;
    const repRange = { min: block.targetRepRange[0], max: block.targetRepRange[1] };
    const estimateOpts = {
      transferCandidates,
      targetMeta: {
        primaryMuscle: block.exercise.primaryMuscle,
        movementPattern: block.exercise.movementPattern,
        equipmentRequired: block.exercise.equipmentRequired,
      },
    };
    const rec =
      userProfile.calibratedLifts && userProfile.calibratedLifts.length > 0
        ? quickWeightEstimateWithCalibration(
            block.exercise.name, repRange, block.targetRir,
            userProfile.weightKg, userProfile.heightCm, userProfile.bodyFatPercent,
            userProfile.experience, userProfile.calibratedLifts, userProfile.regionalData,
            preferences.units, knownE1RM, estimateOpts
          )
        : quickWeightEstimate(
            block.exercise.name, repRange, block.targetRir,
            userProfile.weightKg, userProfile.heightCm, userProfile.bodyFatPercent,
            userProfile.experience, userProfile.regionalData, preferences.units, knownE1RM,
            estimateOpts
          );
    if (!rec || rec.confidence === 'find_working_weight' || !rec.recommendedWeight) return 0;
    return inputWeightToKg(rec.recommendedWeight, preferences.units);
  };

  // Apply the recalc (mitigation a: all targets are engine output -> all stale
  // blocks eligible; the banner's confirm dialog already listed the changes).
  const applyRecalc = async () => {
    if (staleTargetChanges.length === 0) return;
    setIsRecalculating(true);
    try {
      const supabase = createUntypedClient();
      for (const change of staleTargetChanges) {
        await supabase.from('exercise_blocks').update({ target_weight_kg: change.newKg }).eq('id', change.blockId);
      }
      setBlocks((prev) =>
        prev.map((b) => {
          const c = staleTargetChanges.find((x) => x.blockId === b.id);
          return c ? { ...b, targetWeightKg: c.newKg } : b;
        })
      );
      setStaleTargetCount(0);
      setStaleTargetChanges([]);
      showSuccess(`Updated ${staleTargetChanges.length} target${staleTargetChanges.length !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Recalc failed:', err);
      showError('Could not update targets — please try again');
    } finally {
      setIsRecalculating(false);
    }
  };

  // Track workout progress for navigation protection (using ref to avoid re-running effect)
  const hasWorkoutProgressRef = useRef(false);
  useEffect(() => {
    hasWorkoutProgressRef.current = phase === 'workout' && completedSets.length > 0;
  }, [phase, completedSets.length]);

  // Resume session when entering workout phase (in case it was paused)
  useEffect(() => {
    if (phase === 'workout') {
      resumeSession();
    }
  }, [phase, resumeSession]);

  // Handle navigation away from active workout - pause session so it can be resumed
  useEffect(() => {
    // Only set up protection when in workout phase
    if (phase !== 'workout') return;

    // Handle browser close/refresh - shows native browser confirmation dialog
    // This warns users that they might lose timing data (workout state is persisted)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasWorkoutProgressRef.current) {
        // Pause the session before leaving
        pauseSession();
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    // Handle visibility change (tab switch, app switch on mobile)
    // Pause the session when the page is hidden
    const handleVisibilityChange = () => {
      if (document.hidden && hasWorkoutProgressRef.current) {
        pauseSession();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Pause when navigating away via React router (component unmount)
      if (hasWorkoutProgressRef.current) {
        pauseSession();
      }
    };
  }, [phase, pauseSession]);

  // Load workout data
  useEffect(() => {
    async function loadWorkout() {
      try {
        const supabase = createUntypedClient();

        // Fetch session and exercise blocks in parallel (both only need sessionId from URL)
        const [sessionResult, blocksResult] = await Promise.all([
          supabase
            .from('workout_sessions')
            .select('*')
            .eq('id', sessionId)
            .single(),
          supabase
            .from('exercise_blocks')
            .select(`
              *,
              exercises (*)
            `)
            .eq('workout_session_id', sessionId)
            .order('order')
        ]);

        const { data: sessionData, error: sessionError } = sessionResult;
        const { data: blocksData, error: blocksError } = blocksResult;

        if (sessionError || !sessionData) {
          throw new Error('Workout session not found');
        }
        if (blocksError) throw blocksError;

        // Transform data (row → domain mapping lives in ./_lib/sessionMapping)
        const transformedSession: WorkoutSession = mapWorkoutSessionRow(sessionData);

        // The location this session was started at — stamped on new sets and
        // used to scope local-scope exercise history for calibration. `null`
        // for legacy sessions / databases without the location column.
        const loadedLocationId = (sessionData.location_id as string | null) ?? null;
        setSessionLocationId(loadedLocationId);

        const transformedBlocks: ExerciseBlockWithExercise[] = (blocksData || [])
          .filter((block: LoadedBlockRow) => block.exercises) // Filter out blocks without exercises
          .map(mapLoadedBlockRow);

        // An already-archived session (deep link / back-button revisit after
        // auto-discard) behaves like a deleted one: nothing to resume.
        if (transformedSession.state === 'auto_discarded') {
          endWorkoutSession();
          router.replace('/dashboard/log');
          return;
        }

        // Stale-session auto-discard (P0-1): an abandoned empty ad-hoc shell
        // (0 blocks, 0 sets, in_progress, >4h old) is discarded instead of
        // resuming into a phantom "Continue workout". Predicate is the pure
        // isStaleEmptyAdhocSession (unit-tested); 0 blocks already implies 0
        // sets, but both are passed explicitly to make the guard unmistakable.
        // Archived, not deleted (soft delete) once the session_auto_discard
        // migration is applied; hard-delete fallback until then.
        if (
          isStaleEmptyAdhocSession(
            {
              state: transformedSession.state,
              mesocycleId: transformedSession.mesocycleId,
              startedAt: transformedSession.startedAt,
            },
            (blocksData || []).length,
            0 // no blocks -> no sets; querying sets separately would be redundant
          )
        ) {
          await discardStaleSession(supabase, sessionId);
          endWorkoutSession();
          router.replace('/dashboard/log');
          return;
        }

        setSession(transformedSession);
        setBlocks(transformedBlocks);

        // Restore per-block skip state (exercise_blocks.skipped_at)
        const skippedIds = new Set<string>(
          ((blocksData || []) as Array<{ id: string; skipped_at?: string | null }>)
            .filter((block) => Boolean(block.skipped_at))
            .map((block) => block.id)
        );
        setSkippedBlockIds(skippedIds);


        // Fetch existing sets for this workout (important for viewing completed workouts or resuming)
        const blockIds = transformedBlocks.map((b: ExerciseBlockWithExercise) => b.id);
        if (blockIds.length > 0) {
          const { data: existingSets } = await supabase
            .from('set_logs')
            .select('*')
            .in('exercise_block_id', blockIds)
            .order('set_number');
          
          if (existingSets && existingSets.length > 0) {
            const transformedSets: SetLog[] = existingSets.map(mapSetLogRow);
            setCompletedSets(transformedSets);
            
            // Set current set number based on existing sets for the first incomplete block
            const firstIncompleteBlock = transformedBlocks.find((block: ExerciseBlockWithExercise) => {
              if (skippedIds.has(block.id)) return false;
              const blockSets = transformedSets.filter(s => s.exerciseBlockId === block.id && !s.isWarmup && s.setType !== 'warmup');
              return blockSets.length < block.targetSets;
            });
            
            if (firstIncompleteBlock) {
              const blockIdx = transformedBlocks.findIndex((b: ExerciseBlockWithExercise) => b.id === firstIncompleteBlock.id);
              const existingBlockSets = transformedSets.filter(s => s.exerciseBlockId === firstIncompleteBlock.id && !s.isWarmup && s.setType !== 'warmup');
              setCurrentBlockIndex(blockIdx);
              setCurrentSetNumber(existingBlockSets.length + 1);
            }
          } else if (skippedIds.size > 0) {
            // No sets yet: make sure the starting exercise isn't a skipped block
            const firstActiveIdx = transformedBlocks.findIndex(
              (b: ExerciseBlockWithExercise) => !skippedIds.has(b.id)
            );
            if (firstActiveIdx > 0) {
              setCurrentBlockIndex(firstActiveIdx);
            }
          }
        }
        
        // Fetch user profile, DEXA, calibrated lifts, mesocycle, and completed count in parallel
        // Also fetch exercise history for all exercises (moved here from later in the function)
        const exerciseIds = transformedBlocks.map((b: ExerciseBlockWithExercise) => b.exerciseId);

        const [userResult, dexaResult, calibratedResult, mesocycleResult, completedCountResult, historyResult, fetchedTransferCandidates] = await Promise.all([
          // User profile for weight estimation (including preferences for AI coach notes setting)
          supabase
            .from('users')
            .select('weight_kg, height_cm, experience, training_age, goal, preferences')
            .eq('id', sessionData.user_id)
            .single(),
          // Latest DEXA scan for body fat and regional data
          supabase
            .from('dexa_scans')
            .select('body_fat_percent, regional_data, lean_mass_kg')
            .eq('user_id', sessionData.user_id)
            .order('scan_date', { ascending: false })
            .limit(1)
            .single(),
          // Calibrated lifts for weight estimation
          supabase
            .from('calibrated_lifts')
            .select('lift_name, estimated_1rm, tested_at')
            .eq('user_id', sessionData.user_id)
            .order('tested_at', { ascending: false }),
          // Mesocycle info
          supabase
            .from('mesocycles')
            .select('name, start_date, total_weeks')
            .eq('user_id', sessionData.user_id)
            .eq('is_active', true)
            .single(),
          // Check if this is the user's first workout for beginner hints
          supabase
            .from('workout_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', sessionData.user_id)
            .eq('state', 'completed'),
          // Exercise history for all exercises: one batched query, but the
          // recency window is PER EXERCISE (embedded blocks execute as a
          // lateral subquery per exercise row, so order+limit apply to each
          // exercise independently). The old flat query capped rows GLOBALLY
          // across all of today's exercises, so an infrequently-trained
          // exercise could get zero rows and be misread as a cold start
          // (+15% steps, easy-RIR auto-bumps) despite years of history —
          // audit failure mode #2 (docs/WEIGHT_REP_ENGINE_AUDIT.md).
          exerciseIds.length > 0
            ? supabase
                .from('exercises')
                .select(`
                  id,
                  exercise_blocks (
                    id,
                    exercise_id,
                    workout_sessions!inner (
                      id,
                      completed_at,
                      state,
                      user_id,
                      is_deload
                    ),
                    set_logs (
                      weight_kg,
                      reps,
                      rpe,
                      is_warmup,
                      set_number,
                      set_type,
                      logged_at,
                      location_id
                    )
                  )
                `)
                .in('id', exerciseIds)
                .eq('exercise_blocks.workout_sessions.user_id', sessionData.user_id)
                .eq('exercise_blocks.workout_sessions.state', 'completed')
                .order('workout_sessions(completed_at)', {
                  referencedTable: 'exercise_blocks',
                  ascending: false,
                })
                .limit(HISTORY_SESSIONS_PER_EXERCISE, { referencedTable: 'exercise_blocks' })
            : Promise.resolve({ data: null }),
          // Cross-exercise strength summary for cold-start transfer estimation
          // (never-trained exercises seed from a related exercise's e1RM).
          fetchTransferCandidates(sessionData.user_id),
        ]);

        const userData = userResult.data;
        const dexaData = dexaResult.data;
        const calibratedLifts = calibratedResult.data;
        const mesocycleData = mesocycleResult.data;
        const completedWorkoutsCount = completedCountResult.count ?? 0;
        const allHistoryBlocks = flattenExerciseHistoryRows(
          historyResult.data as ExerciseHistoryQueryRow[] | null
        );
        setTransferCandidates(fetchedTransferCandidates);
        
        const profile: UserProfileForWeights | undefined = userData ? {
          weightKg: userData.weight_kg || 70,
          heightCm: userData.height_cm || 175,
          bodyFatPercent: dexaData?.body_fat_percent || 20,
          experience: (userData.experience as 'novice' | 'intermediate' | 'advanced') || 'intermediate',
          regionalData: dexaData?.regional_data as DexaRegionalData | undefined,
          calibratedLifts: calibratedLifts as CalibratedLift[] | undefined,
        } : undefined;
        
        if (profile) {
          setUserProfile(profile);
        }
        
        // Store user's goal for check-in component
        if (userData?.goal) {
          setUserGoal(userData.goal as 'bulk' | 'cut' | 'recomp' | 'maintain');
        }
        
        // Build user context for personalized coaching
        const userContext: UserContext = {
          goal: userData?.goal as UserContext['goal'] || undefined,
        };
        
        // Analyze regional data for lagging areas
        if (dexaData?.regional_data && dexaData?.lean_mass_kg && userData?.height_cm) {
          try {
            const { analyzeRegionalComposition } = await import('@/services/regionalAnalysis');
            const regionalAnalysis = analyzeRegionalComposition(
              dexaData.regional_data as DexaRegionalData,
              dexaData.lean_mass_kg
            );
            userContext.laggingAreas = regionalAnalysis.laggingAreas;
          } catch (e) {
            // Regional analysis optional
          }
        }
        
        // Add mesocycle context
        if (mesocycleData) {
          userContext.mesocycleName = mesocycleData.name;
          const startDate = new Date(mesocycleData.start_date);
          const now = new Date();
          const weeksSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          userContext.weekInMesocycle = Math.min(weeksSinceStart, mesocycleData.total_weeks);
        }

        setIsFirstWorkout(completedWorkoutsCount === 0);

        // Coach message will be generated after exercise histories are loaded
        // to provide accurate weight suggestions based on user's training history

        // Check for existing injuries from session's pre_workout_check_in
        const existingCheckIn = sessionData.pre_workout_check_in as { temporaryInjuries?: Array<{ area: string; severity: 1 | 2 | 3 }> } | null;
        const existingInjuries = existingCheckIn?.temporaryInjuries || [];
        if (existingInjuries.length > 0) {
          setTemporaryInjuries(existingInjuries);
        }
        
        // Check if AI coach notes are enabled in user preferences
        const userPrefs = (userData?.preferences as Record<string, unknown>) || {};
        const aiCoachNotesEnabledValue = (userPrefs.showAiCoachNotes as boolean) ?? false;
        setAiCoachNotesEnabled(aiCoachNotesEnabledValue);
        
        // Generate AI-powered coach notes in the background (only if enabled)
        if (aiCoachNotesEnabledValue) {
          (async () => {
            setIsLoadingAiNotes(true);
            try {
              // Determine workout type from exercises
              const muscles = Array.from(new Set(transformedBlocks.map((b: ExerciseBlockWithExercise) => b.exercise.primaryMuscle)));
              let inferredWorkoutType = '';
              if (muscles.length >= 5) inferredWorkoutType = 'Full Body';
              else if (muscles.includes('chest') && muscles.includes('back')) inferredWorkoutType = 'Upper Body';
              else if (muscles.includes('quads') && muscles.includes('hamstrings')) inferredWorkoutType = 'Lower Body';
              else if (muscles.includes('chest') && muscles.includes('shoulders') && muscles.includes('triceps')) inferredWorkoutType = 'Push';
              else if (muscles.includes('back') && muscles.includes('biceps')) inferredWorkoutType = 'Pull';
              else inferredWorkoutType = muscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' & ');
            
            // Build exercises data for AI context
            const exercisesData = transformedBlocks.map((b: ExerciseBlockWithExercise) => ({
              name: b.exercise.name,
              primaryMuscle: b.exercise.primaryMuscle,
              mechanic: b.exercise.mechanic,
              sets: b.targetSets,
              targetReps: `${b.targetRepRange[0]}-${b.targetRepRange[1]}`,
            }));
            
            // Store context for potential regeneration later
            setAiNotesContext({
              exercises: exercisesData,
              workoutType: inferredWorkoutType,
              weekInMesocycle: userContext.weekInMesocycle,
              mesocycleName: userContext.mesocycleName,
              totalWeeks: mesocycleData?.total_weeks,
            });
            
            const aiInput: WorkoutCoachNotesInput = {
              exercises: exercisesData,
              workoutType: inferredWorkoutType,
              weekInMesocycle: userContext.weekInMesocycle,
              mesocycleName: userContext.mesocycleName,
              totalWeeks: mesocycleData?.total_weeks,
              // Include existing injuries if any (from previous session state)
              injuries: existingInjuries.length > 0 ? existingInjuries : undefined,
            };
            const result = await generateWorkoutCoachNotes(aiInput);
            setAiCoachNotes(result.notes);
          } catch (error) {
            console.error('[AI Coach Notes] Failed to generate:', error);
          } finally {
            setIsLoadingAiNotes(false);
          }
          })();
        }
        
        // Process exercise history (already fetched in parallel above)
        if (allHistoryBlocks && allHistoryBlocks.length > 0) {
          // Resolve each session exercise's progression scope (equipment-class
          // derived, honoring any per-exercise override) so local-scope
          // exercises read location-scoped history for calibration.
          const scopeByExercise = new Map<string, ProgressionScope>();
          for (const row of (blocksData || []) as LoadedBlockRow[]) {
            const ex = row.exercises as
              | {
                  id: string;
                  name?: string | null;
                  equipment_required?: string[] | null;
                  is_bodyweight?: boolean | null;
                  progression_scope_override?: ProgressionScope | null;
                }
              | null;
            if (!ex || scopeByExercise.has(ex.id)) continue;
            scopeByExercise.set(
              ex.id,
              deriveProgressionScope({
                equipmentRequired: ex.equipment_required,
                isBodyweight: ex.is_bodyweight,
                name: ex.name,
                scopeOverride: ex.progression_scope_override ?? null,
              })
            );
          }

          // Group by exercise, cap at 10 blocks each, compute E1RM/PR (./_lib/suggestions).
          // With a known session location, local-scope exercises are narrowed
          // to that location's calibration track (softened fallback to other
          // gyms on a first session there).
          const histories: Record<string, ExerciseHistoryData> = buildExerciseHistories(
            allHistoryBlocks,
            loadedLocationId
              ? {
                  currentLocationId: loadedLocationId,
                  scopeForExercise: (id) => scopeByExercise.get(id) ?? 'global',
                }
              : undefined,
            // Modality per exercise: duration exercises get no e1RM anchor and
            // a heaviest-load/longest-hold PR instead of an Epley one.
            Object.fromEntries(
              transformedBlocks.map((b) => [b.exerciseId, b.exercise.exerciseType])
            )
          );

          setExerciseHistories(histories);

          // Same rows, mapped to per-session snapshots for plateau detection
          setPerformanceSnapshots(buildPerformanceSnapshots(allHistoryBlocks as SnapshotSourceBlock[]));

          // Generate coach message with exercise history for accurate weight suggestions
          setCoachMessage(generateCoachMessage(transformedBlocks, profile, userContext, preferences.units, histories, fetchedTransferCandidates));
        } else {
          // No exercise history available, generate coach message without it
          setCoachMessage(generateCoachMessage(transformedBlocks, profile, userContext, preferences.units, undefined, fetchedTransferCandidates));
        }

        // Set phase based on workout state
        if (sessionData.state === 'completed') {
          setPhase('summary');  // Show summary for completed workouts (read-only)

          // Load AMRAP calibrations for this session
          const { data: calibrationsData } = await supabase
            .from('amrap_calibrations')
            .select('*')
            .eq('workout_session_id', sessionId)
            .order('calibrated_at');

          if (calibrationsData && calibrationsData.length > 0) {
            const loadedCalibrations = calibrationsData.map((cal: any) => ({
              exerciseName: cal.exercise_name,
              predictedMaxReps: cal.predicted_max_reps,
              actualMaxReps: cal.actual_max_reps,
              bias: cal.bias,
              biasInterpretation: cal.bias_interpretation,
              confidenceLevel: cal.confidence_level as 'low' | 'medium' | 'high',
              lastCalibrated: new Date(cal.calibrated_at),
              dataPoints: cal.data_points,
              rawPredictedMaxReps: cal.raw_predicted_max_reps ?? undefined,
              method: (cal.method ?? 'naive_v1') as 'naive_v1' | 'fatigue_adjusted_v2',
              exerciseId: cal.exercise_id,
              weightKg: cal.weight_kg,
              setLogId: cal.set_log_id,
            }));
            setSessionCalibrations(loadedCalibrations);
          }
        } else if (sessionData.state === 'in_progress') {
          setPhase('workout');
        } else {
          // Start the workout immediately. The pre-workout check-in is now
          // optional (available from the "Readiness" button in the workout
          // header), not a gate on getting to your sets.
          const startedAt = new Date().toISOString();
          await supabase
            .from('workout_sessions')
            .update({
              state: 'in_progress',
              started_at: startedAt,
            })
            .eq('id', sessionId);
          setSession(prev => prev ? { ...prev, startedAt, state: 'in_progress' } : prev);
          setPhase('workout');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workout');
        setPhase('error');
      }
    }

    loadWorkout();
  }, [sessionId]);

  // Sync workout state to store for resume functionality
  useEffect(() => {
    if (session && blocks.length > 0 && phase !== 'loading' && phase !== 'error' && phase !== 'summary') {
      // Extract exercises from blocks
      const exercisesList = blocks
        .map(block => block.exercise)
        .filter((ex): ex is Exercise => ex !== undefined);

      // Extract base blocks (without exercise property) for the store.
      // Skipped blocks are excluded so the resume pill's label and set
      // totals match this page's own counts (finish dialog, progress),
      // which are all computed over activeBlocks.
      const baseBlocks: ExerciseBlock[] = blocks
        .filter((b) => !skippedBlockIds.has(b.id))
        .map(({ exercise: _exercise, ...rest }) => rest);

      startWorkoutSession(session, baseBlocks, exercisesList);
    }
  }, [session, blocks, phase, skippedBlockIds, startWorkoutSession]);

  // Sync current block index to store
  useEffect(() => {
    setStoreBlockIndex(currentBlockIndex);
  }, [currentBlockIndex, setStoreBlockIndex]);

  // Fetch available exercises on mount for swap functionality
  useEffect(() => {
    async function loadAvailableExercises() {
      const supabase = createUntypedClient();
      const { data } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, movement_pattern, mechanic, equipment_required, equipment_class, default_rep_range, default_rir, is_bodyweight, hypertrophy_tier')
        .is('deleted_at', null) // hide merge-soft-deleted duplicates
        .order('name');
      if (data) {
        setAvailableExercises(data);
      }
    }
    loadAvailableExercises();
  }, []);

  // Load gym locations for the location filter
  useEffect(() => {
    async function loadGymLocations() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const { data: locations, error } = await supabase
          .from('gym_locations')
          .select('id, name, is_default')
          .eq('user_id', user.id);

        if (!error && locations && locations.length > 0) {
          setGymLocations(locations);
        }
      } catch (err) {
        console.warn('Error loading gym locations:', err);
      }
    }
    loadGymLocations();
  }, []);

  // Load the equipment blocklist and per-exercise availability overrides
  // when the location filter changes.
  useEffect(() => {
    async function loadLocationEquipment() {
      if (!selectedLocationFilter) {
        setLocationUnavailableEquipmentIds([]);
        setUnavailableExerciseIds(new Set());
        return;
      }

      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      try {
        // Load user-specified unavailable exercises for this location
        const { data: unavailableExercises } = await supabase
          .from('exercise_location_availability')
          .select('exercise_id')
          .eq('user_id', user.id)
          .eq('location_id', selectedLocationFilter)
          .eq('is_available', false);

        if (unavailableExercises) {
          setUnavailableExerciseIds(new Set(unavailableExercises.map((e: { exercise_id: string }) => e.exercise_id)));
        } else {
          setUnavailableExerciseIds(new Set());
        }

        // Load the equipment the location LACKS — the blocklist the shared
        // fail-closed filter consumes.
        const { data: blockedEq, error: equipmentError } = await supabase
          .from('user_equipment')
          .select('equipment_id')
          .eq('user_id', user.id)
          .eq('location_id', selectedLocationFilter)
          .eq('is_available', false);

        if (equipmentError) {
          console.error(
            '[workout] failed to load location equipment blocklist; exercises will NOT be equipment-constrained:',
            equipmentError
          );
          setLocationUnavailableEquipmentIds([]);
        } else {
          setLocationUnavailableEquipmentIds(
            (blockedEq ?? []).map((eq: { equipment_id: string }) => eq.equipment_id)
          );
        }
      } catch (err) {
        console.error('Error loading location equipment:', err);
        setLocationUnavailableEquipmentIds([]);
      }
    }
    loadLocationEquipment();
  }, [selectedLocationFilter]);

  // Load historical set logs for RPE calibration
  useEffect(() => {
    async function loadCalibrationHistory() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Enhanced athletes need a higher sandbagging threshold (recovered
        // sessions legitimately beat fatigued-week predictions by more).
        const { data: userRow } = await supabase
          .from('users')
          .select('enhanced_athlete_mode')
          .eq('id', user.id)
          .single();
        const enhancedAthleteMode = userRow?.enhanced_athlete_mode === true;
        setEnhancedAthleteModeActive(enhancedAthleteMode);

        // Load set logs from the last 4 weeks for calibration
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

        const { data: setLogsData, error } = await supabase
          .from('set_logs')
          .select(`
            id,
            exercise_block_id,
            set_number,
            weight_kg,
            reps,
            rpe,
            set_type,
            logged_at,
            exercise_blocks!inner (
              exercise_id,
              target_rep_range,
              target_rir,
              exercises!inner (
                id,
                name
              ),
              workout_sessions!inner (
                user_id,
                completed_at
              )
            )
          `)
          .eq('exercise_blocks.workout_sessions.user_id', user.id)
          .eq('exercise_blocks.workout_sessions.state', 'completed')
          .gte('logged_at', fourWeeksAgo.toISOString())
          .eq('set_type', 'normal')
          .order('logged_at', { ascending: true });

        if (error) {
          console.error('Failed to load calibration history:', error);
          return;
        }

        if (!setLogsData || setLogsData.length === 0) {
          return; // No historical data, engine stays empty
        }

        // Convert to CalibrationSetLog format
        const calibrationLogs: CalibrationSetLog[] = [];
        const calibrationResults: CalibrationResult[] = [];

        for (const log of setLogsData) {
          const block = log.exercise_blocks as any;
          const exercise = block.exercises as any;
          
          if (!exercise || !block) continue;

          const reportedRIR = Math.max(0, Math.round(10 - log.rpe));
          const wasAMRAP = log.rpe >= 9.5 && getFailureSafetyTier(exercise.name) === 'push_freely';

          calibrationLogs.push({
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            weight: log.weight_kg,
            prescribedReps: {
              min: block.target_rep_range?.[0] || 0,
              max: block.target_rep_range?.[1] || null,
            },
            actualReps: log.reps,
            reportedRIR,
            wasAMRAP,
            timestamp: new Date(log.logged_at),
          });
        }

        // Process sets in chronological order to build up calibration results
        // The engine needs to process sets sequentially so AMRAPs can compare to previous sets
        const engine = new RPECalibrationEngine([], [], { enhancedAthleteMode });
        
        // Sort logs by timestamp to process chronologically
        const sortedLogs = [...calibrationLogs].sort((a, b) => 
          a.timestamp.getTime() - b.timestamp.getTime()
        );
        
        // Process each log sequentially
        for (const log of sortedLogs) {
          if (log.wasAMRAP) {
            const result = engine.addSetLog(log);
            // AMRAP sets automatically create calibration results
          } else {
            // Non-AMRAP sets are logged for comparison data
            engine.addSetLog(log);
          }
        }
        
        setCalibrationEngine(engine);
      } catch (err) {
        console.error('Error loading calibration history:', err);
      }
    }

    // Only load if we have a user session
    async function initCalibration() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await loadCalibrationHistory();
      }
    }
    initCalibration();
  }, [sessionId]);

  // Check for AMRAP suggestions when current block or set number changes
  useEffect(() => {
    if (!currentBlock || !currentExercise) {
      setAmrapSuggestion(null);
      return;
    }

    const safetyTier = getFailureSafetyTier(currentExercise.name);
    const isSafeExercise = safetyTier === 'push_freely';
    
    // Count completed sets for this block
    const completedSetsForBlock = completedSets.filter(
      s => s.exerciseBlockId === currentBlock.id && s.setType === 'normal'
    ).length;
    
    // Suggest AMRAP if:
    // 1. We're about to do the last set (completed sets + 1 = target sets)
    // 2. Exercise is safe to push to failure
    // 3. We haven't already completed all sets
    const isAboutToDoLastSet = completedSetsForBlock + 1 === currentBlock.targetSets;
    const hasNotCompletedAllSets = completedSetsForBlock < currentBlock.targetSets;

    if (isAboutToDoLastSet && isSafeExercise && hasNotCompletedAllSets) {
      setAmrapSuggestion({
        exerciseName: currentExercise.name,
        blockId: currentBlock.id,
        setNumber: completedSetsForBlock + 1,
      });
    } else {
      setAmrapSuggestion(null);
    }
  }, [currentBlock, currentExercise, completedSets]);

  // Fetch frequently used exercises for sorting
  useEffect(() => {
    async function loadFrequentExercises() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get exercise usage counts from the last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data } = await supabase
        .from('exercise_blocks')
        .select(`
          exercise_id,
          workout_sessions!inner(user_id, started_at)
        `)
        .eq('workout_sessions.user_id', user.id)
        .gte('workout_sessions.started_at', ninetyDaysAgo.toISOString());

      if (data) {
        // Count occurrences of each exercise and track most recent date
        const counts = new Map<string, number>();
        const lastDone = new Map<string, Date>();
        data.forEach((block: { exercise_id: string; workout_sessions: { started_at: string } }) => {
          const id = block.exercise_id;
          counts.set(id, (counts.get(id) || 0) + 1);

          const sessionDate = new Date(block.workout_sessions.started_at);
          const currentLastDone = lastDone.get(id);
          if (!currentLastDone || sessionDate > currentLastDone) {
            lastDone.set(id, sessionDate);
          }
        });
        setFrequentExerciseIds(counts);
        setLastDoneExercises(lastDone);
      }
    }
    loadFrequentExercises();
  }, []);

  // Fetch today's nutrition data, daily check-in, and weight for check-in
  useEffect(() => {
    async function loadTodayData() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = getLocalDateString();

        // Fetch today's food log entries (logged_at is a DATE column, not timestamp)
        const { data: foodEntries } = await supabase
          .from('food_log')
          .select('calories, protein, carbs, fat')
          .eq('user_id', user.id)
          .eq('logged_at', today);

        // Fetch nutrition targets
        const { data: targets } = await supabase
          .from('nutrition_targets')
          .select('calories, protein')
          .eq('user_id', user.id)
          .single();

        if (foodEntries) {
          const totals = foodEntries.reduce(
            (acc: { calories: number; protein: number; carbs: number; fat: number }, entry: { calories?: number; protein?: number; carbs?: number; fat?: number }) => ({
              calories: acc.calories + (entry.calories || 0),
              protein: acc.protein + (entry.protein || 0),
              carbs: acc.carbs + (entry.carbs || 0),
              fat: acc.fat + (entry.fat || 0),
            }),
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
          );

          setTodayNutrition({
            ...totals,
            targetCalories: targets?.calories,
            targetProtein: targets?.protein,
          });
        }
        
        // Fetch today's daily check-in
        const { data: dailyCheckIn } = await supabase
          .from('daily_check_ins')
          .select('sleep_hours, sleep_quality, stress_level, focus_rating, libido_rating')
          .eq('user_id', user.id)
          .eq('date', today)
          .maybeSingle();
        
        // Fetch today's weight log
        const { data: weightEntry } = await supabase
          .from('weight_log')
          .select('weight, unit')
          .eq('user_id', user.id)
          .eq('logged_at', today)
          .maybeSingle();
        
        // Convert weight to kg if needed
        let bodyweightKg: number | null = null;
        if (weightEntry?.weight) {
          if (weightEntry.unit === 'lb') {
            bodyweightKg = weightEntry.weight * 0.453592;
          } else {
            bodyweightKg = weightEntry.weight;
          }
        }
        
        // Set check-in data for pre-filling
        if (dailyCheckIn || weightEntry) {
          setTodayCheckInData({
            sleepHours: dailyCheckIn?.sleep_hours ?? null,
            sleepQuality: dailyCheckIn?.sleep_quality as Rating | null ?? null,
            stressLevel: dailyCheckIn?.stress_level as Rating | null ?? null,
            focusRating: dailyCheckIn?.focus_rating as Rating | null ?? null,
            libidoRating: dailyCheckIn?.libido_rating as Rating | null ?? null,
            bodyweightKg,
          });
        }
      } catch (err) {
        console.error('Failed to load today\'s data:', err);
      }
    }

    loadTodayData();
  }, []);

  // Function to regenerate AI coach notes with injury context
  const regenerateAiCoachNotes = async (injuries: { area: string; severity: 1 | 2 | 3 }[]) => {
    if (!aiNotesContext) {
      return;
    }

    setIsLoadingAiNotes(true);
    try {
      const aiInput: WorkoutCoachNotesInput = {
        ...aiNotesContext,
        injuries: injuries.length > 0 ? injuries : undefined,
      };
      const result = await generateWorkoutCoachNotes(aiInput);
      setAiCoachNotes(result.notes);
    } catch (error) {
      console.error('[AI Coach Notes] Failed to regenerate:', error);
    } finally {
      setIsLoadingAiNotes(false);
    }
  };

  // Look up which of today's muscles were trained in a completed session in
  // the last 5 days — those get soreness asks (check-in rows and the inline
  // exercise-card chips), written back onto the PREVIOUS session's feedback
  // row. Loads for the check-in AND for the live workout phase.
  useEffect(() => {
    if ((!showReadinessModal && phase !== 'workout') || !session || blocks.length === 0) return;

    const todayMuscles = Array.from(
      new Set(
        blocks
          .filter((b) => !skippedBlockIds.has(b.id))
          .map((b) => resolvePrimaryMuscle(b.exercise?.primaryMuscle))
          .filter((m): m is StandardMuscleGroup => m !== null)
      )
    );
    if (todayMuscles.length === 0) return;

    let cancelled = false;
    const supabase = createUntypedClient();
    fetchRecentMuscleSessions(supabase, {
      userId: session.userId,
      muscles: todayMuscles,
      excludeSessionId: session.id,
      withinDays: 5,
    }).then(({ byMuscle, error: fetchError }) => {
      if (fetchError) {
        console.error('Failed to load recent muscle sessions:', fetchError);
      }
      if (!cancelled) setRecentMuscleSessions(byMuscle);
    });

    return () => {
      cancelled = true;
    };
  }, [showReadinessModal, phase, session, blocks, skippedBlockIds]);

  // Persist check-in soreness ratings onto each muscle's PREVIOUS session row.
  const saveSorenessFeedback = async (sorenessRatings: MuscleSorenessRatings) => {
    if (!session) return;
    const writes = (
      Object.entries(sorenessRatings) as Array<
        [StandardMuscleGroup, MuscleSorenessRatings[StandardMuscleGroup]]
      >
    ).flatMap(([muscle, rating]) => {
      const previous = recentMuscleSessions[muscle];
      return previous && rating !== undefined
        ? [{ sessionId: previous.sessionId, muscleGroup: muscle, sorenessBefore: rating }]
        : [];
    });
    if (writes.length === 0) return;

    const supabase = createUntypedClient();
    const { errors } = await upsertSessionMuscleFeedback(supabase, session.userId, writes);
    if (errors.length > 0) {
      console.error('Failed to save muscle soreness feedback:', errors);
    }
  };

  // ---- Inline soreness chips (start-of-session, once per muscle) ----------
  // Only the FIRST non-skipped block per primary muscle carries the ask.
  const firstBlockIdByMuscle = useMemo(() => {
    const map: Partial<Record<StandardMuscleGroup, string>> = {};
    for (const b of blocks) {
      if (skippedBlockIds.has(b.id)) continue;
      const muscle = resolvePrimaryMuscle(b.exercise?.primaryMuscle);
      if (muscle && !map[muscle]) map[muscle] = b.id;
    }
    return map;
  }, [blocks, skippedBlockIds]);

  /**
   * The soreness prompt for a block, or null. Shown only on the first block
   * of a muscle that was trained within the past 5 days and hasn't been asked
   * (or answered at check-in) this session. A dismissed ask (rating null)
   * renders nothing; an answered ask renders the collapsed ✓ line.
   */
  const sorenessPromptForBlock = useCallback(
    (
      block: ExerciseBlockWithExercise
    ): { muscle: StandardMuscleGroup; displayName: string; answered?: SorenessRating | null } | null => {
      const muscle = resolvePrimaryMuscle(block.exercise?.primaryMuscle);
      if (!muscle) return null;
      if (firstBlockIdByMuscle[muscle] !== block.id) return null;
      // Never shown for muscles not trained in the last 5 days.
      if (!recentMuscleSessions[muscle]) return null;
      const asked = muscleSorenessAsked[muscle];
      if (asked && asked.rating === null) return null; // dismissed by logging a set
      return {
        muscle,
        displayName: STANDARD_MUSCLE_DISPLAY_NAMES[muscle],
        answered: asked ? asked.rating : undefined,
      };
    },
    [firstBlockIdByMuscle, recentMuscleSessions, muscleSorenessAsked]
  );

  const handleSorenessAnswer = useCallback(
    (muscle: StandardMuscleGroup, rating: SorenessRating) => {
      recordSorenessAsked(muscle, rating);

      // Persist onto the PREVIOUS session's feedback row (it describes
      // recovery from that session).
      const previous = recentMuscleSessions[muscle];
      if (session && previous) {
        const supabase = createUntypedClient();
        void upsertSessionMuscleFeedback(supabase, session.userId, [
          { sessionId: previous.sessionId, muscleGroup: muscle, sorenessBefore: rating },
        ]).then(({ errors }) => {
          if (errors.length > 0) console.error('Failed to save soreness answer:', errors);
        });
      }

      // Learning step: disagreement between the report and the model's status
      // at ask time nudges the per-muscle recovery multiplier (±0.05, 0.7–1.5).
      const report = rating === 0 ? 'none' : rating === 3 ? 'still_sore' : 'recovered';
      const config = recoveryConfigFor(enhancedAthleteModeActive, recoveryMultipliers);
      const statusAtAsk = computeMuscleRecovery(
        recoveryHistorySessions,
        muscle,
        new Date(),
        config
      ).status;
      void applySorenessAdjustment(muscle, report, statusAtAsk);
    },
    [
      recordSorenessAsked,
      recentMuscleSessions,
      session,
      enhancedAthleteModeActive,
      recoveryMultipliers,
      recoveryHistorySessions,
      applySorenessAdjustment,
    ]
  );

  // Muscles reported "still sore" today — the readiness sheet renders them
  // Fatigued for the rest of the session (subjective report outranks the
  // time model same-day).
  const stillSoreMuscles = useMemo(() => {
    const result = new Set<StandardMuscleGroup>();
    for (const [muscle, ask] of Object.entries(muscleSorenessAsked)) {
      if (ask?.rating === 3) result.add(muscle as StandardMuscleGroup);
    }
    return result;
  }, [muscleSorenessAsked]);

  // ---- Top-of-workout weekly-volume strip ----------------------------------
  // Stamp the rolling-window clock once on mount so the per-muscle 7-day window
  // is anchored to a stable local day across re-renders.
  const [volumeNow] = useState(() => new Date());
  // Non-skipped blocks, memoized here (before the early returns) so the hook's
  // internal memos stay stable — the render-body `activeBlocks` is a fresh
  // array each pass. Feeds the weekly-volume strip and stays a read-only view.
  const volumeLiveBlocks = useMemo(
    () => blocks.filter((b) => !skippedBlockIds.has(b.id)),
    [blocks, skippedBlockIds]
  );
  // Rolling-7-day credited sets (history + this session) vs the MEV–MRV band,
  // for the coarse muscles this workout trains. Shares the readiness sheet's
  // cached history query and volume model, so the strip and the sheet agree.
  const { rows: weeklyVolumeRows, isLoading: weeklyVolumeLoading } = useWorkoutMuscleVolume({
    liveBlocks: volumeLiveBlocks,
    liveSets: completedSets,
    now: volumeNow,
    // Don't let a cached history query freeze the day's card order before the
    // workout itself (blocks + resumed sets) has hydrated.
    liveDataReady: phase !== 'loading',
  });

  // ---- Per-exercise pump/workload chips ------------------------------------
  const handleExerciseFeedback = useCallback(
    (blockId: string, feedback: { pump?: PumpRating0to3; workload?: WorkloadRating }) => {
      setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, ...feedback } : b)));
      setBlockFeedbackInStore(blockId, feedback);
      // Best-effort persist per (workout, exercise); the finish-time rollup
      // into session_muscle_feedback is what the learner reads.
      const supabase = createUntypedClient();
      void supabase
        .from('exercise_blocks')
        .update(feedback)
        .eq('id', blockId)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error('Failed to save exercise feedback:', error.message);
        });
    },
    [setBlockFeedbackInStore]
  );

  // ---- Joint pain: pattern notices per exercise ----------------------------
  useEffect(() => {
    if (phase !== 'workout' || !session) return;
    let cancelled = false;
    const supabase = createUntypedClient();
    const cutoff = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from('joint_pain_events')
      .select('exercise_id, joint, created_at')
      .eq('user_id', session.userId)
      .not('exercise_id', 'is', null)
      .gte('created_at', cutoff)
      .then(({ data, error: fetchError }: {
        data: { exercise_id: string; joint: string; created_at: string }[] | null;
        error: { message: string } | null;
      }) => {
        if (cancelled) return;
        if (fetchError) {
          // Table may not exist yet (migration lag) — the notice is optional.
          return;
        }
        const grouped: Record<string, ExercisePainEvent[]> = {};
        for (const row of data ?? []) {
          (grouped[row.exercise_id] ??= []).push({
            joint: row.joint,
            occurredAt: new Date(row.created_at),
          });
        }
        setPainEventsByExercise(grouped);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, session]);

  const painNoticeForExercise = useCallback(
    (exerciseId: string): { joint: string; count: number } | null => {
      void painNoticeDismissTick; // recompute after a dismissal
      const events = painEventsByExercise[exerciseId];
      if (!events || events.length === 0) return null;
      return getExercisePainPattern(events, getPainNoticeDismissedAt(exerciseId), new Date());
    },
    [painEventsByExercise, painNoticeDismissTick]
  );

  const handleCheckInComplete = async (
    checkInData?: PreWorkoutCheckIn,
    opts?: { startSession?: boolean }
  ) => {
    const startSession = opts?.startSession ?? true;
    try {
      const supabase = createUntypedClient();

      // Only (re)start the session on the workout-start path. The optional
      // in-workout readiness logger must NOT reset state/started_at.
      const updateData: Record<string, unknown> = startSession
        ? { state: 'in_progress', started_at: new Date().toISOString() }
        : {};
      
      // If we have check-in data, save it
      if (checkInData) {
        updateData.pre_workout_check_in = {
          sleepHours: checkInData.sleepHours,
          sleepQuality: checkInData.sleepQuality,
          stressLevel: checkInData.stressLevel,
          nutritionRating: checkInData.nutritionRating,
          bodyweightKg: checkInData.bodyweightKg,
          readinessScore: checkInData.readinessScore,
          temporaryInjuries: checkInData.temporaryInjuries,
        };

        // Keep the local session in sync so readiness modulation applies
        // immediately (not just after a reload).
        setSession(prev => (prev ? { ...prev, preWorkoutCheckIn: checkInData } : prev));
        
        // Set temporary injuries in state so they carry over to workout
        if (checkInData.temporaryInjuries && checkInData.temporaryInjuries.length > 0) {
          setTemporaryInjuries(
            checkInData.temporaryInjuries.map(i => ({
              area: i.area,
              severity: i.severity,
            }))
          );
        }
        
        // If bodyweight was provided, also log it to weight log
        if (checkInData.bodyweightKg) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const today = getLocalDateString();
            await supabase
              .from('weight_log')
              .upsert(
                {
                  user_id: user.id,
                  weight: checkInData.bodyweightKg,
                  unit: 'kg',
                  logged_at: today,
                },
                { onConflict: 'user_id,logged_at' }
              );
          }
        }
        
        // Auto-adjust exercises if injuries were reported
        if (checkInData.temporaryInjuries && checkInData.temporaryInjuries.length > 0) {
          const injuriesForAi = checkInData.temporaryInjuries.map(i => ({
            area: i.area,
            severity: i.severity,
          }));
          
          // Schedule auto-adjust after state updates
          setTimeout(() => {
            autoAdjustForInjuries(injuriesForAi);
          }, 500);
          
          // Regenerate AI coach notes with injury context
          regenerateAiCoachNotes(injuriesForAi);
        }
      }
      
      if (Object.keys(updateData).length > 0) {
        await supabase
          .from('workout_sessions')
          .update(updateData)
          .eq('id', sessionId);
      }

      if (startSession) {
        const startedAt = updateData.started_at as string;
        setSession(prev => prev ? { ...prev, startedAt, state: 'in_progress' } : prev);
        setPhase('workout');
      }
    } catch (err) {
      console.error('Failed to update session:', err);
      if (startSession) setPhase('workout'); // Continue anyway
    }
  };

  // Readiness easing for this session (Phase 1.3): computed from the
  // check-in's readiness score, threaded into ExerciseCard (RIR chips +
  // suggestion banner reason).
  const readinessScore = session?.preWorkoutCheckIn?.readinessScore;
  const baseReadinessModulation = useMemo(
    () =>
      typeof readinessScore === 'number' && readinessScore > 0
        ? applyReadinessModulation(readinessScore)
        : null,
    [readinessScore]
  );
  // "Train as planned" zeroes the modulation for the rest of the session
  // (session-local; the check-in itself is untouched).
  const readinessModulation = readinessOverridden ? null : baseReadinessModulation;

  const handleSetComplete = async (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
    setType?: 'normal' | 'warmup' | 'dropset' | 'myorep' | 'rest_pause';
    parentSetId?: string;
    feedback?: SetFeedback;
    bodyweightData?: BodyweightData;
  }) => {
    if (!currentBlock) return null;

    // Determine quality - factor in form if available
    let quality: 'stimulative' | 'effective' | 'junk';
    if (data.feedback?.form === 'ugly') {
      quality = 'junk'; // Ugly form sets are junk
    } else if (data.rpe >= 7.5 && data.rpe <= 9.5) {
      quality = 'stimulative';
    } else if (data.rpe <= 5) {
      quality = 'junk';
    } else {
      quality = 'effective';
    }

    // Build quality reason
    let qualityReason = '';
    if (data.feedback) {
      const formLabel =
        data.feedback.form === 'clean'
          ? 'Clean form'
          : data.feedback.form === 'some_breakdown'
            ? 'Some form breakdown'
            : 'Form breakdown';
      qualityReason = formLabel;
    }

    const loggedAt = new Date().toISOString();
    const setType = data.setType || 'normal';

    // Offline-first persistence (P0-2): the set id is generated CLIENT-side
    // so local state, the outbox, and the eventual DB row all agree; the
    // insert either lands now ('saved') or waits in the IndexedDB outbox
    // ('queued') until connectivity returns. Local/UI state never blocks on
    // the network.
    try {
      const supabase = createUntypedClient();
      const online = typeof navigator === 'undefined' || navigator.onLine;

      // Prefer the DB's max set_number (avoids races/stale state); fall back
      // to local numbering when offline.
      let nextSetNumber = currentSetNumber;
      if (online) {
        try {
          const { data: maxSetResult } = await supabase
            .from('set_logs')
            .select('set_number')
            .eq('exercise_block_id', currentBlock.id)
            .eq('is_warmup', false)
            .order('set_number', { ascending: false })
            .limit(1)
            .single();
          if (maxSetResult?.set_number != null) {
            // Floor at the local number: a set still queued in the offline
            // outbox isn't in the DB max yet, and reusing its number would
            // create duplicate set_numbers in the block. DB max still wins
            // when it's ahead (another tab/device logged sets).
            nextSetNumber = Math.max(currentSetNumber, maxSetResult.set_number + 1);
          }
        } catch {
          // Numbering probe failed (flaky network) — local numbering is fine.
        }
      }

      // Infer the set role (working | ramp) from this set's load vs the block's
      // top working set so far, so ramp/feeder sets aren't graded or counted as
      // junk volume. Provisional at log time (a heavier later set can't retro-
      // relabel an earlier row live); the set_roles migration recomputes roles
      // authoritatively once a session's sets are all known.
      const blockWorkingSets = completedSets
        .filter((s) => s.exerciseBlockId === currentBlock.id && !s.isWarmup)
        .map((s) => ({ weightKg: s.weightKg }));
      const blockTopKg = sessionTopSetWeightKg([...blockWorkingSets, { weightKg: data.weightKg }]);
      const setRole = data.weightKg > 0 ? inferSetRole(data.weightKg, blockTopKg) : 'working';

      const setId = crypto.randomUUID();
      const row = {
        id: setId,
        exercise_block_id: currentBlock.id,
        set_number: nextSetNumber,
        weight_kg: data.weightKg,
        reps: data.reps,
        set_type: setType,
        set_role: setRole,
        suggestion_engine_version: SUGGESTION_ENGINE_VERSION,
        // Stamp the session's location so this set feeds the right location's
        // calibration track for local-scope exercises (null = legacy/unknown).
        location_id: sessionLocationId,
        parent_set_id: data.parentSetId || null,
        rpe: data.rpe,
        is_warmup: false,
        quality: quality,
        quality_reason: qualityReason,
        note: data.note || null,
        logged_at: loggedAt,
        feedback: data.feedback ? JSON.stringify(data.feedback) : null,
        bodyweight_data: data.bodyweightData ? JSON.stringify(data.bodyweightData) : null,
      };

      const newSet: SetLog = {
        id: setId,
        exerciseBlockId: currentBlock.id,
        setNumber: nextSetNumber,
        weightKg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        restSeconds: null,
        isWarmup: false,
        setType: setType,
        setRole: setRole,
        suggestionEngineVersion: SUGGESTION_ENGINE_VERSION,
        parentSetId: data.parentSetId || null,
        quality: quality,
        qualityReason: qualityReason,
        note: data.note || null,
        loggedAt: loggedAt,
        feedback: data.feedback,
        bodyweightData: data.bodyweightData,
      };

      // Optimistic local state first — the UI (and Zustand-persist recovery)
      // must not depend on the write landing.
      setCompletedSets(prevSets => [...prevSets, newSet]);
      setCurrentSetNumber(nextSetNumber + 1);
      logSetToStore(currentBlock.id, newSet);
      setSetSync(prev => ({ ...prev, [setId]: 'saving' }));

      // Logging a set past a pending soreness ask dismisses it for the
      // session (records null; the muscle is never re-asked). Zero extra taps.
      {
        const blockMuscle = resolvePrimaryMuscle(currentBlock.exercise?.primaryMuscle);
        if (
          blockMuscle &&
          firstBlockIdByMuscle[blockMuscle] === currentBlock.id &&
          recentMuscleSessions[blockMuscle] &&
          !muscleSorenessAsked[blockMuscle]
        ) {
          recordSorenessAsked(blockMuscle, null);
        }
      }

      // Whether the set row exists in the DB yet — decides if the joint pain
      // event below may carry the set_log_id FK or must omit it (queued sets
      // haven't been inserted, so referencing them would violate the FK).
      let setRowPersisted = false;

      if (!online) {
        await enqueueSetInsert(setId, row);
        setSetSync(prev => ({ ...prev, [setId]: 'queued' }));
        refreshOutboxCount();
      } else {
        let insertError: { message: string; code?: string } | null = null;
        try {
          const result = await supabase.from('set_logs').insert(row);
          insertError = result.error;
          // Schema-cache column miss (a set_roles-style migration not yet applied
          // to this database): drop the optional columns and retry once so a
          // migration lag can't block set logging mid-workout.
          if (insertError && isMissingColumnError(insertError)) {
            const retry = await supabase
              .from('set_logs')
              .insert(withoutOptionalSetLogColumns(row));
            insertError = retry.error;
          }
        } catch (e) {
          insertError = { message: e instanceof Error ? e.message : String(e) };
        }

        if (insertError && isNetworkError(insertError)) {
          // Connectivity died mid-write: queue it, keep the optimistic state.
          await enqueueSetInsert(setId, row);
          setSetSync(prev => ({ ...prev, [setId]: 'queued' }));
          refreshOutboxCount();
        } else if (insertError) {
          // Real server rejection: roll the optimistic set back.
          console.error('Failed to save set:', insertError);
          setCompletedSets(prevSets => prevSets.filter(s => s.id !== setId));
          setCurrentSetNumber(nextSetNumber);
          deleteSetFromStore(currentBlock.id, setId);
          setSetSync(prev => { const next = { ...prev }; delete next[setId]; return next; });
          setError(`Failed to save set: ${insertError.message}`);
          showError('Failed to save set - please try again');
          return null;
        } else {
          setRowPersisted = true;
          setSetSync(prev => ({ ...prev, [setId]: 'saved' }));
        }
      }

      // Joint pain flagged on this set (inline picker or feedback sheet) →
      // record the event for the deload advisor + exercise pattern detection.
      // Runs only AFTER the set write settled: a saved set is referenced via
      // set_log_id; a queued (offline) set isn't in set_logs yet, so the event
      // omits the FK rather than racing the insert. Best-effort either way —
      // the discomfort also rides the set's feedback JSONB.
      if (data.feedback?.discomfort && session) {
        void insertJointPainEvent(
          supabase,
          eventFromSetDiscomfort({
            userId: session.userId,
            sessionId: session.id,
            exerciseId: currentBlock.exerciseId,
            setLogId: setRowPersisted ? setId : null,
            discomfort: data.feedback.discomfort,
          })
        );
      }

      // Undo toast (P1-4) — same pattern as nutrition's delete-undo.
      addToast('success', `Set ${nextSetNumber} logged`, 5000, {
        label: 'Undo',
        onClick: () => { void undoLoggedSet(setId, currentBlock.id); },
      });

      // Dropset logic: check if we need to show dropset prompt instead of rest timer
      const dropsetsConfigured = (currentBlock.dropsetsPerSet ?? 0) > 0;
      const isNormalSet = setType === 'normal';
      const isDropsetSet = setType === 'dropset';

      if (isNormalSet && dropsetsConfigured) {
        // Normal set completed with dropsets configured - show dropset prompt immediately
        // NO rest timer - dropsets should be immediate
        setPendingDropset({
          parentSetId: newSet.id,
          parentWeight: data.weightKg,
          blockId: currentBlock.id,
          dropNumber: 1,
          totalDrops: currentBlock.dropsetsPerSet ?? 1,
        });
        setShowRestTimer(false);
      } else if (isDropsetSet && pendingDropset) {
        // Just completed a dropset - check if more drops remaining
        if (pendingDropset.dropNumber < pendingDropset.totalDrops) {
          // More drops to go - update to next drop
          setPendingDropset({
            ...pendingDropset,
            parentSetId: newSet.id,
            parentWeight: data.weightKg,
            dropNumber: pendingDropset.dropNumber + 1,
          });
          setShowRestTimer(false);
        } else {
          // Final drop complete - NOW start rest timer
          setPendingDropset(null);
          setShowRestTimer(true);
          setRestTimerDuration(null);
          restTimer.start(currentBlock?.targetRestSeconds ?? 180);
        }
      } else if (currentBlock.supersetGroupId) {
        // Superset flow (pairs, manual, rest-after-last) — decision in the pure
        // computeSupersetAdvance so the round-robin is unit-tested. completedByBlock
        // must include the just-logged set for the current block.
        setPendingDropset(null);
        const completedByBlock: Record<string, number> = {};
        for (const s of completedSets) {
          if (s.isWarmup || s.setType === 'warmup') continue;
          completedByBlock[s.exerciseBlockId] = (completedByBlock[s.exerciseBlockId] ?? 0) + 1;
        }
        completedByBlock[currentBlock.id] = (completedByBlock[currentBlock.id] ?? 0) + 1; // include this set
        const step = computeSupersetAdvance(blocks, currentBlockIndex, completedByBlock);
        if (step) {
          setShowRestTimer(step.startRest);
          if (step.startRest) {
            setRestTimerDuration(null);
            restTimer.start(currentBlock?.targetRestSeconds ?? 180);
          }
          if (step.nextIndex !== currentBlockIndex) {
            setCurrentBlockIndex(step.nextIndex);
            setCurrentSetNumber(step.nextSetNumber);
          }
        } else {
          // Degenerate group -> normal rest.
          setShowRestTimer(true);
          setRestTimerDuration(null);
          restTimer.start(currentBlock?.targetRestSeconds ?? 180);
        }
      } else {
        // Normal flow - start rest timer
        setPendingDropset(null);
        setShowRestTimer(true);
        setRestTimerDuration(null);
        restTimer.start(currentBlock?.targetRestSeconds ?? 180);
      }
      setError(null);

      // Run sanity checks on the completed set
      if (currentExercise && setType === 'normal') {
        const setLog = {
          exerciseName: currentExercise.name,
          weight: data.weightKg,
          reps: data.reps,
          reportedRIR: 10 - data.rpe, // Convert RPE to RIR
          isWarmup: false,
          setNumber: currentSetNumber,
        };

        const checkContext = {
          workingWeight: currentBlock.targetWeightKg,
          currentTimestamp: new Date(),
          previousSets: currentBlockSets.map(s => ({
            exerciseName: currentExercise.name,
            weight: s.weightKg,
            reps: s.reps,
            reportedRIR: 10 - s.rpe,
            isWarmup: s.isWarmup,
            setNumber: s.setNumber,
          })),
        };

        const checkResult = checkSetSanity(setLog, checkContext);
        if (checkResult) {
          setSanityCheckResult(checkResult);
        }

        // Check if this is an AMRAP-eligible set (last set on a safe exercise)
        const safetyTier = getFailureSafetyTier(currentExercise.name);
        const isLastSet = currentSetNumber >= currentBlock.targetSets;
        const isAmrapEligible = safetyTier === 'push_freely' && isLastSet && data.rpe >= 9.5;

        if (isAmrapEligible) {
          // Log to calibration engine and check for result
          // Use actual reported RIR from the set (converted from RPE), not the target RIR
          const reportedRIR = 10 - data.rpe;
          const calibResult = calibrationEngineRef.current.addSetLog({
            exerciseId: currentExercise.id,
            exerciseName: currentExercise.name,
            weight: data.weightKg,
            prescribedReps: { min: currentBlock.targetRepRange[0], max: currentBlock.targetRepRange[1] },
            actualReps: data.reps,
            reportedRIR: Math.max(0, Math.round(reportedRIR)), // Ensure RIR is non-negative integer
            wasAMRAP: true,
            timestamp: new Date(),
          });

          if (calibResult) {
            setCalibrationResult(calibResult);

            // Track calibration for session summary
            const calibWithMeta = {
              ...calibResult,
              exerciseId: currentExercise.id,
              weightKg: data.weightKg,
              setLogId: setId,
            };
            setSessionCalibrations(prev => [...prev, calibWithMeta]);

            // Persist calibration to database (best-effort: skipped offline —
            // the local calibration engine still holds the data point).
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                supabase.from('amrap_calibrations').insert({
                  user_id: user.id,
                  workout_session_id: sessionId,
                  set_log_id: setId,
                  exercise_id: currentExercise.id,
                  exercise_name: calibResult.exerciseName,
                  weight_kg: data.weightKg,
                  predicted_max_reps: calibResult.predictedMaxReps,
                  actual_max_reps: calibResult.actualMaxReps,
                  bias: calibResult.bias,
                  bias_interpretation: calibResult.biasInterpretation,
                  confidence_level: calibResult.confidenceLevel,
                  data_points: calibResult.dataPoints,
                  raw_predicted_max_reps: calibResult.rawPredictedMaxReps ?? calibResult.predictedMaxReps,
                  method: calibResult.method ?? 'fatigue_adjusted_v2',
                  calibrated_at: calibResult.lastCalibrated.toISOString(),
                }).then(({ error }: { error: Error | null }) => {
                  if (error) console.error('Failed to save AMRAP calibration:', error);
                });
              }
            } catch (calibErr) {
              console.error('Skipping AMRAP calibration persist (offline?):', calibErr);
            }
          }
        }
        
        // Also log non-AMRAP sets for calibration comparison (but don't show result)
        if (safetyTier === 'push_freely' && !isAmrapEligible && setType === 'normal') {
          const reportedRIR = 10 - data.rpe;
          calibrationEngineRef.current.addSetLog({
            exerciseId: currentExercise.id,
            exerciseName: currentExercise.name,
            weight: data.weightKg,
            prescribedReps: { min: currentBlock.targetRepRange[0], max: currentBlock.targetRepRange[1] },
            actualReps: data.reps,
            reportedRIR: Math.max(0, Math.round(reportedRIR)),
            wasAMRAP: false,
            timestamp: new Date(),
          });
        }

        // Clear AMRAP accepted state when last set is completed
        if (isLastSet) {
          setAmrapAcceptedBlockId(null);
        }
      }

      // Return the set ID for optional feedback
      return setId;
    } catch (err) {
      console.error('Failed to save set:', err);
      setError(err instanceof Error ? err.message : 'Failed to save set - please try again');
      showError('Failed to save set - please try again');
      return null;
    }
  };

  // Update feedback on an existing set
  const handleSetFeedbackUpdate = async (setId: string, feedback: SetFeedback) => {
    const supabase = createUntypedClient();

    // Determine quality based on feedback
    let quality: 'stimulative' | 'effective' | 'junk' = 'effective';
    if (feedback.form === 'ugly') {
      quality = 'junk';
    } else if (feedback.repsInTank <= 2) {
      quality = 'stimulative';
    }

    const qualityReason =
      feedback.form === 'clean'
        ? 'Clean form'
        : feedback.form === 'some_breakdown'
          ? 'Some form breakdown'
          : 'Form breakdown';

    // Convert RIR to RPE (rirToRpe handles all RepsInTank values incl. 3 → 7;
    // an inline ternary here previously collapsed RIR 3 to RPE 10)
    const rpe = rirToRpe(feedback.repsInTank);

    // Queued-but-unsynced set (P0-2): patch the outbox row instead of the DB.
    const patchedQueued = await updateQueuedSet(setId, {
      feedback: JSON.stringify(feedback),
      quality,
      quality_reason: qualityReason,
      rpe,
    });

    if (!patchedQueued) {
      // Update database
      const { error } = await supabase
        .from('set_logs')
        .update({
          feedback: JSON.stringify(feedback),
          quality,
          quality_reason: qualityReason,
          rpe,
        })
        .eq('id', setId);

      if (error) {
        console.error('Failed to update set feedback:', error);
        return;
      }
    }

    // Update local state
    setCompletedSets(prevSets =>
      prevSets.map(set =>
        set.id === setId
          ? { ...set, feedback, quality, qualityReason, rpe }
          : set
      )
    );

    // Sync to store for resume functionality
    const setToUpdate = completedSets.find(s => s.id === setId);
    if (setToUpdate) {
      updateSetInStore(setToUpdate.exerciseBlockId, setId, { feedback, quality, qualityReason, rpe });
    }

    // Discomfort newly added to an already-logged set → record the pain event.
    // A set still queued in the offline outbox has no set_logs row yet, so the
    // event omits the set_log_id FK rather than referencing a missing row.
    if (feedback.discomfort && !setToUpdate?.feedback?.discomfort && session && setToUpdate) {
      const block = blocks.find((b) => b.id === setToUpdate.exerciseBlockId);
      if (block) {
        void insertJointPainEvent(
          supabase,
          eventFromSetDiscomfort({
            userId: session.userId,
            sessionId: session.id,
            exerciseId: block.exerciseId,
            setLogId: patchedQueued ? null : setId,
            discomfort: feedback.discomfort,
          })
        );
      }
    }
  };

  // Two-tap joint picker on a COMPLETED set row: merge the discomfort into the
  // set's existing feedback (or synthesize one from the logged RPE) and reuse
  // the standard feedback-update path, which also records the pain event.
  const handleSetJointPain = useCallback(
    (setId: string, discomfort: SetDiscomfort) => {
      const target = completedSets.find((s) => s.id === setId);
      if (!target) return;
      const feedback: SetFeedback = target.feedback
        ? { ...target.feedback, discomfort }
        : { repsInTank: Math.max(0, Math.min(4, Math.round(rpeToRir(target.rpe)))) as RepsInTank, form: 'clean', discomfort };
      void handleSetFeedbackUpdate(setId, feedback);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completedSets, session, blocks]
  );

  const handleSetEdit = async (setId: string, data: { weightKg: number; reps: number; rpe: number; bodyweightData?: BodyweightData }) => {
    const quality = data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective' as const;
    
    // Use provided bodyweightData if available, otherwise preserve existing
    const existingSet = completedSets.find(s => s.id === setId);
    const updatedBodyweightData = data.bodyweightData || existingSet?.bodyweightData;

    // Keep feedback's RIR consistent with the edited RPE — the completed-set
    // display prefers feedback.repsInTank over the RPE-derived value. Only
    // resync when the new RPE disagrees with the existing RIR: the round trip
    // is lossy (RIR 2 → RPE 7.5 → round(2.5) = 3), so an unconditional rewrite
    // would mutate RIR on weight/reps-only edits.
    const updatedFeedback: SetFeedback | undefined =
      existingSet?.feedback && rirToRpe(existingSet.feedback.repsInTank) !== data.rpe
        ? {
            ...existingSet.feedback,
            repsInTank: Math.max(0, Math.min(4, Math.round(10 - data.rpe))) as RepsInTank,
          }
        : undefined;

    // Update local state using functional update to avoid stale closure
    setCompletedSets(prevSets => prevSets.map(set =>
      set.id === setId
        ? {
            ...set,
            weightKg: data.weightKg,
            reps: data.reps,
            rpe: data.rpe,
            quality,
            bodyweightData: updatedBodyweightData,
            feedback: updatedFeedback ?? set.feedback,
          }
        : set
    ));

    // Sync to store for resume functionality
    if (existingSet) {
      updateSetInStore(existingSet.exerciseBlockId, setId, {
        weightKg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        quality,
        bodyweightData: updatedBodyweightData,
        ...(updatedFeedback ? { feedback: updatedFeedback } : {}),
      });
    }

    // Update in database (or in the outbox if the set hasn't synced yet, P0-2)
    try {
      const supabase = createUntypedClient();
      const updateData: any = {
        weight_kg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        quality,
      };

      // Update bodyweight_data if provided or if it exists
      if (updatedBodyweightData) {
        updateData.bodyweight_data = updatedBodyweightData;
      }

      if (updatedFeedback) {
        updateData.feedback = JSON.stringify(updatedFeedback);
      }

      if (await updateQueuedSet(setId, updateData)) {
        setError(null);
        return;
      }

      const { error: updateError } = await supabase.from('set_logs').update(updateData).eq('id', setId);

      if (updateError) {
        console.error('Failed to update set:', updateError);
        setError(`Failed to update set: ${updateError.message}`);
        // Revert local state on error - refetch from database
        // For now, just show error; user can refresh if needed
      } else {
        setError(null);
        // P1-3 detection A: stamp edited_at (best-effort, dormant until the
        // set_logs.edited_at migration is applied). Separate update so a
        // missing column can't break in-session editing.
        await supabase
          .from('set_logs')
          .update({ edited_at: new Date().toISOString() })
          .eq('id', setId)
          .then(({ error: stampErr }: { error: unknown }) => {
            if (stampErr) console.debug('edited_at stamp skipped (migration not applied?)');
          });
      }
    } catch (err) {
      console.error('Failed to update set:', err);
      setError(err instanceof Error ? err.message : 'Failed to update set');
    }
  };

  const handleDeleteSet = async (setId: string) => {
    // Find the set before deleting to get the blockId for store sync
    const setToDelete = completedSets.find(s => s.id === setId);

    // Remove from local state using functional update to avoid stale closure
    setCompletedSets(prevSets => {
      const setInPrev = prevSets.find(s => s.id === setId);
      if (!setInPrev) return prevSets;

      // Filter out the deleted set and renumber remaining sets in the same block
      const filteredSets = prevSets.filter(set => set.id !== setId);
      const blockId = setInPrev.exerciseBlockId;

      // Renumber sets in the same block (immutably)
      let blockSetNumber = 1;
      return filteredSets.map(set => {
        if (set.exerciseBlockId === blockId && !set.isWarmup && set.setType !== 'warmup') {
          return { ...set, setNumber: blockSetNumber++ };
        }
        return set;
      });
    });

    // Sync to store for resume functionality
    if (setToDelete) {
      deleteSetFromStore(setToDelete.exerciseBlockId, setId);
    }
    setSetSync(prev => { const next = { ...prev }; delete next[setId]; return next; });

    // Delete from database — unless the set never left the outbox (P0-2).
    try {
      if (await removeQueuedSet(setId)) {
        refreshOutboxCount();
        setError(null);
        return;
      }
      const supabase = createUntypedClient();
      const { error: deleteError } = await supabase.from('set_logs').delete().eq('id', setId);

      if (deleteError) {
        console.error('Failed to delete set:', deleteError);
        setError(`Failed to delete set: ${deleteError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to delete set:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete set');
    }
  };

  /** Undo the just-logged set (toast action, P1-4). */
  const undoLoggedSet = async (setId: string, _blockId: string) => {
    await handleDeleteSet(setId);
    setCurrentSetNumber(prev => Math.max(1, prev - 1));
  };

  // State for adding extra sets beyond target
  const [addingExtraSet, setAddingExtraSet] = useState<string | null>(null);
  
  // Auto-adjust message state
  const [autoAdjustMessage, setAutoAdjustMessage] = useState<string | null>(null);

  // Auto-swap or remove exercises based on injuries using intelligent injury-aware swapper
  const autoAdjustForInjuries = async (injuries: { area: string; severity: 1 | 2 | 3 }[]) => {
    if (injuries.length === 0 || blocks.length === 0) return;
    
    const supabase = createUntypedClient();
    const adjustments: string[] = [];
    
    // Convert to InjuryContext format
    const injuryContexts: InjuryContext[] = injuries.map(i => ({
      area: i.area as InjuryArea,
      severity: i.severity
    }));
    
    // Fetch all exercises if not already loaded
    let exercisesToUse = availableExercises;
    if (exercisesToUse.length === 0) {
      const { data: allExercises } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, mechanic, equipment_required, default_rep_range, default_rir, is_bodyweight, hypertrophy_tier')
        .is('deleted_at', null) // hide merge-soft-deleted duplicates
        .order('name');

      if (allExercises) {
        exercisesToUse = allExercises;
        setAvailableExercises(allExercises);
      }
    }
    
    if (exercisesToUse.length === 0) {
      console.error('No exercises available for swap');
      return;
    }
    
    // Build full exercise list from available exercises
    const fullExercises: Exercise[] = exercisesToUse.map(ex => ({
      id: ex.id,
      name: ex.name,
      primaryMuscle: ex.primary_muscle,
      secondaryMuscles: ex.secondary_muscles || [],
      mechanic: ex.mechanic,
      defaultRepRange: [8, 12] as [number, number],
      defaultRir: 2,
      minWeightIncrementKg: 2.5,
      formCues: [],
      commonMistakes: [],
      setupNote: '',
      movementPattern: '',
      equipmentRequired: ex.equipment_required || [],
      isBodyweight: ex.is_bodyweight ?? undefined,
    }));

    // Get auto-swap results from the intelligent swapper, constrained to the
    // selected location's equipment so a swap never lands on gear the user
    // doesn't have.
    const workoutExercises = blocks.map(b => ({ id: b.id, exercise: b.exercise }));
    const swapResults = autoSwapForInjuries(
      workoutExercises,
      fullExercises,
      injuryContexts,
      locationUnavailableEquipmentIds
    );
    
    if (swapResults.length === 0) return;
    
    for (const result of swapResults) {
      const block = blocks.find(b => b.id === result.originalId);
      if (!block) continue;
      
      if (result.action === 'swapped' && result.replacement) {
        // Fetch full exercise data from database
        try {
          const { data: fullExData } = await supabase
            .from('exercises')
            .select('*')
            .eq('id', result.replacement.id)
            .single();
          
          if (fullExData) {
            // Update in database
            await supabase
              .from('exercise_blocks')
              .update({ exercise_id: result.replacement.id })
              .eq('id', block.id);
            
            // Update local state
            const completeExercise: Exercise = {
              id: fullExData.id,
              name: fullExData.name,
              primaryMuscle: fullExData.primary_muscle,
              secondaryMuscles: fullExData.secondary_muscles || [],
              mechanic: fullExData.mechanic,
              defaultRepRange: fullExData.default_rep_range || [8, 12],
              defaultRir: fullExData.default_rir || 2,
              minWeightIncrementKg: fullExData.min_weight_increment_kg || 2.5,
              formCues: fullExData.form_cues || [],
              commonMistakes: fullExData.common_mistakes || [],
              setupNote: fullExData.setup_note || '',
              movementPattern: fullExData.movement_pattern || '',
              equipmentRequired: fullExData.equipment_required || [],
              hypertrophyScore: fullExData.hypertrophy_tier ? {
                tier: fullExData.hypertrophy_tier,
                stretchUnderLoad: fullExData.stretch_under_load || 3,
                resistanceProfile: fullExData.resistance_profile || 3,
                progressionEase: fullExData.progression_ease || 3,
              } : undefined,
              // Exercise type for duration-based exercises (planks, holds)
              exerciseType: fullExData.exercise_type as ExerciseType | undefined,
            };

            setBlocks(prevBlocks => prevBlocks.map(b =>
              b.id === block.id
                ? { ...b, exerciseId: result.replacement!.id, exercise: completeExercise }
                : b
            ));

            adjustments.push(`${result.originalName} → ${result.replacement.name}`);
          }
        } catch (err) {
          console.error('Failed to auto-swap exercise:', err);
        }
      } else if (result.action === 'removed') {
        // No safe alternative - remove the exercise
        try {
          // Delete from database
          await supabase
            .from('exercise_blocks')
            .delete()
            .eq('id', block.id);
          
          // Update local state
          setBlocks(prevBlocks => prevBlocks.filter(b => b.id !== block.id));
          
          adjustments.push(`Removed ${result.originalName}`);
        } catch (err) {
          console.error('Failed to remove exercise:', err);
        }
      }
    }
    
    // Show adjustment message
    if (adjustments.length > 0) {
      setAutoAdjustMessage(`🔄 Auto-adjusted for injury: ${adjustments.join('; ')}`);
      // Clear message after 8 seconds
      setTimeout(() => setAutoAdjustMessage(null), 8000);
    }
  };

  // Handle applying injuries and saving to session
  const handleApplyInjuries = async () => {
    try {
      const supabase = createUntypedClient();
      
      // Update session's pre_workout_check_in with temporary injuries
      const { data: sessionData } = await supabase
        .from('workout_sessions')
        .select('pre_workout_check_in')
        .eq('id', sessionId)
        .single();
      
      const existingCheckIn = sessionData?.pre_workout_check_in || {};
      
      await supabase
        .from('workout_sessions')
        .update({
          pre_workout_check_in: {
            ...existingCheckIn,
            temporaryInjuries: temporaryInjuries,
          },
        })
        .eq('id', sessionId);
      
      // Auto-adjust exercises based on injuries
      await autoAdjustForInjuries(temporaryInjuries);
      
      // Regenerate AI coach notes with the updated injury context
      if (temporaryInjuries.length > 0) {
        regenerateAiCoachNotes(temporaryInjuries);
      }
      
      setShowInjuryModal(false);
    } catch (err) {
      console.error('Failed to save injury data:', err);
      setShowInjuryModal(false);
    }
  };

  const handleTargetSetsChange = async (blockId: string, newTargetSets: number) => {
    // Update local state immediately
    setBlocks(prevBlocks => prevBlocks.map(block => 
      block.id === blockId 
        ? { ...block, targetSets: newTargetSets }
        : block
    ));

    // Update in database
    try {
      const supabase = createUntypedClient();
      const { error: updateError } = await supabase
        .from('exercise_blocks')
        .update({ target_sets: newTargetSets })
        .eq('id', blockId);
      
      if (updateError) {
        console.error('Failed to update target sets:', updateError);
        setError(`Failed to update sets: ${updateError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to update target sets:', err);
      setError(err instanceof Error ? err.message : 'Failed to update sets');
    }
  };

  // One-tap plateau action: update the block's target rep range (same
  // local-state + exercise_blocks update path as target sets / notes).
  const handleRepRangeChange = async (blockId: string, range: [number, number]) => {
    // Update local state immediately
    setBlocks(prevBlocks => prevBlocks.map(block =>
      block.id === blockId
        ? { ...block, targetRepRange: range }
        : block
    ));

    // Update in database
    try {
      const supabase = createUntypedClient();
      const { error: updateError } = await supabase
        .from('exercise_blocks')
        .update({ target_rep_range: range })
        .eq('id', blockId);

      if (updateError) {
        console.error('Failed to update rep range:', updateError);
        setError(`Failed to update rep range: ${updateError.message}`);
      } else {
        setError(null);
        showSuccess(`Rep range updated to ${range[0]}–${range[1]}`);
      }
    } catch (err) {
      console.error('Failed to update rep range:', err);
      setError(err instanceof Error ? err.message : 'Failed to update rep range');
    }
  };

  const handleBlockNoteUpdate = async (blockId: string, note: string | null) => {
    // Update local state immediately
    setBlocks(prevBlocks => prevBlocks.map(block =>
      block.id === blockId
        ? { ...block, note }
        : block
    ));

    // Update in database
    try {
      const supabase = createUntypedClient();
      const { error: updateError } = await supabase
        .from('exercise_blocks')
        .update({ note })
        .eq('id', blockId);

      if (updateError) {
        console.error('Failed to update exercise note:', updateError);
        setError(`Failed to update note: ${updateError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to update exercise note:', err);
      setError(err instanceof Error ? err.message : 'Failed to update note');
    }
  };

  // Toggle individual exercise collapse
  const toggleBlockCollapse = useCallback((blockId: string) => {
    setCollapsedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  // Long press handlers for drag reorder
  const handleBlockLongPressStart = useCallback((index: number, clientY: number) => {
    longPressTimerRef.current = setTimeout(() => {
      // Save current collapse state before collapsing all for drag mode
      preCollapseStateRef.current = {
        allCollapsed,
        collapsedBlocks: new Set(collapsedBlocks),
      };

      // Get the element being dragged and its dimensions
      const element = document.querySelector(`[data-block-index="${index}"]`) as HTMLElement;
      if (element) {
        const rect = element.getBoundingClientRect();
        setDraggedBlockRect(rect);
        // Calculate offset from touch point to top of element - keeps preview under finger
        const touchOffset = clientY - rect.top;
        setDragTouchOffset(touchOffset);
        dragTouchOffsetRef.current = touchOffset;
        // Position preview so it stays under the finger
        setDragPosition({ x: rect.left, y: clientY - touchOffset });
      }

      setDraggedBlockIndex(index);
      setIsDraggingBlock(true);
      // Collapse all exercises for iPhone-style drag mode
      setAllCollapsed(true);

      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 150); // short hold to activate drag — it's a dedicated touch-none handle, so a
             // long delay isn't needed to disambiguate from scrolling; keep just enough
             // to avoid a stray tap collapsing everything into drag mode
  }, [allCollapsed, collapsedBlocks]);

  const handleBlockLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Calculate the target index based on current drag position. Reads the
  // data-block-index attribute (rather than the DOM position) because the
  // list is rendered in two sections (started/current cards + the "Up next"
  // rows), so DOM order is not guaranteed to match block order.
  const calculateDragTargetIndex = useCallback((clientY: number): number => {
    if (!exerciseListRef.current || draggedBlockIndex === null) return draggedBlockIndex ?? 0;

    const listItems = exerciseListRef.current.querySelectorAll('[data-block-index]');
    let targetIndex = draggedBlockIndex;

    for (let i = 0; i < listItems.length; i++) {
      const item = listItems[i] as HTMLElement;
      const itemIndex = Number(item.dataset.blockIndex);
      if (Number.isNaN(itemIndex)) continue;
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        targetIndex = itemIndex;
        break;
      }
      targetIndex = itemIndex + 1;
    }

    // Clamp to valid range
    return Math.max(0, Math.min(targetIndex, blocks.length - 1));
  }, [draggedBlockIndex, blocks.length]);

  const handleBlockDragMove = useCallback((clientY: number) => {
    if (!isDraggingBlock || draggedBlockIndex === null) return;

    // Update floating preview position - use touch offset to keep preview under finger
    if (draggedBlockRect) {
      setDragPosition({
        x: draggedBlockRect.left,
        y: clientY - dragTouchOffset
      });
    }

    // Calculate which position the item would drop at
    const targetIndex = calculateDragTargetIndex(clientY);
    if (targetIndex !== dragOverBlockIndex && targetIndex !== draggedBlockIndex) {
      setDragOverBlockIndex(targetIndex);
    }
  }, [isDraggingBlock, draggedBlockIndex, draggedBlockRect, dragTouchOffset, calculateDragTargetIndex, dragOverBlockIndex]);

  // Use refs to access latest values in document event listeners
  const isDraggingBlockRef = useRef(isDraggingBlock);
  const draggedBlockIndexRef = useRef(draggedBlockIndex);
  const draggedBlockRectRef = useRef(draggedBlockRect);
  const dragOverBlockIndexRef = useRef(dragOverBlockIndex);

  // Keep refs in sync with state
  useEffect(() => {
    isDraggingBlockRef.current = isDraggingBlock;
    draggedBlockIndexRef.current = draggedBlockIndex;
    draggedBlockRectRef.current = draggedBlockRect;
    dragOverBlockIndexRef.current = dragOverBlockIndex;
  }, [isDraggingBlock, draggedBlockIndex, draggedBlockRect, dragOverBlockIndex]);

  const handleBlockDragEnd = useCallback(async () => {
    const finalTargetIndex = dragOverBlockIndex ?? draggedBlockIndex;

    if (draggedBlockIndex !== null && finalTargetIndex !== null && draggedBlockIndex !== finalTargetIndex) {
      const spliced = [...blocks];
      const [removed] = spliced.splice(draggedBlockIndex, 1);
      spliced.splice(finalTargetIndex, 0, removed);
      const newBlocks = spliced.map((b, i) => ({ ...b, order: i + 1 }));

      // Update local state immediately
      setBlocks(newBlocks);

      // Update current block index if needed
      if (currentBlockIndex === draggedBlockIndex) {
        setCurrentBlockIndex(finalTargetIndex);
      } else if (draggedBlockIndex < currentBlockIndex && finalTargetIndex >= currentBlockIndex) {
        setCurrentBlockIndex(currentBlockIndex - 1);
      } else if (draggedBlockIndex > currentBlockIndex && finalTargetIndex <= currentBlockIndex) {
        setCurrentBlockIndex(currentBlockIndex + 1);
      }

      // Persist the new order. exercise_blocks."order" (the column the loader
      // sorts by) is UNIQUE per session, so write in two passes — park every
      // block on a temporary offset first, then write the final 1..n values —
      // to avoid transient unique-constraint collisions mid-update.
      try {
        const supabase = createUntypedClient();
        for (let i = 0; i < newBlocks.length; i++) {
          const { error: parkError } = await supabase
            .from('exercise_blocks')
            .update({ order: i + 1001 })
            .eq('id', newBlocks[i].id);
          if (parkError) throw parkError;
        }
        for (let i = 0; i < newBlocks.length; i++) {
          const { error: orderError } = await supabase
            .from('exercise_blocks')
            .update({ order: i + 1 })
            .eq('id', newBlocks[i].id);
          if (orderError) throw orderError;
        }
      } catch (err) {
        console.error('Error saving reorder:', err);
      }
    }

    setDraggedBlockIndex(null);
    setDragOverBlockIndex(null);
    setIsDraggingBlock(false);
    setDragPosition(null);
    setDraggedBlockRect(null);

    // Restore pre-drag collapse state
    if (preCollapseStateRef.current) {
      setAllCollapsed(preCollapseStateRef.current.allCollapsed);
      setCollapsedBlocks(preCollapseStateRef.current.collapsedBlocks);
      preCollapseStateRef.current = null;
    }
  }, [draggedBlockIndex, dragOverBlockIndex, blocks, currentBlockIndex]);

  // Identity-stable wrappers around the drag handlers and the ⋮ menu builder,
  // for the grip/menu that now live inside the memoized ExerciseCard header.
  // The card's memo comparator ignores function props, so these must never
  // change identity while always calling the freshest logic (latest-ref
  // pattern). The reorder/collapse logic itself is untouched.
  const gripHandlersRef = useRef({
    start: handleBlockLongPressStart,
    end: handleBlockLongPressEnd,
    drop: handleBlockDragEnd,
  });
  gripHandlersRef.current = {
    start: handleBlockLongPressStart,
    end: handleBlockLongPressEnd,
    drop: handleBlockDragEnd,
  };
  const handleGripDragStart = useCallback((index: number, clientY: number) => {
    gripHandlersRef.current.start(index, clientY);
  }, []);
  const handleGripDragEnd = useCallback(() => {
    gripHandlersRef.current.end();
    void gripHandlersRef.current.drop();
  }, []);
  const handleGripDragCancel = useCallback(() => {
    gripHandlersRef.current.end();
  }, []);

  // buildRowMenuItems is defined later in the render body (it reads
  // render-scope helpers); the ref is (re)assigned right after its definition.
  const rowMenuItemsBuilderRef = useRef<((index: number) => RowMenuItem[]) | null>(null);
  const getRowMenuItems = useCallback(
    (index: number) => rowMenuItemsBuilderRef.current?.(index) ?? [],
    []
  );

  // Document-level touch/mouse event listeners for drag
  useEffect(() => {
    if (!isDraggingBlock) return;

    const handleDocumentMove = (clientY: number) => {
      if (!isDraggingBlockRef.current || draggedBlockIndexRef.current === null) return;

      // Update floating preview position - use touch offset to keep preview under finger
      if (draggedBlockRectRef.current) {
        setDragPosition({
          x: draggedBlockRectRef.current.left,
          y: clientY - dragTouchOffsetRef.current
        });
      }

      // Calculate which position the item would drop at (attribute-based:
      // DOM order can differ from block order with the "Up next" section)
      if (!exerciseListRef.current) return;
      const listItems = exerciseListRef.current.querySelectorAll('[data-block-index]');
      let targetIndex = draggedBlockIndexRef.current;

      for (let i = 0; i < listItems.length; i++) {
        const item = listItems[i] as HTMLElement;
        const itemIndex = Number(item.dataset.blockIndex);
        if (Number.isNaN(itemIndex)) continue;
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (clientY < midY) {
          targetIndex = itemIndex;
          break;
        }
        targetIndex = itemIndex + 1;
      }

      // Clamp to valid range
      targetIndex = Math.max(0, Math.min(targetIndex, blocks.length - 1));

      if (targetIndex !== draggedBlockIndexRef.current) {
        setDragOverBlockIndex(targetIndex);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleDocumentMove(e.touches[0].clientY);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleDocumentMove(e.clientY);
    };

    const handleTouchEnd = () => {
      handleBlockDragEnd();
    };

    const handleMouseUp = () => {
      handleBlockDragEnd();
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingBlock, blocks.length, handleBlockDragEnd]);

  const handleExerciseSwap = async (blockId: string, newExercise: Exercise) => {
    // Capture original exercise info before swap for override tracking
    const originalBlock = blocks.find(b => b.id === blockId);

    try {
      const supabase = createUntypedClient();

      // Fetch full exercise data from database (for hypertrophy scores, equipment, etc.)
      const { data: fullExerciseData, error: fetchError } = await supabase
        .from('exercises')
        .select('*')
        .eq('id', newExercise.id)
        .single();
      
      if (fetchError || !fullExerciseData) {
        console.error('Failed to fetch exercise data:', fetchError);
        // Fall back to the passed exercise data
        setBlocks(prevBlocks => prevBlocks.map(block => 
          block.id === blockId 
            ? { ...block, exerciseId: newExercise.id, exercise: newExercise }
            : block
        ));
      } else {
        // Create complete exercise object with all fields
        const completeExercise: Exercise = {
          id: fullExerciseData.id,
          name: fullExerciseData.name,
          primaryMuscle: fullExerciseData.primary_muscle,
          secondaryMuscles: fullExerciseData.secondary_muscles || [],
          mechanic: fullExerciseData.mechanic,
          defaultRepRange: fullExerciseData.default_rep_range || [8, 12],
          defaultRir: fullExerciseData.default_rir || 2,
          minWeightIncrementKg: fullExerciseData.min_weight_increment_kg || 2.5,
          formCues: fullExerciseData.form_cues || [],
          commonMistakes: fullExerciseData.common_mistakes || [],
          setupNote: fullExerciseData.setup_note || '',
          movementPattern: fullExerciseData.movement_pattern || '',
          equipmentRequired: fullExerciseData.equipment_required || [],
          hypertrophyScore: fullExerciseData.hypertrophy_tier ? {
            tier: fullExerciseData.hypertrophy_tier,
            stretchUnderLoad: fullExerciseData.stretch_under_load || 3,
            resistanceProfile: fullExerciseData.resistance_profile || 3,
            progressionEase: fullExerciseData.progression_ease || 3,
          } : undefined,
          // Exercise type for duration-based exercises (planks, holds)
          exerciseType: fullExerciseData.exercise_type as ExerciseType | undefined,
        };

        // Update local state with complete exercise data
        setBlocks(prevBlocks => prevBlocks.map(block =>
          block.id === blockId
            ? { ...block, exerciseId: completeExercise.id!, exercise: completeExercise }
            : block
        ));
      }

      // Update in database
      const { error: updateError } = await supabase
        .from('exercise_blocks')
        .update({ exercise_id: newExercise.id })
        .eq('id', blockId);

      if (updateError) {
        console.error('Failed to swap exercise:', updateError);
        setError(`Failed to swap exercise: ${updateError.message}`);
      } else {
        setError(null);

        // Save exercise override to mesocycle for future sessions
        if (session?.mesocycleId && originalBlock) {
          try {
            // Fetch current mesocycle overrides
            const { data: mesocycle } = await supabase
              .from('mesocycles')
              .select('exercise_overrides')
              .eq('id', session.mesocycleId)
              .single();

            const currentOverrides = (mesocycle?.exercise_overrides || []) as ExerciseOverride[];
            const updatedOverrides = addExerciseOverride(
              currentOverrides,
              originalBlock.exerciseId,
              originalBlock.exercise.name,
              newExercise.id!,
              newExercise.name
            );

            // Save updated overrides
            await supabase
              .from('mesocycles')
              .update({ exercise_overrides: updatedOverrides })
              .eq('id', session.mesocycleId);
          } catch (overrideErr) {
            // Don't fail the swap if override save fails
            console.error('Failed to save exercise override:', overrideErr);
          }
        }
      }
    } catch (err) {
      console.error('Failed to swap exercise:', err);
      setError(err instanceof Error ? err.message : 'Failed to swap exercise');
    }
  };

  // Handle deleting an exercise from the workout
  const handleExerciseDelete = async (blockId: string) => {
    // Find the exercise name for the toast message
    const blockToDelete = blocks.find(b => b.id === blockId);
    const exerciseName = blockToDelete?.exercise.name || 'Exercise';

    try {
      const supabase = createUntypedClient();

      // First delete any set logs for this block
      // Note: This is redundant since we have ON DELETE CASCADE, but kept for safety
      const { error: setsError } = await supabase
        .from('set_logs')
        .delete()
        .eq('exercise_block_id', blockId);

      if (setsError) {
        console.error('Failed to delete set logs:', setsError);
        // Don't fail the operation - cascade delete will handle it
      }

      // Then delete the exercise block
      const { error: blockError } = await supabase
        .from('exercise_blocks')
        .delete()
        .eq('id', blockId);

      if (blockError) {
        console.error('Failed to delete exercise block:', blockError);
        showError(`Failed to remove ${exerciseName}: ${blockError.message}`);
        setError(`Failed to delete exercise: ${blockError.message}`);
        return;
      }

      // Update local state - remove the block and update set logs
      setBlocks(prevBlocks => {
        const newBlocks = prevBlocks.filter(b => b.id !== blockId);
        // Adjust current block index if needed
        if (currentBlockIndex >= newBlocks.length) {
          setCurrentBlockIndex(Math.max(0, newBlocks.length - 1));
        }
        return newBlocks;
      });

      setCompletedSets(prevSets => prevSets.filter(s => s.exerciseBlockId !== blockId));
      setError(null);
      showSuccess(`${exerciseName} removed from workout`);

    } catch (err) {
      console.error('Failed to delete exercise:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete exercise';
      showError(`Failed to remove ${exerciseName}: ${errorMessage}`);
      setError(errorMessage);
    }
  };

  // Toggle superset between two adjacent exercises
  const toggleSuperset = async (blockIndex: number) => {
    if (blockIndex >= blocks.length - 1) return;
    
    const block1 = blocks[blockIndex];
    const block2 = blocks[blockIndex + 1];
    
    // Check if they're already in a superset together
    const areSupersetted = block1.supersetGroupId && block1.supersetGroupId === block2.supersetGroupId;
    
    try {
      const supabase = createUntypedClient();
      
      if (areSupersetted) {
        // Remove superset - clear both blocks' superset fields
        await supabase
          .from('exercise_blocks')
          .update({ superset_group_id: null, superset_order: null })
          .in('id', [block1.id, block2.id]);
        
        // Update local state
        setBlocks(prevBlocks => prevBlocks.map(b => 
          b.id === block1.id || b.id === block2.id
            ? { ...b, supersetGroupId: null, supersetOrder: null }
            : b
        ));
      } else {
        // Create superset - generate a new group ID
        const newGroupId = crypto.randomUUID();
        
        await supabase
          .from('exercise_blocks')
          .update({ superset_group_id: newGroupId, superset_order: 1 })
          .eq('id', block1.id);
        
        await supabase
          .from('exercise_blocks')
          .update({ superset_group_id: newGroupId, superset_order: 2 })
          .eq('id', block2.id);
        
        // Update local state
        setBlocks(prevBlocks => prevBlocks.map(b => {
          if (b.id === block1.id) return { ...b, supersetGroupId: newGroupId, supersetOrder: 1 };
          if (b.id === block2.id) return { ...b, supersetGroupId: newGroupId, supersetOrder: 2 };
          return b;
        }));
      }
    } catch (err) {
      console.error('Failed to toggle superset:', err);
      setError('Failed to toggle superset');
    }
  };

  // Dissolve an entire superset cluster by its group id. Mirrors the unlink
  // branch of toggleSuperset (same columns nulled, same DB shape) but selects
  // by group rather than by two adjacent ids, so "Unlink from superset" works
  // from any member even if a drag-reorder left the pair non-adjacent.
  const unlinkSupersetGroup = async (groupId: string) => {
    if (!groupId) return;
    const memberIds = blocks.filter((b) => b.supersetGroupId === groupId).map((b) => b.id);
    if (memberIds.length === 0) return;

    setBlocks((prevBlocks) =>
      prevBlocks.map((b) =>
        b.supersetGroupId === groupId
          ? { ...b, supersetGroupId: null, supersetOrder: null }
          : b
      )
    );

    try {
      const supabase = createUntypedClient();
      await supabase
        .from('exercise_blocks')
        .update({ superset_group_id: null, superset_order: null })
        .in('id', memberIds);
    } catch (err) {
      console.error('Failed to unlink superset:', err);
      setError('Failed to unlink superset');
    }
  };

  const handleNextExercise = () => {
    // Advance to the next non-skipped block
    const nextIndex = blocks.findIndex(
      (b, i) => i > currentBlockIndex && !skippedBlockIds.has(b.id)
    );
    if (nextIndex !== -1) {
      setCurrentBlockIndex(nextIndex);
      setCurrentSetNumber(1);
      // Clear AMRAP accepted state when changing blocks
      setAmrapAcceptedBlockId(null);
      // Keep rest timer running - need rest between sets even when switching exercises
    }
  };

  // "Skip today" on an up-next row: persist skipped_at on the block; the block
  // stays on the session (undoable) but is excluded from progress, summary,
  // and progression/feedback derivations.
  const handleSkipBlock = async (blockId: string) => {
    setSkippedBlockIds((prev) => {
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });
    try {
      const supabase = createUntypedClient();
      const { error: skipError } = await supabase
        .from('exercise_blocks')
        .update({ skipped_at: new Date().toISOString() })
        .eq('id', blockId);
      if (skipError) throw skipError;
    } catch (err) {
      console.error('Failed to skip exercise:', err);
      setSkippedBlockIds((prev) => {
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
      showError('Could not skip the exercise. Please try again.');
    }
  };

  const handleUnskipBlock = async (blockId: string) => {
    setSkippedBlockIds((prev) => {
      const next = new Set(prev);
      next.delete(blockId);
      return next;
    });
    try {
      const supabase = createUntypedClient();
      const { error: unskipError } = await supabase
        .from('exercise_blocks')
        .update({ skipped_at: null })
        .eq('id', blockId);
      if (unskipError) throw unskipError;
    } catch (err) {
      console.error('Failed to restore exercise:', err);
      setSkippedBlockIds((prev) => {
        const next = new Set(prev);
        next.add(blockId);
        return next;
      });
      showError('Could not restore the exercise. Please try again.');
    }
  };

  // Fetch exercises when add exercise modal opens
  const fetchExercises = async (muscle?: string) => {
    const supabase = createUntypedClient();
    let query = supabase
      .from('exercises')
      .select('id, name, primary_muscle, secondary_muscles, movement_pattern, mechanic, equipment_required, equipment_class, default_rep_range, default_rir, is_bodyweight, hypertrophy_tier')
      .is('deleted_at', null) // hide merge-soft-deleted duplicates
      .order('name');

    if (muscle) {
      query = query.eq('primary_muscle', muscle);
    }

    const { data } = await query;
    if (data) {
      setAvailableExercises(data);
    }
  };

  // Top-tier staple exercises per muscle group, surfaced in the collapsed
  // picker view even for users with no training history.
  const stapleExerciseIds = useMemo(
    () => computeStapleExerciseIds(
      availableExercises.map((ex) => ({ id: ex.id, muscle: ex.primary_muscle, tier: ex.hypertrophy_tier }))
    ),
    [availableExercises]
  );

  // Re-collapse the long tail whenever the muscle filter changes, so each
  // body-part view starts from the curated default.
  useEffect(() => {
    setShowAllExercises(false);
  }, [selectedMuscleFilter]);

  // Preload the exercise library while the workout is empty so the
  // quick-add chips on the empty state can resolve names immediately.
  useEffect(() => {
    if (phase === 'workout' && blocks.length === 0 && availableExercises.length === 0) {
      fetchExercises();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, blocks.length, availableExercises.length]);

  // Most-used exercises (last 90 days) for the empty-state quick-add chips
  const quickAddExercises = useMemo(() => {
    if (availableExercises.length === 0 || frequentExerciseIds.size === 0) return [];
    const byId = new Map(availableExercises.map((ex) => [ex.id, ex]));
    return Array.from(frequentExerciseIds.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter((ex): ex is AvailableExercise => Boolean(ex))
      .slice(0, 8);
  }, [availableExercises, frequentExerciseIds]);

  const handleOpenAddExercise = () => {
    setShowAddExercise(true);
    setShowAllExercises(false);
    fetchExercises();
  };

  const handleMuscleFilter = (muscle: string) => {
    setSelectedMuscle(muscle);
    if (muscle) {
      fetchExercises(muscle);
    } else {
      fetchExercises();
    }
  };

  // `addedEarlierInBatch` carries exercises already added by a multi-add loop
  // (select-multiple modal, copy-last-workout) — `blocks` in this closure is
  // stale for the whole batch, so warmup logic must also consider them.
  const handleAddExercise = async (
    exercise: AvailableExercise,
    addedEarlierInBatch: AvailableExercise[] = []
  ) => {
    setIsAddingExercise(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const isCompound = exercise.mechanic === 'compound';

      // Use exercise's configured defaults, with sensible fallbacks based on mechanic type
      const exerciseRepRange = exercise.default_rep_range || (isCompound ? [6, 10] : [10, 15]) as [number, number];
      const exerciseRir = exercise.default_rir ?? 2;

      // Get weight recommendation for the new exercise. Duration exercises
      // (seconds in the reps field) never get an e1RM/bodyweight-heuristic
      // load estimate — the engine seeds from logged history only.
      const addedIsDuration =
        (exercise as { exercise_type?: string | null }).exercise_type === 'duration_based';
      let suggestedWeight = 0;
      if (addedIsDuration) {
        console.warn(
          `[workout] ${exercise.name} is duration-based — skipping cold-start load estimation; the time range is the prescription.`
        );
      }
      if (userProfile && session?.userId) {
        const repRange = { min: exerciseRepRange[0], max: exerciseRepRange[1] };
        const targetRir = exerciseRir;
        let weightRec: WorkingWeightRecommendation | undefined;

        // Check if we have exercise history for this exercise (using exercise.id)
        // If not in cache, fetch it from the database (for exercises added mid-workout)
        let exerciseHistory: ExerciseHistoryData | undefined = exerciseHistories[exercise.id];
        if (!exerciseHistory) {
          // Fetch history for this exercise since it wasn't in the original
          // query — location-scoped for local-scope exercises when the session
          // has a known location.
          const addedScope = deriveProgressionScope({
            equipmentRequired: (exercise as { equipment_required?: string[] | null }).equipment_required,
            isBodyweight: (exercise as { is_bodyweight?: boolean | null }).is_bodyweight,
            name: exercise.name,
            scopeOverride:
              (exercise as { progression_scope_override?: ProgressionScope | null })
                .progression_scope_override ?? null,
          });
          const fetchedHistory = await fetchExerciseHistory(
            exercise.id,
            session.userId,
            sessionLocationId
              ? { progressionScope: addedScope, currentLocationId: sessionLocationId }
              : undefined,
            (exercise as { exercise_type?: ExerciseType | null }).exercise_type ?? undefined
          );
          exerciseHistory = fetchedHistory ?? undefined;

          // Cache the result for future use (even if null, to avoid re-fetching)
          if (exerciseHistory) {
            setExerciseHistories(prev => ({
              ...prev,
              [exercise.id]: exerciseHistory!,
            }));
          }
        }
        const knownE1RM = exerciseHistory?.estimatedE1RM;

        // Duration exercise: seed the load from last session if any; never
        // from the e1RM/bodyweight-heuristic estimator.
        if (addedIsDuration) {
          const lastSet = exerciseHistory?.lastWorkoutSets?.[0];
          suggestedWeight = lastSet?.weightKg ?? 0;
          // Fall through to the warmup/insert logic below with the seeded (or
          // zero) load — zero renders as "find a challenging load" in the card.
        }

        // Cold-start transfer inputs: no direct history → seed from a related
        // logged exercise's e1RM before profile heuristics.
        const estimateOpts = {
          transferCandidates,
          targetMeta: {
            primaryMuscle: exercise.primary_muscle,
            movementPattern: exercise.movement_pattern,
            equipmentRequired: exercise.equipment_required,
          },
        };

        // Use calibration data if available
        if (addedIsDuration) {
          // handled above — no estimator call
        } else if (userProfile.calibratedLifts && userProfile.calibratedLifts.length > 0) {
          weightRec = quickWeightEstimateWithCalibration(
            exercise.name,
            repRange,
            targetRir,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent,
            userProfile.experience,
            userProfile.calibratedLifts,
            userProfile.regionalData,
            preferences.units,
            knownE1RM,
            estimateOpts
          );
        } else {
          weightRec = quickWeightEstimate(
            exercise.name,
            repRange,
            targetRir,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent,
            userProfile.experience,
            userProfile.regionalData,
            preferences.units,
            knownE1RM,
            estimateOpts
          );
        }

        if (weightRec && weightRec.confidence !== 'find_working_weight') {
          // recommendedWeight is in display units (kg or lb based on user preference)
          // Convert back to kg for storage since target_weight_kg expects kg
          suggestedWeight = inputWeightToKg(weightRec.recommendedWeight, preferences.units);
        }
      }

      // Check if this is the first exercise for this muscle group in the
      // workout, or if the muscle is already warm from completed sets
      // (including working sets that hit it as a secondary muscle)
      const muscleAlreadyWarmedUp = blocks.some(
        block => muscleMatchesGroup(block.exercise.primaryMuscle, exercise.primary_muscle)
      ) || addedEarlierInBatch.some(
        prev => muscleMatchesGroup(prev.primary_muscle, exercise.primary_muscle)
      ) || isMuscleWarmedUp(exercise.primary_muscle, { completedSets, blocks });
      
      // Generate warmup for first exercise of each muscle group (compound or isolation)
      // If starting with an isolation, you still need warmups for that muscle group
      const shouldWarmup = !muscleAlreadyWarmedUp;
      const workingWeight = suggestedWeight > 0 ? suggestedWeight : 60;
      const warmupSets = shouldWarmup ? generateWarmupProtocol({
        workingWeight,
        exercise: {
          id: exercise.id,
          name: exercise.name,
          primaryMuscle: exercise.primary_muscle,
          secondaryMuscles: [],
          mechanic: exercise.mechanic,
          defaultRepRange: exerciseRepRange,
          defaultRir: exerciseRir,
          minWeightIncrementKg: 2.5,
          formCues: [],
          commonMistakes: [],
          setupNote: '',
          movementPattern: '',
          equipmentRequired: exercise.equipment_required || [],
        },
        isFirstExercise: blocks.length === 0 && addedEarlierInBatch.length === 0, // First exercise overall gets general warmup
      }) : [];

      // Get max order from database to avoid duplicate key error
      const { data: maxOrderResult } = await supabase
        .from('exercise_blocks')
        .select('order')
        .eq('workout_session_id', sessionId)
        .order('order', { ascending: false })
        .limit(1)
        .single();
      
      const maxExistingOrder = maxOrderResult?.order || 0;
      const newOrder = maxExistingOrder + 1;

      const { data: newBlock, error: blockError } = await supabase
        .from('exercise_blocks')
        .insert({
          workout_session_id: sessionId,
          exercise_id: exercise.id,
          order: newOrder,
          target_sets: isCompound ? 4 : 3,
          target_rep_range: exerciseRepRange,
          target_rir: exerciseRir,
          target_weight_kg: suggestedWeight,
          target_rest_seconds: isCompound ? 180 : 90,
          suggestion_reason: suggestedWeight > 0 ? `Added mid-workout • Suggested ${formatWeight(suggestedWeight, preferences.units)}` : 'Added mid-workout',
          warmup_protocol: { sets: warmupSets },
        })
        .select()
        .single();

      if (blockError) {
        throw new Error(`Failed to create exercise block: ${blockError.message}`);
      }
      
      if (!newBlock) {
        throw new Error('No data returned after creating exercise block');
      }

      // Fetch full exercise data
      const { data: exerciseData, error: exerciseError } = await supabase
        .from('exercises')
        .select('*')
        .eq('id', exercise.id)
        .single();

      if (exerciseError || !exerciseData) {
        throw new Error(`Failed to fetch exercise data: ${exerciseError?.message || 'Not found'}`);
      }

      // Add to blocks state with suggested weight
      const newBlockWithExercise: ExerciseBlockWithExercise = {
        id: newBlock.id,
        workoutSessionId: newBlock.workout_session_id,
        exerciseId: newBlock.exercise_id,
        order: newBlock.order,
        supersetGroupId: null,
        supersetOrder: null,
        targetSets: newBlock.target_sets,
        targetRepRange: newBlock.target_rep_range,
        targetRir: newBlock.target_rir,
        targetWeightKg: suggestedWeight,  // Use the calculated suggested weight
        targetRestSeconds: newBlock.target_rest_seconds,
        progressionType: null,
        suggestionReason: newBlock.suggestion_reason,
        warmupProtocol: warmupSets,
        note: null,
        dropsetsPerSet: newBlock.dropsets_per_set ?? 0,
        dropPercentage: newBlock.drop_percentage ?? 0.25,
        exercise: {
          id: exerciseData.id,
          name: exerciseData.name,
          primaryMuscle: exerciseData.primary_muscle,
          secondaryMuscles: exerciseData.secondary_muscles || [],
          mechanic: exerciseData.mechanic,
          defaultRepRange: exerciseData.default_rep_range || [8, 12],
          defaultRir: exerciseData.default_rir || 2,
          minWeightIncrementKg: exerciseData.min_weight_increment_kg || 2.5,
          formCues: exerciseData.form_cues || [],
          commonMistakes: exerciseData.common_mistakes || [],
          setupNote: exerciseData.setup_note || '',
          movementPattern: exerciseData.movement_pattern || '',
          equipmentRequired: exerciseData.equipment_required || [],
          // Exercise type for duration-based exercises (planks, holds)
          exerciseType: exerciseData.exercise_type as ExerciseType | undefined,
        },
      };

      setBlocks(prevBlocks => [...prevBlocks, newBlockWithExercise]);
      setExerciseSearch('');
      setSelectedMuscle('');

      // Navigate to the new exercise and reset set number to 1 (new block has no sets)
      setCurrentBlockIndex(blocks.length);
      setCurrentSetNumber(1);
    } catch (err) {
      console.error('Failed to add exercise:', err);
      setError(err instanceof Error ? err.message : 'Failed to add exercise');
    } finally {
      setIsAddingExercise(false);
    }
  };

  // Toggle exercise selection for multi-add
  const toggleExerciseSelection = (exercise: AvailableExercise) => {
    setSelectedExercisesToAdd(prev => {
      const isSelected = prev.some(e => e.id === exercise.id);
      if (isSelected) {
        return prev.filter(e => e.id !== exercise.id);
      } else {
        return [...prev, exercise];
      }
    });
  };

  // Add all selected exercises
  const handleAddSelectedExercises = async () => {
    if (selectedExercisesToAdd.length === 0) return;
    
    setIsAddingExercise(true);
    
    // Add exercises one by one, tracking what's been added so warmup logic
    // doesn't treat every exercise in the batch as the first of its muscle
    const addedSoFar: AvailableExercise[] = [];
    for (const exercise of selectedExercisesToAdd) {
      await handleAddExercise(exercise, addedSoFar);
      addedSoFar.push(exercise);
    }
    
    // Clear selections and close modal
    setSelectedExercisesToAdd([]);
    setShowAddExercise(false);
    setShowMuscleDropdown(false);
    setSelectedMuscleFilter(null);
    setSelectedEquipmentGroups([]);
    setExerciseSearch('');
    setIsAddingExercise(false);
  };

  // Empty-state shortcut: copy the exercises from the user's most recent
  // completed workout into this session (skipped blocks excluded).
  const handleCopyLastWorkout = async () => {
    if (isCopyingLastWorkout || isAddingExercise) return;
    setIsCopyingLastWorkout(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      // Local session read — getUser() hits the network and reads a blip as
      // "logged out"; RLS still enforces the token on the queries themselves.
      const userId = await getLocalUserId(supabase);
      if (!userId) throw new Error('Not signed in');

      // Most recently completed session other than this one
      const { data: lastSession, error: lastSessionError } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .neq('id', sessionId)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSessionError) throw lastSessionError;
      if (!lastSession) {
        showError('No previous workout found to copy.');
        return;
      }

      const { data: lastBlocks, error: lastBlocksError } = await supabase
        .from('exercise_blocks')
        .select('exercise_id, order, exercises(id, name, primary_muscle, mechanic, equipment_required, default_rep_range, default_rir, is_bodyweight)')
        .eq('workout_session_id', lastSession.id)
        .is('skipped_at', null)
        .order('order', { ascending: true });

      if (lastBlocksError) throw lastBlocksError;

      const seenExerciseIds = new Set<string>();
      const exercisesToAdd: AvailableExercise[] = [];
      for (const block of lastBlocks ?? []) {
        // Supabase returns the joined row as an object for many-to-one FKs,
        // but the untyped client can surface it as a single-element array.
        const joined = Array.isArray(block.exercises) ? block.exercises[0] : block.exercises;
        if (!joined || seenExerciseIds.has(joined.id)) continue;
        seenExerciseIds.add(joined.id);
        exercisesToAdd.push(joined as AvailableExercise);
      }

      if (exercisesToAdd.length === 0) {
        showError('Your last workout had no exercises to copy.');
        return;
      }

      const addedSoFar: AvailableExercise[] = [];
      for (const exercise of exercisesToAdd) {
        await handleAddExercise(exercise, addedSoFar);
        addedSoFar.push(exercise);
      }
    } catch (err) {
      console.error('Failed to copy last workout:', err);
      showError('Could not copy your last workout. Please try again.');
    } finally {
      setIsCopyingLastWorkout(false);
    }
  };

  // Close modal and clear selections
  const handleCloseAddExerciseModal = () => {
    setShowAddExercise(false);
    setShowMuscleDropdown(false);
    setSelectedExercisesToAdd([]);
    setSelectedMuscleFilter(null);
    setSelectedEquipmentGroups([]);
    setExerciseSearch('');
  };

  // Handle custom exercise creation success
  const handleCustomExerciseSuccess = async (exerciseId: string) => {
    try {
      // Fetch the newly created exercise
      const supabase = createUntypedClient();
      const { data: newExercise, error } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, mechanic, default_rep_range, default_rir')
        .eq('id', exerciseId)
        .single();

      if (error || !newExercise) {
        throw new Error('Failed to fetch created exercise');
      }

      // Add it to the available exercises list
      setAvailableExercises(prev => [...prev, {
        id: newExercise.id,
        name: newExercise.name,
        primary_muscle: newExercise.primary_muscle,
        secondary_muscles: newExercise.secondary_muscles || [],
        mechanic: newExercise.mechanic,
        default_rep_range: newExercise.default_rep_range,
        default_rir: newExercise.default_rir,
      }]);

      if (customSwapBlockId) {
        // Created from a swap flow: replace the target block instead of adding.
        // handleExerciseSwap refetches the full exercise row, so a minimal
        // Exercise shape is enough here.
        const swappedOut = blocks.find(b => b.id === customSwapBlockId)?.exercise.name;
        await handleExerciseSwap(customSwapBlockId, {
          id: newExercise.id,
          name: newExercise.name,
          primaryMuscle: newExercise.primary_muscle,
          secondaryMuscles: newExercise.secondary_muscles || [],
          mechanic: newExercise.mechanic,
          defaultRepRange: newExercise.default_rep_range || [8, 12],
          defaultRir: newExercise.default_rir ?? 2,
          minWeightIncrementKg: 2.5,
          formCues: [],
          commonMistakes: [],
          setupNote: '',
          movementPattern: '',
          equipmentRequired: [],
        });
        setShowSwapForInjury(null);
        setCustomSwapBlockId(null);
        setShowCustomExercise(false);
        if (swappedOut) {
          setAutoAdjustMessage(`✓ Swapped ${swappedOut} → ${newExercise.name}`);
          setTimeout(() => setAutoAdjustMessage(null), 5000);
        }
        return;
      }

      // Now add it to the workout
      await handleAddExercise({
        id: newExercise.id,
        name: newExercise.name,
        primary_muscle: newExercise.primary_muscle,
        secondary_muscles: newExercise.secondary_muscles || [],
        mechanic: newExercise.mechanic,
        default_rep_range: newExercise.default_rep_range,
        default_rir: newExercise.default_rir,
      });

      // Close the custom exercise modal and the underlying add-exercise
      // picker so the user returns straight to the workout.
      setShowCustomExercise(false);
      setShowAddExercise(false);
      setShowMuscleDropdown(false);
      setSelectedExercisesToAdd([]);
      setSelectedMuscleFilter(null);
      setSelectedEquipmentGroups([]);
      setExerciseSearch('');
    } catch (err) {
      console.error('Failed to add custom exercise to workout:', err);
      setError(err instanceof Error ? err.message : 'Failed to add exercise to workout');
    }
  };

  // B1: when an ad-hoc workout reaches the summary, check whether it matches
  // the active mesocycle's next pending session. A match arms the
  // count-toward-mesocycle prompt shown after the summary is submitted.
  // Ref-guarded to run the queries once per visit; if the check is still in
  // flight when the user taps Finish, they just navigate as before (no prompt).
  const claimCheckStarted = useRef(false);
  useEffect(() => {
    if (phase !== 'summary' || claimCheckStarted.current) return;
    if (!session || session.mesocycleId) return;
    if (session.state === 'completed' && session.completedAt) return; // viewing history
    claimCheckStarted.current = true;

    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data: mesoRows } = await supabase
          .from('mesocycles')
          .select('id, days_per_week, current_week, total_weeks, program_data, exercise_overrides')
          .eq('user_id', session.userId)
          .or('is_active.eq.true,state.eq.active')
          .order('created_at', { ascending: false })
          .limit(1);
        const meso = mesoRows?.[0];
        if (!meso) return;

        const completed = await countCompletedSessions(supabase, meso.id);
        const programSession = getSessionFromProgramData(
          meso.program_data,
          sessionIndexFromCompleted(completed, meso.days_per_week),
          meso.current_week,
          meso.total_weeks
        );
        if (!programSession || programSession.exercises.length === 0) return;

        const planned = applyExerciseOverrides(
          programSession.exercises,
          (meso.exercise_overrides ?? []) as ExerciseOverride[]
        );
        const loggedBlockIds = new Set(
          completedSets.filter((s) => !s.isWarmup).map((s) => s.exerciseBlockId)
        );
        const logged = blocks
          .filter((b) => !skippedBlockIds.has(b.id) && loggedBlockIds.has(b.id))
          .map((b) => ({ name: b.exercise.name, primaryMuscle: b.exercise.primaryMuscle }));

        const match = matchAdhocToPlannedSession(logged, planned);
        if (match.isMatch) {
          setClaimCandidate({ mesocycleId: meso.id, dayName: programSession.dayName });
        }
      } catch (err) {
        // Non-fatal: without a candidate the finish flow behaves as before.
        console.error('Ad-hoc claim check failed:', err);
      }
    })();
  }, [phase, session, blocks, completedSets, skippedBlockIds]);

  // Finishing is easy to hit by accident (header + bottom bar) and the
  // summary screen has no way back, so always confirm first.
  const handleWorkoutComplete = () => {
    setShowFinishConfirm(true);
  };

  const confirmFinishWorkout = () => {
    setShowFinishConfirm(false);
    // Snapshot the duration ONCE, from the same elapsed value the header timer
    // has been showing (paused time already excluded). Frozen here so the
    // summary never re-derives a live, still-ticking duration.
    setFinishSnapshot({
      durationSeconds: workoutTimer.elapsedSeconds,
      completedAt: new Date().toISOString(),
    });
    setPhase('summary');
  };

  const handleCancelWorkout = async () => {
    if (!session) return;

    setIsCancelling(true);
    try {
      const supabase = createUntypedClient();

      const { errors } = await cancelWorkoutSession(supabase, {
        sessionId: session.id,
        mesocycleId: session.mesocycleId ?? null,
        blockIds: blocks.map(b => b.id),
      });
      if (errors.length > 0) {
        console.error('Cancel workout cleanup errors:', errors);
      }

      // Clear store state and navigate back to dashboard
      endWorkoutSession();
      router.push('/dashboard');
    } catch (err) {
      console.error('Failed to cancel workout:', err);
      setError('Failed to cancel workout. Please try again.');
    } finally {
      setIsCancelling(false);
      setShowCancelModal(false);
    }
  };

  // Optimistic finish (see _lib/finishWorkout): the completion + feedback
  // writes are queued in the durable outbox and the UI responds immediately
  // — the old flow awaited two timeout-less network round-trips here, which
  // froze the "Save & Finish" tap for 10-15s on a slow connection and LOST
  // the completion entirely when offline.
  const handleSummarySubmit = async (
    data: SessionSummarySubmitData,
    options?: { viewReport?: boolean }
  ) => {
    if (!session) {
      finishToDashboard();
      return;
    }

    // "Any joint issues today?" — record session-level pain events (no
    // exercise/set attribution). Best-effort; never blocks the finish flow.
    if (data.jointReport) {
      const severity = data.jointReport.severity === 'significant' ? 'pain' : 'twinge';
      const joints: JointPainJoint[] =
        data.jointReport.joints.length > 0 ? data.jointReport.joints : ['other'];
      const supabase = createUntypedClient();
      for (const joint of joints) {
        void insertJointPainEvent(supabase, {
          userId: session.userId,
          sessionId: session.id,
          joint,
          severity,
        });
      }
    }

    // B1: ad-hoc workout that matches the mesocycle's next pending session —
    // show the claim prompt instead of navigating (the queued writes sync in
    // the background while the user decides).
    const claimArmed = !session.mesocycleId && !!claimCandidate;
    if (claimArmed) setSubmittedSessionRpe(data.sessionRpe);

    await submitFinishOptimistic(
      {
        supabase: createUntypedClient(),
        sessionId,
        session,
        navigate: options?.viewReport ? () => finishToReport(data) : finishToDashboard,
        showClaimPrompt: claimArmed ? () => setShowClaimPrompt(true) : null,
        // Once the completion is visible in the DB, mark the cached-first
        // history/analytics queries stale — the SPA context survives the
        // navigate() above, so this runs ~a flush later and the History list
        // (24h staleTime) picks up the new session instead of serving the
        // pre-workout snapshot the calendar view has already moved past.
        onCompletionSynced: () => void invalidateWorkoutDerivedCaches(queryClient),
      },
      // Persist the same frozen duration the summary is showing.
      { ...data, durationSeconds: finishSnapshot?.durationSeconds ?? null }
    );
  };

  const finishToDashboard = () => {
    endWorkoutSession();
    router.push('/dashboard');
  };

  // "View full report →": finish exactly like Save & Finish, but stay on this
  // page — flipping the local session to completed re-renders the summary
  // phase as the read-only full report (the same view history links to).
  const finishToReport = (data: {
    sessionRpe: number;
    notes: string;
    isDeload: boolean;
  }) => {
    endWorkoutSession();
    setSession((prev) =>
      prev
        ? {
            ...prev,
            state: 'completed',
            completedAt: finishSnapshot?.completedAt ?? new Date().toISOString(),
            durationSeconds: finishSnapshot?.durationSeconds ?? prev.durationSeconds,
            sessionRpe: data.sessionRpe,
            sessionNotes: data.notes,
            isDeload: data.isDeload,
          }
        : prev
    );
  };

  // Toggle the deload flag mid-workout (from the header ⋮ menu). Durable +
  // optimistic: the header/banner reflect it immediately and the choice is
  // queued in the IndexedDB outbox — the same durable path the finish flow
  // uses for workout_sessions updates. We deliberately DON'T roll back the
  // local flag on a connectivity failure: a lifter who marks a deload offline
  // and finishes offline must keep it (the summary seeds from session.isDeload,
  // and the finish patch re-persists the same value), otherwise a light session
  // would silently leak back into PR/e1RM data. A stable entryId coalesces
  // repeated toggles to the latest value.
  const handleToggleDeloadSession = async () => {
    if (!session) return;
    const next = !session.isDeload;
    setSession((prev) => (prev ? { ...prev, isDeload: next } : prev));
    try {
      await enqueueRowUpdate(`deload:${sessionId}`, 'workout_sessions', sessionId, {
        is_deload: next,
      });
      // Best-effort immediate sync; if offline it stays queued and the existing
      // outbox flushers (dashboard mount / 'online' / page poll) push it later.
      void flushSetOutbox(createUntypedClient());
    } catch (err) {
      // Outbox unavailable (broken IndexedDB) — fall back to a direct write.
      // The local flag stays set regardless; the finish patch is the backstop.
      console.error('Failed to queue deload flag, attempting direct write:', err);
      void createUntypedClient()
        .from('workout_sessions')
        .update({ is_deload: next })
        .eq('id', sessionId)
        .then(({ error }: { error: unknown }) => {
          if (error) console.error('Direct deload flag write failed:', error);
        });
    }
  };

  const handleDeclineClaim = () => {
    setShowClaimPrompt(false);
    finishToDashboard();
  };

  // Count the completed ad-hoc session toward the mesocycle: link it via
  // mesocycle_id (session counting, week advancement, and weekly-rollover
  // feedback all key off that), then run the same post-session updates a
  // programmed session gets — they were skipped at finish because the
  // session had no mesocycle_id yet. Optimistic like the finish itself: the
  // link is queued durably and synced in the background, so the tap never
  // hangs on the network.
  const handleConfirmClaim = async () => {
    if (claimCandidate && session) {
      // Resolves once the claim is queued durably in IndexedDB (a few ms) —
      // the network sync stays in the background. Awaiting it closes the
      // kill-window between accepting the tap and persisting the claim.
      await confirmClaimOptimistic({
        supabase: createUntypedClient(),
        sessionId,
        session,
        mesocycleId: claimCandidate.mesocycleId,
        sessionRpe: submittedSessionRpe,
      });
    }
    setShowClaimPrompt(false);
    finishToDashboard();
  };

  if (phase === 'loading') {
    // Skeleton matching the workout layout instead of a full-screen spinner
    // (P2-16) — mirrors this route's loading.tsx so route-level and
    // in-page loading states look identical.
    return (
      <div className="max-w-2xl mx-auto space-y-4" aria-busy="true">
        <div className="animate-pulse py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-7 bg-surface-800 rounded w-40" />
              <div className="h-4 bg-surface-800 rounded w-28" />
            </div>
            <div className="h-11 w-24 bg-surface-800 rounded-lg" />
          </div>
        </div>
        <p className="text-sm text-surface-500">
          {fromCreate ? 'Starting workout…' : 'Loading workout…'}
        </p>
        <SkeletonExercise />
        <SkeletonExercise />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="max-w-lg mx-auto py-8">
        <Card className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-lg font-medium text-surface-200">Error Loading Workout</p>
          <p className="text-surface-500 mt-1">{error}</p>
          <Button className="mt-4" onClick={() => router.push('/dashboard/workout')}>
            Go Back
          </Button>
        </Card>
      </div>
    );
  }

  if (phase === 'summary' && session) {
    // Check if this is a previously completed workout (viewing from history)
    const isViewingCompleted = session.state === 'completed' && !!session.completedAt;
    
    // Build exercise histories for PR detection in summary
    const exerciseHistoriesForSummary = Object.entries(exerciseHistories).reduce((acc, [exerciseId, history]) => {
      acc[exerciseId] = {
        exerciseId,
        exerciseName: blocks.find(b => b.exerciseId === exerciseId)?.exercise?.name || 'Exercise',
        previousBest: history.personalRecord ? {
          weight: history.personalRecord.weightKg,
          reps: history.personalRecord.reps,
          e1rm: history.personalRecord.e1rm,
        } : undefined,
      };
      return acc;
    }, {} as Record<string, { exerciseId: string; exerciseName: string; previousBest?: { weight: number; reps: number; e1rm: number } }>);
    
    return (
      <div className="py-8">
        <SessionSummary
          session={isViewingCompleted ? session : {
            ...session,
            state: 'completed',
            // Frozen once at Finish — using Date.now() here would re-render a
            // new completion time every tick.
            completedAt: finishSnapshot?.completedAt ?? session.completedAt,
          }}
          exerciseBlocks={blocks.filter((b) => !skippedBlockIds.has(b.id))}
          skippedBlocks={blocks.filter((b) => skippedBlockIds.has(b.id))}
          allSets={completedSets}
          exerciseHistories={exerciseHistoriesForSummary}
          amrapCalibrations={sessionCalibrations}
          enhancedAthleteMode={enhancedAthleteModeActive}
          unit={preferences.units}
          durationSeconds={
            isViewingCompleted ? session.durationSeconds : finishSnapshot?.durationSeconds ?? null
          }
          onSubmit={isViewingCompleted ? undefined : handleSummarySubmit}
          onSaveAndViewReport={
            isViewingCompleted ? undefined : (data) => handleSummarySubmit(data, { viewReport: true })
          }
          initialMuscleRatings={rollUpExerciseFeedback(
            blocks
              .filter((b) => !skippedBlockIds.has(b.id))
              .flatMap((b) => {
                const muscle = resolvePrimaryMuscle(b.exercise?.primaryMuscle);
                return muscle
                  ? [{ muscle, pump: b.pump ?? null, workload: b.workload ?? null }]
                  : [];
              })
          )}
          readOnly={isViewingCompleted}
        />
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          {isViewingCompleted ? (
            <>
              <Button variant="outline" onClick={() => router.push('/dashboard/history')}>
                ← Back to History
              </Button>
              <Button variant="outline" onClick={() => setShowShareModal(true)}>
                Share Workout
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setShowShareModal(true)}>
              Share Workout
            </Button>
          )}
        </div>
        
        {/* Share Workout Modal */}
        <ShareWorkoutModal
          workoutSessionId={sessionId}
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          onSuccess={() => {
            setShowShareModal(false);
            // Optionally show success message or refresh
          }}
        />

        {/* B1: offer to count a matching ad-hoc workout toward the mesocycle */}
        <ConfirmModal
          isOpen={showClaimPrompt}
          onClose={handleDeclineClaim}
          onConfirm={handleConfirmClaim}
          title="Count toward your mesocycle?"
          message={`This workout looks like ${claimCandidate?.dayName ?? 'your next planned session'}. Counting it advances your program to the next session — otherwise it stays an extra workout.`}
          confirmText="Count it"
          cancelText="Keep as extra"
        />
      </div>
    );
  }

  // Empty workout - show standard header with add button (no extra page)
  if (!currentBlock || !currentExercise) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col min-h-[calc(100dvh-9rem)] pb-8">
        {/* Header: back chevron + title/timer on the left, Finish on the right */}
        <div className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur py-4 -mx-4 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => router.push('/dashboard/log')}
                aria-label="Minimize workout"
                title="Minimize workout"
                className="w-11 h-11 -ml-2 flex-shrink-0 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-surface-100">Workout</h1>
                <div className="flex items-center gap-1.5 text-surface-400 mt-0.5">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                  </svg>
                  <span className="tabular-nums">{workoutTimer.formattedTime}</span>
                  <span className="text-surface-600">·</span>
                  <span className="truncate">No exercises yet</span>
                </div>
              </div>
            </div>
            <button
              onClick={handleWorkoutComplete}
              className="flex-shrink-0 px-6 py-3 rounded-2xl bg-surface-800 text-surface-400 text-lg font-semibold hover:bg-surface-700 hover:text-surface-300 transition-colors"
            >
              Finish
            </button>
          </div>
        </div>

        {/* Primary action: add exercises */}
        <button
          onClick={handleOpenAddExercise}
          disabled={isAddingExercise || isCopyingLastWorkout}
          className="mt-6 w-full py-4 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-lg font-semibold shadow-lg shadow-purple-500/25 hover:from-purple-400 hover:to-indigo-500 active:scale-[0.99] disabled:opacity-60 transition-all flex items-center justify-center gap-2.5"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add exercises
        </button>

        {/* Inline readiness (between Add exercises and Quick Add) + the Quick
            Add chips re-ordered by readiness. Same read-only data path as the
            header's readiness sheet; collapses back to the icon-only entry
            point once the first exercise is added (this branch unmounts). */}
        <EmptyWorkoutReadiness
          quickAddExercises={quickAddExercises}
          onAddExercise={handleAddExercise}
          disabled={isAddingExercise || isCopyingLastWorkout}
        />

        {/* Alternative: copy the previous workout wholesale */}
        <button
          onClick={handleCopyLastWorkout}
          disabled={isAddingExercise || isCopyingLastWorkout}
          className="mt-10 mx-auto flex items-center gap-2 text-surface-400 hover:text-surface-200 font-medium disabled:opacity-50 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {isCopyingLastWorkout ? 'Copying last workout…' : 'Copy last workout instead'}
        </button>

        {/* Destructive escape hatch pinned to the bottom */}
        <button
          onClick={() => setShowCancelModal(true)}
          className="mt-auto pt-16 mx-auto text-danger-500 hover:text-danger-400 font-medium transition-colors"
        >
          Discard workout
        </button>

        {/* Add Exercise Modal */}
        {showAddExercise && (
          <AddExercisePicker
            variant="empty"
            availableExercises={availableExercises}
            exerciseSearch={exerciseSearch}
            onExerciseSearchChange={setExerciseSearch}
            selectedMuscleFilter={selectedMuscleFilter}
            onSelectedMuscleFilterChange={setSelectedMuscleFilter}
            selectedEquipmentGroups={selectedEquipmentGroups}
            onToggleEquipmentGroup={toggleEquipmentGroup}
            showMuscleDropdown={showMuscleDropdown}
            onShowMuscleDropdownChange={setShowMuscleDropdown}
            showSortDropdown={showSortDropdown}
            onShowSortDropdownChange={setShowSortDropdown}
            showLocationDropdown={showLocationDropdown}
            onShowLocationDropdownChange={setShowLocationDropdown}
            exerciseSortOption={exerciseSortOption}
            onExerciseSortOptionChange={setExerciseSortOption}
            showAllExercises={showAllExercises}
            onToggleShowAllExercises={() => setShowAllExercises((v) => !v)}
            gymLocations={gymLocations}
            selectedLocationFilter={selectedLocationFilter}
            onSelectedLocationFilterChange={setSelectedLocationFilter}
            unavailableEquipmentIds={locationUnavailableEquipmentIds}
            unavailableExerciseIds={unavailableExerciseIds}
            stapleExerciseIds={stapleExerciseIds}
            frequentExerciseIds={frequentExerciseIds}
            lastDoneExercises={lastDoneExercises}
            selectedExercisesToAdd={selectedExercisesToAdd}
            onToggleExerciseSelection={toggleExerciseSelection}
            isAddingExercise={isAddingExercise}
            onClose={handleCloseAddExerciseModal}
            onAddSelected={handleAddSelectedExercises}
          />
        )}

        {/* Cancel Workout confirmation — must exist in this branch too, or the
            header button above is a no-op on empty workouts (P0-1). */}
        {showCancelModal && (
          <CancelWorkoutModal
            totalCompletedSets={0}
            isCancelling={isCancelling}
            onKeepGoing={() => setShowCancelModal(false)}
            onConfirm={handleCancelWorkout}
          />
        )}

        {/* Finish confirmation — same early-return branch caveat as above */}
        <ConfirmModal
          isOpen={showFinishConfirm}
          onClose={() => setShowFinishConfirm(false)}
          onConfirm={confirmFinishWorkout}
          title="Finish Workout?"
          message="No sets have been logged yet. Finish anyway?"
          confirmText="Finish"
          cancelText="Keep Training"
          variant="warning"
        />
      </div>
    );
  }

  // Helper to get sets for a specific block
  const getSetsForBlock = (blockId: string) => completedSets.filter(s => s.exerciseBlockId === blockId && !s.isWarmup && s.setType !== 'warmup');

  // Check if a block is complete
  const isBlockComplete = (block: ExerciseBlockWithExercise) => {
    const blockSets = getSetsForBlock(block.id);
    return blockSets.length >= block.targetSets;
  };

  // Calculate overall workout progress (skipped blocks excluded)
  // Account for extra set being added - when user clicks "+ Add Set", we have a pending incomplete set
  const activeBlocks = blocks.filter(b => !skippedBlockIds.has(b.id));
  const pendingExtraSets = addingExtraSet ? 1 : 0;
  const totalPlannedSets = activeBlocks.reduce((sum, b) => sum + b.targetSets, 0) + pendingExtraSets;
  const totalCompletedSets = completedSets.filter(s => !s.isWarmup && s.setType !== 'warmup').length;
  const overallProgress = totalPlannedSets > 0 ? (totalCompletedSets / totalPlannedSets) * 100 : 0;

  // Header: workout label + per-exercise progress segments (skipped excluded)
  // Derived from activeBlocks (skipped excluded) so it matches the resume
  // pill, which is fed the same filtered block list via the store sync.
  const workoutLabel = deriveWorkoutLabel(activeBlocks.map(b => b.exercise.primaryMuscle));
  const headerSegments: ExerciseSegmentStatus[] = activeBlocks.map((b) =>
    isBlockComplete(b) ? 'completed' : b.id === currentBlock?.id ? 'active' : 'pending'
  );
  const currentExerciseNumber =
    Math.max(0, activeBlocks.findIndex((b) => b.id === currentBlock?.id)) + 1;

  // Up-next rows: non-active blocks with nothing logged yet (skipped ones
  // render greyed with an Undo). Everything else stays in the main list.
  const isBlockInMainList = (index: number) => {
    const b = blocks[index];
    if (!b) return false;
    return index === currentBlockIndex || getSetsForBlock(b.id).length > 0;
  };
  const upNextEntries = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ index }) => !isBlockInMainList(index));

  // Truncate an interpolated exercise name so the row menu keeps a fixed width.
  const truncateName = (s: string, n = 24) =>
    s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

  // Superset-cluster adjacency for a main-list row. A "cluster" is two adjacent
  // blocks sharing a supersetGroupId (v1 is pairs-only). If a drag-reorder left
  // the pair non-adjacent, neither side reports clustered — the row then renders
  // the degraded per-row indigo border instead of the continuous cluster chrome.
  const getClusterInfo = (index: number) => {
    const block = blocks[index];
    const group = block?.supersetGroupId ?? null;
    if (!group) {
      return { inGroup: false, clustered: false, isFirst: false, isLast: false, slot: null as string | null, restSeconds: 0 };
    }
    const prev = blocks[index - 1];
    const next = blocks[index + 1];
    const adjPrev = !!prev && prev.supersetGroupId === group;
    const adjNext = !!next && next.supersetGroupId === group;
    const clustered = adjPrev || adjNext;
    // Slot letter by list position among adjacent members (A above B), so a
    // drag that inverted supersetOrder never shows "B" above "A".
    const slot = clustered ? (adjPrev ? 'B' : 'A') : null;
    // Rest shown on the cluster header = the last member's per-set rest (the
    // round-robin rests after the last block of a round; see supersetFlow).
    const lastMember = adjNext ? next : block;
    return {
      inGroup: true,
      clustered,
      isFirst: clustered && !adjPrev,
      isLast: clustered && !adjNext,
      slot,
      restSeconds: lastMember.targetRestSeconds ?? 0,
    };
  };

  // Single overflow menu for a main-list row: the one most-relevant link/unlink
  // action (pairs-only rules), then Swap / Plate calculator / Watch form, then
  // the destructive Remove below a separator. Reuses the existing mutations
  // (toggleSuperset / unlinkSupersetGroup / page-level swap / delete-confirm).
  const buildRowMenuItems = (index: number): RowMenuItem[] => {
    const block = blocks[index];
    const items: RowMenuItem[] = [];

    // Exercise info sheet — formerly the ⓘ button in the card header (the
    // exercise name still opens the same sheet directly).
    items.push({
      key: 'info',
      label: 'Exercise info',
      icon: <IconInfoCircle size={16} className="text-surface-400" stroke={2} />,
      onSelect: () => setSelectedExerciseForDetails(block.exercise),
    });

    const inCluster = block.supersetGroupId !== null;
    const next = blocks[index + 1];
    const prev = blocks[index - 1];
    const nextInList = index + 1 < blocks.length && isBlockInMainList(index + 1);
    const prevInList = index - 1 >= 0 && isBlockInMainList(index - 1);
    const isLastMainRow = !blocks.some((b, i) => i > index && isBlockInMainList(i));

    const linkIcon = (
      <svg className="h-4 w-4 text-[#a99bff]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m8.656-4.328a4 4 0 015.656 5.656l-1.5 1.5" />
      </svg>
    );

    // Never show two link options — pick the single most relevant.
    if (inCluster) {
      items.push({
        key: 'unlink',
        label: 'Unlink from superset',
        icon: linkIcon,
        onSelect: () => { if (block.supersetGroupId) void unlinkSupersetGroup(block.supersetGroupId); },
      });
    } else if (nextInList && next && next.supersetGroupId === null) {
      items.push({
        key: 'link-next',
        label: `Link with ${truncateName(next.exercise.name)}`,
        icon: linkIcon,
        onSelect: () => void toggleSuperset(index),
      });
    } else if (isLastMainRow && prevInList && prev && prev.supersetGroupId === null) {
      items.push({
        key: 'link-prev',
        label: `Link with ${truncateName(prev.exercise.name)}`,
        icon: linkIcon,
        onSelect: () => void toggleSuperset(index - 1),
      });
    }

    items.push({
      key: 'swap',
      label: 'Swap exercise',
      icon: (
        <svg className="h-4 w-4 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
      onSelect: () => {
        setSwapTargetBlockId(block.id);
        setSwapSearchQuery('');
        if (availableExercises.length === 0) fetchExercises();
        setShowPageLevelSwapModal(true);
      },
    });

    items.push({
      key: 'plates',
      label: 'Plate calculator',
      icon: (
        <svg className="h-4 w-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
      onSelect: () => {
        const initial = block.targetWeightKg > 0 ? block.targetWeightKg : undefined;
        setPlateCalculatorWeight(initial);
        setShowPlateCalculator(true);
      },
    });

    items.push({
      key: 'watch',
      label: 'Watch form',
      icon: (
        <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      ),
      onSelect: () => {
        window.open(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(block.exercise.name + ' exercise form')}`,
          '_blank',
          'noopener,noreferrer'
        );
      },
    });

    items.push({
      key: 'remove',
      label: 'Remove',
      separatorBefore: true,
      destructive: true,
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onSelect: () => setDeleteConfirmBlock({ id: block.id, name: block.exercise.name }),
    });

    return items;
  };
  // Keep the stable getRowMenuItems wrapper (passed to the memoized
  // ExerciseCard) pointed at this render's builder.
  rowMenuItemsBuilderRef.current = buildRowMenuItems;

  // Expand a collapsed exercise row (collapse UI state only — session state is
  // untouched). Leaving collapse-all mode keeps every other exercise collapsed
  // so exactly the tapped row expands.
  const revealBlock = (blockId: string) => {
    if (allCollapsed) {
      setAllCollapsed(false);
      setCollapsedBlocks(new Set(blocks.filter((b) => b.id !== blockId).map((b) => b.id)));
    } else {
      setCollapsedBlocks((prev) => {
        if (!prev.has(blockId)) return prev;
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
    }
  };

  // Vertical shift applied to non-dragged rows while a drag is in flight
  const getDragTranslateY = (index: number, isBeingDragged: boolean): number => {
    if (!isDraggingBlock || draggedBlockIndex === null || dragOverBlockIndex === null || isBeingDragged) {
      return 0;
    }
    const itemHeight = 60; // Approximate height of a collapsed item
    if (draggedBlockIndex < dragOverBlockIndex) {
      // Dragging down: items between original and target shift up
      if (index > draggedBlockIndex && index <= dragOverBlockIndex) return -itemHeight;
    } else if (draggedBlockIndex > dragOverBlockIndex) {
      // Dragging up: items between target and original shift down
      if (index >= dragOverBlockIndex && index < draggedBlockIndex) return itemHeight;
    }
    return 0;
  };

  const restBarVisible = showRestTimer && !pendingDropset;
  // Any bottom-anchored chrome present → reserve room below the in-flow action
  // bar so the fixed stack never covers it. The toast can stack on top of the
  // timer, so when it's showing reserve the taller amount.
  const bottomChromeVisible = restBarVisible || !!sanityCheckResult;
  const bottomPad = sanityCheckResult ? 'pb-56' : restBarVisible ? 'pb-32' : 'pb-8';

  return (
    <div className={`max-w-2xl mx-auto space-y-6 ${bottomPad}`}>
      {/* Offline banner (P0-2): honest state — nothing is lost, writes queue */}
      {!isOnline && (
        <div
          className="flex items-center gap-2.5 rounded-xl border border-warning-500/45 bg-warning-500/10 px-4 py-2.5 text-[13px] text-warning-400"
          role="status"
        >
          <span aria-hidden="true">⚠</span>
          <span>
            You&rsquo;re offline — sets are saved on this phone and will sync automatically.
            {outboxSize > 0 && ` ${outboxSize} set${outboxSize !== 1 ? 's' : ''} queued.`}
          </span>
        </div>
      )}

      {/* Recalc banner (P1-3): planned targets derived from since-edited
          history. Dormant until the set_logs.edited_at migration is applied. */}
      {!recalcDismissed && staleTargetCount > 0 && (
        <RecalcTargetsBanner
          staleCount={staleTargetCount}
          changes={staleTargetChanges}
          unit={preferences.units}
          isApplying={isRecalculating}
          onApply={applyRecalc}
          onDismiss={() => setRecalcDismissed(true)}
        />
      )}

      {/* Pause overlay - shown when workout is paused */}
      <PauseOverlay
        isPaused={workoutTimer.isPaused}
        elapsedTime={workoutTimer.formattedTime}
        onResume={workoutTimer.resume}
      />

      {/* Auto-adjust message */}
      {autoAdjustMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4">
          <div className="bg-primary-500/20 backdrop-blur-sm border border-primary-500/30 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
            <span className="text-primary-400 text-lg">🔄</span>
            <p className="text-sm text-primary-200 flex-1">{autoAdjustMessage}</p>
            <button 
              onClick={() => setAutoAdjustMessage(null)}
              className="text-primary-400 hover:text-primary-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      
      {/* Workout header */}
      <WorkoutHeader
        workoutName={workoutLabel}
        exerciseNumber={currentExerciseNumber}
        exerciseTotal={activeBlocks.length}
        segments={headerSegments}
        startedAt={session?.startedAt ?? null}
        timerStarted={timerStartedAt !== null}
        workoutTimer={workoutTimer}
        allCollapsed={allCollapsed}
        onToggleAllCollapsed={() => setAllCollapsed(!allCollapsed)}
        showToolsMenu={showToolsMenu}
        onToggleToolsMenu={() => setShowToolsMenu((v) => !v)}
        onCloseToolsMenu={() => setShowToolsMenu(false)}
        injuryCount={temporaryInjuries.length}
        onOpenInjuryModal={() => setShowInjuryModal(true)}
        onOpenReadinessModal={() => setShowReadinessModal(true)}
        onOpenMuscleReadiness={() => setShowMuscleReadinessSheet(true)}
        onOpenPlateCalculator={() => setShowPlateCalculator(true)}
        isDeload={session?.isDeload ?? false}
        onToggleDeload={handleToggleDeloadSession}
        onCancelWorkout={() => setShowCancelModal(true)}
        onAddExercise={handleOpenAddExercise}
        onFinishWorkout={handleWorkoutComplete}
        onMinimize={() => router.push('/dashboard/log')}
      />

      {/* Readiness modulation banner (Phase 1.3): eased targets today, with a
          session-local "Train as planned" override that zeroes the modulation */}
      {baseReadinessModulation?.banner && !readinessBannerDismissed && !readinessOverridden && (
        <div className="flex items-center gap-3 bg-warning-500/10 text-warning-400 text-xs px-4 py-2 rounded-lg -mt-2">
          <span className="flex-1">{baseReadinessModulation.banner}</span>
          <button
            onClick={() => setReadinessOverridden(true)}
            className="flex-shrink-0 font-medium underline underline-offset-2 hover:text-warning-300 transition-colors"
          >
            Train as planned
          </button>
          <button
            onClick={() => setReadinessBannerDismissed(true)}
            className="flex-shrink-0 p-0.5 hover:text-warning-300 transition-colors"
            aria-label="Dismiss"
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* Weekly volume strip: per-muscle rolling-7-day sets (incl. this session)
          vs the MEV–MRV band, for the muscles this workout trains. Tapping a
          chip opens the full "What to train" volume + recovery sheet. */}
      <WorkoutVolumeStrip
        rows={weeklyVolumeRows}
        isLoading={weeklyVolumeLoading}
        onOpenDetail={() => setShowMuscleReadinessSheet(true)}
      />

      {/* First workout guidance */}
      {isFirstWorkout && showBeginnerTips && (
        <InlineHint id="first-workout-intro">
          <div>
            <p className="font-medium mb-2">Welcome to your first workout!</p>
            <ul className="space-y-1 text-sm text-primary-200">
              <li>• <strong>Log each set</strong> - Enter weight and reps after completing a set</li>
              <li>• <strong>Rate difficulty</strong> - RIR (Reps In Reserve) tells us how hard the set was</li>
              <li>• <strong>Use rest timer</strong> - Optimal rest helps maximize your gains</li>
              <li>• <strong>Track form</strong> - Rate your form to ensure quality reps</li>
            </ul>
            <p className="text-xs text-primary-300 mt-2">
              We&apos;ll learn your patterns and personalize recommendations as you train!
            </p>
          </div>
        </InlineHint>
      )}

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-danger-500/10 border border-danger-500/30 rounded-lg flex items-center gap-2">
          <svg className="w-5 h-5 text-danger-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-danger-300">{error}</span>
          <button 
            onClick={() => setError(null)} 
            className="ml-auto p-1 hover:bg-danger-500/20 rounded"
          >
            <svg className="w-4 h-4 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Coach Message - only show if AI coach notes are enabled */}
      {coachMessage && aiCoachNotesEnabled && (
        <Card className="overflow-hidden border-primary-500/20 bg-gradient-to-br from-primary-500/5 to-surface-900">
          <button
            onClick={() => setShowCoachMessage(!showCoachMessage)}
            className="w-full p-4 flex items-center gap-3 text-left"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🏋️</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-surface-100">Coach&apos;s Notes</p>
              <p className="text-sm text-surface-400 truncate">
                {showCoachMessage ? 'Tap to collapse' : coachMessage.greeting}
              </p>
            </div>
            <svg 
              className={`w-5 h-5 text-surface-400 transition-transform ${showCoachMessage ? 'rotate-180' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showCoachMessage && (
            <div className="px-4 pb-4 space-y-4">
              {/* Greeting & Overview */}
              <div className="pl-13 space-y-2">
                <p className="text-surface-200 font-medium">{coachMessage.greeting}</p>
                <p className="text-sm text-surface-400">{coachMessage.overview}</p>
              </div>

              {/* AI-Powered Coach Notes - only show if enabled */}
              {aiCoachNotesEnabled && (
                <>
                  {isLoadingAiNotes ? (
                    <div className="ml-13 p-3 rounded-lg bg-surface-800 border border-surface-700">
                      <div className="flex items-center gap-3">
                        <LoadingAnimation type="dots" size="sm" />
                        <p className="text-sm text-surface-400">Your coach is reviewing your session...</p>
                      </div>
                    </div>
                  ) : aiCoachNotes ? (
                    <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                      <div className="flex items-start gap-2">
                        <span className="text-primary-400 text-lg mt-0.5">💬</span>
                        <p className="text-sm text-primary-300 leading-relaxed">
                          {aiCoachNotes}
                        </p>
                      </div>
                    </div>
                  ) : coachMessage.personalizedInsight && (
                    <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                      <p className="text-sm text-primary-300">
                        {coachMessage.personalizedInsight}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Tips */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider pl-13">
                  Pro Tips
                </p>
                <div className="pl-13 space-y-1">
                  {coachMessage.tips.map((tip, idx) => (
                    <p key={idx} className="text-xs text-surface-400 flex gap-2">
                      <span className="text-primary-400">•</span>
                      {tip}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* All exercises list — tight 7px inter-row gap (adjacent superset
          members collapse this gap to render as one continuous cluster). */}
      <div className="space-y-[7px]" ref={exerciseListRef}>
        {blocks.map((block, index) => {
          // Upcoming (not-yet-started, non-active) blocks render in the
          // compact "Up next" list below instead of as full cards.
          if (!isBlockInMainList(index)) return null;

          const blockSets = getSetsForBlock(block.id);
          const isComplete = blockSets.length >= block.targetSets;
          const isCurrent = index === currentBlockIndex;
          const isRowCollapsed = allCollapsed || collapsedBlocks.has(block.id);
          const isBeingDragged = draggedBlockIndex === index;

          // "3/8"-style position badge: position among non-skipped exercises /
          // their total, so it stays correct after reordering AND after
          // skipping an exercise. Falls back to the raw index for a skipped
          // block that still renders in the main list (it has logged sets).
          const activePos = activeBlocks.findIndex((b) => b.id === block.id);
          const positionLabel = activePos >= 0
            ? `${activePos + 1}/${activeBlocks.length}`
            : `${index + 1}/${blocks.length}`;

          // Superset cluster chrome (indigo, distinct from green "done"/blue
          // "current"). Adjacent same-group members render as one continuous
          // bordered cluster; a drag-split pair degrades to a per-row border.
          const cluster = getClusterInfo(index);
          const clusterClasses = cluster.clustered
            ? [
                'bg-[#6d5ce0]/[0.06] border-l border-r border-[#6d5ce0]/60 px-2.5',
                cluster.isFirst ? 'border-t rounded-t-xl pt-1' : 'border-t border-[#6d5ce0]/25 !mt-0',
                cluster.isLast ? 'border-b rounded-b-xl pb-2' : '',
              ].join(' ')
            : cluster.inGroup
              ? 'border-l-2 border-[#6d5ce0]/60 rounded-l pl-2' // degraded (drag-split) fallback
              : '';

          // Calculate if this item should be visually shifted during drag
          const translateY = getDragTranslateY(index, isBeingDragged);

          return (
            <div
              key={block.id}
              id={`exercise-${index}`}
              data-block-index={index}
              data-superset-group={block.supersetGroupId ?? undefined}
              data-superset-clustered={cluster.clustered ? 'true' : undefined}
              style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
              className={`transition-transform duration-200 ease-out ${
                isCurrent ? '' : 'opacity-80'
              } ${clusterClasses} ${
                isBeingDragged ? 'opacity-0 pointer-events-none' : ''
              }`}
              onClick={(e) => {
                // Only activate if not already current and click wasn't on an interactive element
                if (!isCurrent && !isDraggingBlock) {
                  const target = e.target as HTMLElement;
                  const isInteractive = target.closest('button, input, select, textarea, a, [data-drag-handle]');
                  if (!isInteractive) {
                    setCurrentBlockIndex(index);
                    setCurrentSetNumber(blockSets.length + 1);
                  }
                }
              }}
            >
              {/* Superset cluster eyebrow — only on the first member of an
                  adjacent cluster; names the group and its round rest. */}
              {cluster.isFirst && (
                <div
                  data-testid="superset-eyebrow"
                  className="flex items-center justify-between px-1 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#a99bff]"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m8.656-4.328a4 4 0 015.656 5.656l-1.5 1.5" />
                    </svg>
                    Superset
                  </span>
                  {cluster.restSeconds > 0 && (
                    <span className="font-medium normal-case text-[#8f7ff0]">{cluster.restSeconds}s rest</span>
                  )}
                </div>
              )}
              {/* Collapsed state — a single compact list row (grip · slot ·
                  position · name · sets/muscle meta · ⋮ · expand chevron),
                  visually in line with the "Up next" rows; the current
                  exercise keeps a primary accent ring. The expanded card
                  below stays MOUNTED (CSS-hidden) so in-progress set inputs
                  survive collapse/expand. */}
              {isRowCollapsed && (
                <div
                  className={`flex items-center gap-2 rounded-lg px-2 py-0.5 transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-surface-800/60 ring-1 ring-primary-500/50'
                      : isComplete
                        ? 'bg-success-500/5 hover:bg-surface-800/50'
                        : 'bg-surface-800/40 hover:bg-surface-800/60'
                  }`}
                  onClick={(e) => {
                    // Tap anywhere non-interactive: activate + expand (same as
                    // the old collapsed preview's "Tap to start").
                    if (isDraggingBlock) return;
                    const target = e.target as HTMLElement;
                    if (target.closest('button, input, select, textarea, a, [data-drag-handle]')) return;
                    e.stopPropagation();
                    setCurrentBlockIndex(index);
                    setCurrentSetNumber(blockSets.length + 1);
                    revealBlock(block.id);
                  }}
                >
                  {/* Drag grip — long press to reorder; ≥44×44 hit area */}
                  <div
                    data-drag-handle
                    aria-label="Hold to reorder exercise"
                    className="-my-1.5 -ml-2 flex min-h-[44px] min-w-[40px] flex-shrink-0 cursor-grab touch-none items-center justify-center text-surface-500 active:cursor-grabbing"
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressStart(index, e.touches[0].clientY);
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressEnd();
                      handleBlockDragEnd();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressStart(index, e.clientY);
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressEnd();
                      handleBlockDragEnd();
                    }}
                    onMouseLeave={handleBlockLongPressEnd}
                  >
                    <IconGripVertical size={16} stroke={2} />
                  </div>
                  {/* Superset slot letter (A/B) — the hidden card suppresses
                      its own copy while collapsed, so this is the block's only
                      superset-slot node. */}
                  {cluster.slot && (
                    <div
                      data-testid="superset-slot"
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[#6d5ce0]/25 text-xs font-bold text-[#a99bff]"
                      aria-label={`Superset position ${cluster.slot}`}
                    >
                      {cluster.slot}
                    </div>
                  )}
                  {/* Position badge */}
                  <span
                    data-testid="position-badge"
                    className={`flex-shrink-0 rounded-md px-1.5 py-1 text-[11px] font-bold leading-none transition-colors ${
                      isComplete
                        ? 'bg-success-500/20 text-success-400'
                        : isCurrent
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400'
                    }`}
                  >
                    {positionLabel}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-medium ${
                      isCurrent ? 'text-surface-100' : 'text-surface-300'
                    }`}
                  >
                    {block.exercise.name}
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-surface-500">
                    {blockSets.length}/{block.targetSets} · {formatMuscleName(block.exercise.primaryMuscle)}
                  </span>
                  {/* Row overflow menu — same items as the expanded card's ⋮
                      (which is suppressed while collapsed, keeping one
                      row-menu-trigger per block) */}
                  <div className="-my-1.5" onClick={(e) => e.stopPropagation()}>
                    <RowOverflowMenu
                      testId="row-menu-trigger"
                      dataBlockId={block.id}
                      ariaLabel={`Actions for ${block.exercise.name}`}
                      items={buildRowMenuItems(index)}
                    />
                  </div>
                  {/* Expand chevron */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      revealBlock(block.id);
                    }}
                    className="-my-1.5 -ml-1 -mr-2 flex min-h-[44px] min-w-[40px] flex-shrink-0 items-center justify-center text-surface-400 hover:text-surface-200 transition-colors"
                    aria-label="Expand exercise"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Exercise card content — ALWAYS mounted (CSS-hidden while
                  collapsed) so the card's in-progress set inputs survive
                  collapse/expand and drag mode. */}
              {(() => {
                // Calculate AI recommended weight first so it can be used for warmup
                const exerciseNote = coachMessage?.exerciseNotes.find(
                  n => n.name === block.exercise.name
                );
                // recommendedWeight is in display units (kg or lb), convert to kg for calculations
                const aiRecommendedWeight = exerciseNote?.weightRec?.recommendedWeight || 0;
                const aiRecommendedWeightKg = aiRecommendedWeight > 0
                  ? inputWeightToKg(aiRecommendedWeight, preferences.units)
                  : 0;

                // Cold start (no logged history): hand the card the estimate +
                // its provenance so the banner shows the transfer-aware number
                // and names the rung that produced it (weightEstimationEngine
                // ladder), instead of a stale stored target and generic copy.
                const blockHistory = exerciseHistories[block.exerciseId];
                const weightRec = exerciseNote?.weightRec;
                const coldStartSuggestion =
                  (blockHistory?.totalSessions ?? 0) === 0 &&
                  weightRec &&
                  weightRec.confidence !== 'find_working_weight' &&
                  weightRec.recommendedWeight > 0
                    ? {
                        weightKg: inputWeightToKg(weightRec.recommendedWeight, preferences.units),
                        reason: weightRec.transferFrom
                          ? `starting point estimated from your ${weightRec.transferFrom} strength`
                          : 'starting point estimated from your training profile',
                        explanation: weightRec.rationale,
                      }
                    : undefined;

                const effectiveWorkingWeight = block.targetWeightKg > 0
                  ? block.targetWeightKg
                  : (coldStartSuggestion?.weightKg ?? aiRecommendedWeightKg);
                
                return (
                  // Exercise group container — the card's own title row now
                  // carries the grip/position/menu/chevron chrome, so it sits
                  // flush at the top of the block (no standalone header row or
                  // mt gap above it). `hidden` (not unmount) while collapsed.
                  <div className={`${isRowCollapsed ? 'hidden' : ''} mb-6 transition-all`}>
                    {/* Injury risk warning (formerly in the standalone header row) */}
                    {(() => {
                      const injuryRisk = getExerciseInjuryRisk(block.exercise, temporaryInjuries);
                      return injuryRisk.isRisky && isCurrent ? (
                        <div className={`mb-2 text-xs ${
                          injuryRisk.severity === 3 ? 'text-danger-400' : 'text-warning-400'
                        }`}>
                          ⚠️ {injuryRisk.reasons[0]}
                          <button
                            className="ml-2 underline font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSwapTargetBlockId(block.id);
                              setSwapSearchQuery('');
                              if (availableExercises.length === 0) {
                                fetchExercises();
                              }
                              setShowPageLevelSwapModal(true);
                            }}
                          >
                            Swap exercise?
                          </button>
                        </div>
                      ) : null;
                    })()}
                    <div className="space-y-3">
                    <ExerciseCard
                    exercise={block.exercise}
                    block={addingExtraSet === block.id
                      ? { ...block, targetSets: block.targetSets + 1 }  // Add one more set when adding extra
                      : block
                    }
                    enhancedAthleteMode={enhancedAthleteModeActive}
                    isDeloadSession={session?.isDeload ?? false}
                    sets={blockSets}
                    onSetComplete={async (data) => {
                      const setId = await handleSetComplete(data);
                      setAddingExtraSet(null);
                      return setId;
                    }}
                    onWarmupComplete={(restSeconds) => {
                      setRestTimerDuration(restSeconds);
                      setShowRestTimer(true);
                      restTimer.start(restSeconds);
                    }}
                    onSetEdit={handleSetEdit}
                    onSetDelete={handleDeleteSet}
                    onSetFeedbackUpdate={handleSetFeedbackUpdate}
                    onSetJointPain={handleSetJointPain}
                    sorenessPrompt={sorenessPromptForBlock(block)}
                    onSorenessAnswer={handleSorenessAnswer}
                    onExerciseFeedbackChange={(feedback) => handleExerciseFeedback(block.id, feedback)}
                    painNotice={painNoticeForExercise(block.exerciseId)}
                    onPainNoticeDismiss={() => {
                      setPainNoticeDismissed(block.exerciseId, new Date());
                      setPainNoticeDismissTick((tick) => tick + 1);
                    }}
                    onTargetSetsChange={(newSets) => handleTargetSetsChange(block.id, newSets)}
                    onExerciseSwap={(newEx) => {
                      handleExerciseSwap(block.id, newEx);
                      setShowSwapForInjury(null); // Clear after swap
                    }}
                    onCreateCustomSwap={(initialName) => {
                      setCustomSwapBlockId(block.id);
                      setCustomSwapInitialName(initialName ?? '');
                      setShowCustomExercise(true);
                    }}
                    onExerciseDelete={() => handleExerciseDelete(block.id)}
                    onBlockNoteUpdate={(note) => handleBlockNoteUpdate(block.id, note)}
                    availableExercises={blocks.map(b => b.exercise).concat(
                      availableExercises.map(ex => ({
                        id: ex.id,
                        name: ex.name,
                        primaryMuscle: ex.primary_muscle,
                        // Real metadata so the "Similar" tab can actually
                        // differentiate candidates (blank placeholders here made
                        // every result score the same).
                        secondaryMuscles: ex.secondary_muscles || [],
                        mechanic: ex.mechanic,
                        defaultRepRange: ex.default_rep_range || [8, 12] as [number, number],
                        defaultRir: ex.default_rir ?? 2,
                        minWeightIncrementKg: 2.5,
                        formCues: [],
                        commonMistakes: [],
                        setupNote: '',
                        movementPattern: ex.movement_pattern || '',
                        equipmentRequired: ex.equipment_required || [],
                        isBodyweight: ex.is_bodyweight ?? undefined,
                      }))
                    )}
                    unavailableEquipmentIds={locationUnavailableEquipmentIds}
                    isActive={isCurrent}
                    listIndex={index}
                    isCollapsed={isRowCollapsed}
                    onDragHandleStart={handleGripDragStart}
                    onDragHandleEnd={handleGripDragEnd}
                    onDragHandleCancel={handleGripDragCancel}
                    getMenuItems={getRowMenuItems}
                    onToggleCollapse={toggleBlockCollapse}
                    onActiveSuggestionChange={isCurrent ? setActiveSuggestionLabel : undefined}
                    unit={preferences.units}
                    recommendedWeight={aiRecommendedWeightKg}
                    coldStartSuggestion={coldStartSuggestion}
                    userBodyweightKg={todayCheckInData?.bodyweightKg || undefined}
                    exerciseHistory={exerciseHistories[block.exerciseId]}
                    previousSets={exerciseHistories[block.exerciseId]?.lastWorkoutSets ?? []}
                    onExerciseNameClick={() => setSelectedExerciseForDetails(block.exercise)}
                    adjustedRir={
                      (() => {
                        const adjusted = calibrationEngineRef.current.getAdjustedRIR(block.exercise.name, block.targetRir);
                        return adjusted.hasAdjustment ? adjusted : undefined;
                      })()
                    }
                    readinessModulation={readinessModulation}
                    performanceSnapshots={performanceSnapshots[block.exerciseId]}
                    userGoal={userGoal}
                    onRepRangeChange={(range) => handleRepRangeChange(block.id, range)}
                    isAmrapSuggested={
                      // Show AMRAP when either the suggestion is active OR user already accepted it
                      (amrapSuggestion?.blockId === block.id && amrapSuggestion?.setNumber === (completedSets.filter(s => s.exerciseBlockId === block.id && s.setType === 'normal').length + 1)) ||
                      amrapAcceptedBlockId === block.id
                    }
                    warmupSets={(() => {
                      if (!isCurrent) return undefined;

                      // If the muscle is already warm (sets completed this
                      // session on an exercise hitting it as primary, or
                      // working sets hitting it as secondary), remove the
                      // warmup option — even if this block has a stored
                      // protocol (e.g. exercises done out of order)
                      const muscleGroup = block.exercise.primaryMuscle;
                      if (isMuscleWarmedUp(muscleGroup, { completedSets, blocks })) {
                        return undefined;
                      }

                      // Check if this block has warmup protocol defined
                      if (block.warmupProtocol && block.warmupProtocol.length > 0) {
                        return block.warmupProtocol;
                      }

                      // Check if another exercise in this muscle group has warmups defined
                      const blockWithWarmups = blocks.find(
                        b => muscleMatchesGroup(b.exercise.primaryMuscle, muscleGroup) &&
                             b.warmupProtocol &&
                             b.warmupProtocol.length > 0
                      );
                      
                      // Use the warmups from the first exercise of this muscle group
                      if (blockWithWarmups && blockWithWarmups.warmupProtocol) {
                        return blockWithWarmups.warmupProtocol;
                      }
                      
                      // Generate warmups dynamically for first exercise of each muscle group
                      // (includes isolation exercises if they're the first for that muscle)
                      const isFirstForMuscle = !blocks.some(
                        (b, i) => i < index && muscleMatchesGroup(b.exercise.primaryMuscle, muscleGroup)
                      );

                      if (isFirstForMuscle) {
                        return generateWarmupProtocol({
                          workingWeight: effectiveWorkingWeight,
                          exercise: block.exercise,
                          isFirstExercise: index === 0,
                        });
                      }

                      return undefined;
                    })()}
                    workingWeight={effectiveWorkingWeight}
                    showSwapOnMount={showSwapForInjury === block.id}
                    currentInjuries={temporaryInjuries}
                    frequentExerciseIds={frequentExerciseIds}
                    // Dropset props
                    pendingDropset={pendingDropset?.blockId === block.id ? pendingDropset : null}
                    onDropsetCancel={() => setPendingDropset(null)}
                    onDropsetStart={() => {
                      // Stop timer and mark as complete when manual dropset starts
                      restTimer.markComplete();
                      setShowRestTimer(false);
                    }}
                    onPlateCalculatorOpen={(initialWeightKg) => {
                      setPlateCalculatorWeight(initialWeightKg);
                      setShowPlateCalculator(true);
                    }}
                    setSyncStatus={setSync}
                  />

                  {/* Rest timer renders as a fixed bottom bar at page level (P0-5) */}

                  {/* AMRAP Suggestion Banner - positioned below sets for better visibility when keyboard is up */}
                  {amrapSuggestion && amrapSuggestion.blockId === block.id && (
                    <Card className="p-4 bg-gradient-to-r from-primary-500/20 to-primary-600/10 border-primary-500/30">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center">
                            <span className="text-primary-400 text-lg">🎯</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-surface-100 mb-1">
                            AMRAP Set Suggestion
                          </h3>
                          <p className="text-xs text-surface-300 mb-3">
                            This is your last set on <strong>{amrapSuggestion.exerciseName}</strong>.
                            Push to failure (RPE 9.5+) to calibrate your RPE perception.
                            This helps us adjust your future RIR prescriptions.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                // Track that user accepted AMRAP for this block (persists for RPE prefill)
                                setAmrapAcceptedBlockId(amrapSuggestion.blockId);
                                // The user will complete the set normally, but we'll track it as AMRAP
                                // The set completion handler will detect RPE >= 9.5 and mark it as AMRAP
                                setAmrapSuggestion(null);
                              }}
                              className="text-xs"
                            >
                              Got it - I&apos;ll push hard
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAmrapSuggestion(null)}
                              className="text-xs"
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}

                    {/* Exercise complete actions - only show for current exercise */}
                    {isCurrent && isComplete && addingExtraSet !== block.id && (
                      <div className="flex justify-center gap-3 py-4">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setAddingExtraSet(block.id)}
                        >
                          + Add Extra Set
                        </Button>
                        {blocks.some((b, i) => i > index && !skippedBlockIds.has(b.id)) && (
                          <Button variant="secondary" onClick={handleNextExercise}>
                            Next Exercise →
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })()}

            </div>
          );
        })}

        {/* Up next - compact rows for exercises not started yet */}
        {upNextEntries.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">
              Up next
            </p>
            {upNextEntries.map(({ block, index }) => {
              const isSkipped = skippedBlockIds.has(block.id);
              const isBeingDragged = draggedBlockIndex === index;
              const translateY = getDragTranslateY(index, isBeingDragged);
              const muscleLabel = formatMuscleName(block.exercise.primaryMuscle);

              if (isSkipped) {
                return (
                  <div
                    key={block.id}
                    className="flex items-center gap-3 bg-surface-800/30 rounded-lg px-3 py-2.5 opacity-60"
                  >
                    <span className="text-[13px] text-surface-400 line-through truncate flex-1">
                      {block.exercise.name}
                    </span>
                    <span className="text-[11px] text-surface-500 flex-shrink-0">Skipped today</span>
                    <button
                      onClick={() => handleUnskipBlock(block.id)}
                      className="text-[11px] font-medium text-primary-400 hover:text-primary-300 transition-colors flex-shrink-0"
                    >
                      Undo
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={block.id}
                  data-block-index={index}
                  style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
                  className={`flex items-center gap-3 bg-surface-800/50 rounded-lg px-3 py-2.5 transition-transform duration-200 ease-out cursor-pointer hover:bg-surface-800 ${
                    isBeingDragged ? 'opacity-0 pointer-events-none' : ''
                  }`}
                  onClick={(e) => {
                    if (isDraggingBlock) return;
                    const target = e.target as HTMLElement;
                    if (target.closest('button, [data-drag-handle]')) return;
                    setCurrentBlockIndex(index);
                    setCurrentSetNumber(getSetsForBlock(block.id).length + 1);
                  }}
                >
                  <span className="text-[13px] text-surface-200 truncate flex-1">
                    {block.exercise.name}
                  </span>
                  <span className="text-[11px] text-surface-500 flex-shrink-0">
                    {block.targetSets} sets · {muscleLabel}
                  </span>
                  <button
                    onClick={() => handleSkipBlock(block.id)}
                    className="text-[11px] text-surface-500 hover:text-warning-400 transition-colors flex-shrink-0"
                    title="Skip this exercise today"
                  >
                    Skip today
                  </button>
                  {/* Drag handle - hold to reorder (wired to the existing block drag state) */}
                  <div
                    data-drag-handle
                    className="text-surface-500 cursor-grab active:cursor-grabbing p-1.5 -m-1 touch-none flex-shrink-0"
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressStart(index, e.touches[0].clientY);
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressEnd();
                      handleBlockDragEnd();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressStart(index, e.clientY);
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      handleBlockLongPressEnd();
                      handleBlockDragEnd();
                    }}
                    onMouseLeave={handleBlockLongPressEnd}
                  >
                    <IconGripVertical size={16} stroke={2} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating drag preview */}
      {isDraggingBlock && draggedBlockIndex !== null && dragPosition && (
        <div
          className="fixed pointer-events-none z-50 transition-transform duration-75"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
            width: draggedBlockRect?.width ?? 'auto',
          }}
        >
          <div className="bg-surface-900 rounded-xl p-3 shadow-2xl shadow-black/50 ring-2 ring-primary-500 scale-[1.02]">
            <div className="flex items-center gap-3">
              {/* Drag handle */}
              <div className="flex flex-col gap-0.5 text-surface-400 p-1">
                <div className="w-4 h-0.5 bg-current rounded" />
                <div className="w-4 h-0.5 bg-current rounded" />
                <div className="w-4 h-0.5 bg-current rounded" />
              </div>
              {/* Position badge — same "3/8" format as the list rows */}
              <div className="rounded-md px-1.5 py-1 text-[11px] font-bold leading-none bg-primary-500 text-white flex-shrink-0">
                {(() => {
                  const draggedId = blocks[draggedBlockIndex]?.id;
                  const pos = activeBlocks.findIndex((b) => b.id === draggedId);
                  return pos >= 0
                    ? `${pos + 1}/${activeBlocks.length}`
                    : `${draggedBlockIndex + 1}/${blocks.length}`;
                })()}
              </div>
              {/* Exercise name */}
              <div className="flex-1">
                <p className="font-medium text-surface-100">
                  {blocks[draggedBlockIndex]?.exercise?.name}
                </p>
                <p className="text-xs text-surface-500">
                  {getSetsForBlock(blocks[draggedBlockIndex]?.id).length}/{blocks[draggedBlockIndex]?.targetSets} sets
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Finish workout button at bottom */}
      <Card className="text-center py-6 mt-8">
        <p className="text-surface-400 mb-4">
          {overallProgress >= 100 
            ? '🎉 All exercises complete!' 
            : `${Math.round(overallProgress)}% complete`}
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="ghost" onClick={handleOpenAddExercise}>
            + Add Exercise
          </Button>
          <Button onClick={handleWorkoutComplete}>
            Finish Workout
          </Button>
        </div>
      </Card>

      {/* Bottom chrome stack: a single fixed, safe-area-aware column that owns
          the bottom band so its layers stack instead of colliding. The
          transient Performance-Drop toast sits ABOVE the persistent rest timer
          (P0-5) — previously each was its own independent fixed layer at the
          same bottom offset and they overlapped. The in-flow action bar above
          gets matching bottom padding (see restBarVisible / bottomChromeVisible)
          so nothing here covers it. pointer-events pass through the empty gaps
          so taps land on the exercise list, not an invisible full-width layer. */}
      {bottomChromeVisible && (
        <div className="fixed inset-x-3 bottom-3 z-40 max-w-2xl mx-auto flex flex-col items-stretch gap-2 pointer-events-none [&>*]:pointer-events-auto pb-[env(safe-area-inset-bottom)]">
          {sanityCheckResult && (
            <SanityCheckToast
              layout="inline"
              check={sanityCheckResult}
              onDismiss={() => setSanityCheckResult(null)}
            />
          )}
          {restBarVisible && (
            <RestTimer
              seconds={restTimer.seconds}
              initialSeconds={restTimer.initialSeconds}
              isRunning={restTimer.isRunning}
              isFinished={restTimer.isFinished}
              onAddTime={restTimer.addTime}
              onSkip={() => {
                restTimer.skip();
                setShowRestTimer(false);
              }}
              nextLabel={
                activeSuggestionLabel
                  ? `next · ${activeSuggestionLabel}`
                  : currentBlock
                    ? `next · ${formatWeight(currentBlock.targetWeightKg, preferences.units)} × ${currentBlock.targetRepRange[0]}–${currentBlock.targetRepRange[1]}`
                    : undefined
              }
              onBarTap={() => {
                document
                  .getElementById(`exercise-${currentBlockIndex}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />
          )}
        </div>
      )}

      {/* Add Exercise Modal */}
      {showAddExercise && (
        <AddExercisePicker
          variant="workout"
          availableExercises={availableExercises}
          exerciseSearch={exerciseSearch}
          onExerciseSearchChange={setExerciseSearch}
          selectedMuscleFilter={selectedMuscleFilter}
          onSelectedMuscleFilterChange={setSelectedMuscleFilter}
          selectedEquipmentGroups={selectedEquipmentGroups}
          onToggleEquipmentGroup={toggleEquipmentGroup}
          showMuscleDropdown={showMuscleDropdown}
          onShowMuscleDropdownChange={setShowMuscleDropdown}
          showSortDropdown={showSortDropdown}
          onShowSortDropdownChange={setShowSortDropdown}
          showLocationDropdown={showLocationDropdown}
          onShowLocationDropdownChange={setShowLocationDropdown}
          exerciseSortOption={exerciseSortOption}
          onExerciseSortOptionChange={setExerciseSortOption}
          showAllExercises={showAllExercises}
          onToggleShowAllExercises={() => setShowAllExercises((v) => !v)}
          gymLocations={gymLocations}
          selectedLocationFilter={selectedLocationFilter}
          onSelectedLocationFilterChange={setSelectedLocationFilter}
          unavailableEquipmentIds={locationUnavailableEquipmentIds}
          unavailableExerciseIds={unavailableExerciseIds}
          stapleExerciseIds={stapleExerciseIds}
          frequentExerciseIds={frequentExerciseIds}
          lastDoneExercises={lastDoneExercises}
          planMuscles={blocks.map((b) => b.exercise.primaryMuscle)}
          selectedExercisesToAdd={selectedExercisesToAdd}
          onToggleExerciseSelection={toggleExerciseSelection}
          isAddingExercise={isAddingExercise}
          onClose={handleCloseAddExerciseModal}
          onAddSelected={handleAddSelectedExercises}
          onCreateCustom={() => { setCustomSwapBlockId(null); setShowCustomExercise(true); }}
          error={error}
        />
      )}

      {/* Custom Exercise Creation Modal with AI */}
      {showCustomExercise && session && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60"
            onClick={() => { setShowCustomExercise(false); setCustomSwapBlockId(null); }}
          />
          
          {/* Modal */}
          <div className="relative w-full max-w-lg max-h-[90vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-surface-800 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowCustomExercise(false); setCustomSwapBlockId(null); }}
                  className="p-1 text-surface-400 hover:text-surface-200"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <h2 className="text-lg font-semibold text-surface-100">Create Custom Exercise</h2>
              </div>
            </div>

            {/* AI-Powered Exercise Creation Component */}
            <div className="flex-1 overflow-y-auto p-4">
              <CreateCustomExercise
                userId={session.userId}
                onSuccess={handleCustomExerciseSuccess}
                onCancel={() => { setShowCustomExercise(false); setCustomSwapBlockId(null); }}
                initialName={customSwapBlockId ? customSwapInitialName : exerciseSearch}
              />
            </div>
          </div>
        </div>
      )}

      {/* Optional readiness logger (no longer gates the workout). The panel
          scrolls internally (sticky header/footer) so the scrim stays exposed
          and tappable; scrim tap / X / Escape all cancel without submitting.
          Portaled to <body> (like components/ui/Modal) so the scrim covers
          the dashboard header instead of painting beneath it. */}
      {showReadinessModal && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowReadinessModal(false)}
        >
          <div className="max-w-lg w-full max-h-full min-h-0 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <ReadinessCheckIn
              onSubmit={async (data, sorenessRatings) => {
                await handleCheckInComplete(data, { startSession: false });
                if (sorenessRatings) {
                  await saveSorenessFeedback(sorenessRatings);
                  // A muscle answered at check-in is never re-asked by the
                  // inline exercise-card chips this session.
                  for (const [muscle, rating] of Object.entries(sorenessRatings)) {
                    if (rating !== undefined) {
                      recordSorenessAsked(muscle, rating as SorenessRating);
                    }
                  }
                }
                setShowReadinessModal(false);
              }}
              onSkip={() => setShowReadinessModal(false)}
              onClose={() => setShowReadinessModal(false)}
              unit={preferences.units}
              todayNutrition={todayNutrition || undefined}
              userGoal={userGoal}
              sorenessMuscles={Object.keys(recentMuscleSessions) as StandardMuscleGroup[]}
              initialValues={todayCheckInData || undefined}
            />
          </div>
        </div>,
        document.body
      )}

      {/* Muscle Readiness sheet (volume + recovery). Lazy-mounted on first open;
          READ-ONLY over the live session — passed the page's own block/set state,
          never the store, so it can't mutate the session. */}
      {showMuscleReadinessSheet && (
        <MuscleReadinessSheet
          isOpen={showMuscleReadinessSheet}
          onClose={() => setShowMuscleReadinessSheet(false)}
          liveBlocks={activeBlocks}
          liveSets={completedSets}
          sorenessOverrides={stillSoreMuscles}
        />
      )}

      {/* Injury Report Modal */}
      {showInjuryModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowInjuryModal(false)}
          />
          
          <div className="relative w-full max-w-md max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-surface-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🤕</span>
                <h2 className="text-lg font-semibold text-surface-100">Report Pain/Injury</h2>
              </div>
              <button
                onClick={() => setShowInjuryModal(false)}
                className="p-2 text-surface-400 hover:text-surface-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <p className="text-sm text-surface-400">
                Tell us about any pain or discomfort. We&apos;ll suggest exercise swaps to avoid aggravating it.
              </p>

              {/* Current injuries */}
              {temporaryInjuries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-surface-300">Currently reported:</p>
                  <div className="flex flex-wrap gap-2">
                    {temporaryInjuries.map(injury => {
                      const areaLabels: Record<string, string> = {
                        lower_back: '🔻 Lower Back', upper_back: '🔺 Upper Back', neck: '🦴 Neck',
                        shoulder_left: '💪 Left Shoulder', shoulder_right: '💪 Right Shoulder',
                        elbow_left: '🦾 Left Elbow', elbow_right: '🦾 Right Elbow',
                        wrist_left: '🤚 Left Wrist', wrist_right: '🤚 Right Wrist',
                        hip_left: '🦵 Left Hip', hip_right: '🦵 Right Hip',
                        knee_left: '🦿 Left Knee', knee_right: '🦿 Right Knee',
                        ankle_left: '🦶 Left Ankle', ankle_right: '🦶 Right Ankle',
                        chest: '❤️ Chest', other: '⚠️ Other'
                      };
                      const severityLabels = ['Mild', 'Moderate', 'Significant'];
                      return (
                        <div 
                          key={injury.area}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                            injury.severity === 3 
                              ? 'bg-danger-500/20 text-danger-400' 
                              : injury.severity === 2 
                                ? 'bg-warning-500/20 text-warning-400'
                                : 'bg-surface-700 text-surface-300'
                          }`}
                        >
                          <span>{areaLabels[injury.area] || injury.area}</span>
                          <span className="text-xs opacity-70">({severityLabels[injury.severity - 1]})</span>
                          <button
                            onClick={() => setTemporaryInjuries(temporaryInjuries.filter(i => i.area !== injury.area))}
                            className="ml-1 p-0.5 hover:bg-surface-600 rounded-full"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add new injury */}
              <div className="space-y-3 p-4 bg-surface-800/50 rounded-lg">
                <p className="text-xs font-medium text-surface-300">Add an issue:</p>
                
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Area affected</label>
                  <select
                    value={selectedInjuryArea}
                    onChange={(e) => setSelectedInjuryArea(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-100 text-sm"
                  >
                    <option value="">Select area...</option>
                    <optgroup label="Back & Core">
                      <option value="lower_back">🔻 Lower Back</option>
                      <option value="upper_back">🔺 Upper Back</option>
                      <option value="neck">🦴 Neck</option>
                      <option value="chest">❤️ Chest</option>
                    </optgroup>
                    <optgroup label="Upper Body">
                      <option value="shoulder_left">💪 Left Shoulder</option>
                      <option value="shoulder_right">💪 Right Shoulder</option>
                      <option value="elbow_left">🦾 Left Elbow</option>
                      <option value="elbow_right">🦾 Right Elbow</option>
                      <option value="wrist_left">🤚 Left Wrist</option>
                      <option value="wrist_right">🤚 Right Wrist</option>
                    </optgroup>
                    <optgroup label="Lower Body">
                      <option value="hip_left">🦵 Left Hip</option>
                      <option value="hip_right">🦵 Right Hip</option>
                      <option value="knee_left">🦿 Left Knee</option>
                      <option value="knee_right">🦿 Right Knee</option>
                      <option value="ankle_left">🦶 Left Ankle</option>
                      <option value="ankle_right">🦶 Right Ankle</option>
                    </optgroup>
                    <option value="other">⚠️ Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-surface-400 mb-1">Severity</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map(level => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setSelectedInjurySeverity(level as 1 | 2 | 3)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                          selectedInjurySeverity === level
                            ? level === 3 
                              ? 'bg-danger-500 text-white'
                              : level === 2
                                ? 'bg-warning-500 text-black'
                                : 'bg-primary-500 text-white'
                            : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
                        }`}
                      >
                        {level === 1 ? 'Mild' : level === 2 ? 'Moderate' : 'Significant'}
                      </button>
                    ))}
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    if (selectedInjuryArea && !temporaryInjuries.some(i => i.area === selectedInjuryArea)) {
                      setTemporaryInjuries([...temporaryInjuries, { area: selectedInjuryArea, severity: selectedInjurySeverity }]);
                      setSelectedInjuryArea('');
                      setSelectedInjurySeverity(1);
                    }
                  }}
                  disabled={!selectedInjuryArea || temporaryInjuries.some(i => i.area === selectedInjuryArea)}
                  className="w-full"
                >
                  + Add to List
                </Button>
              </div>

              {/* What will happen info */}
              {temporaryInjuries.length > 0 && (
                <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                  <p className="text-xs text-primary-400 font-medium mb-1">What happens now?</p>
                  <p className="text-xs text-surface-400">
                    We&apos;ll flag exercises that could aggravate these areas. You can easily swap them for safer alternatives.
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-surface-800 space-y-2">
              {/* Show risky exercises count */}
              {temporaryInjuries.length > 0 && (
                <div className="text-center text-sm text-surface-400 mb-2">
                  {blocks.filter(b => getExerciseInjuryRisk(b.exercise, temporaryInjuries).isRisky).length > 0 ? (
                    <span className="text-warning-400">
                      ⚠️ {blocks.filter(b => getExerciseInjuryRisk(b.exercise, temporaryInjuries).severity >= 2).length} exercise(s) may need swapping
                    </span>
                  ) : (
                    <span className="text-success-400">✓ All exercises look safe!</span>
                  )}
                </div>
              )}
              <Button onClick={handleApplyInjuries} className="w-full">
                {temporaryInjuries.length > 0 ? 'Apply & Continue Workout' : 'Close'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Plate Calculator Modal */}
      <PlateCalculatorModal
        isOpen={showPlateCalculator}
        onClose={() => {
          setShowPlateCalculator(false);
          setPlateCalculatorWeight(undefined);
        }}
        initialWeightKg={plateCalculatorWeight ?? currentBlock?.targetWeightKg}
        exerciseId={currentExercise?.id}
      />

      {/* Page-level Swap Modal for injury-related swaps */}
      {showPageLevelSwapModal && swapTargetBlockId && (() => {
        const targetBlock = blocks.find(b => b.id === swapTargetBlockId);
        if (!targetBlock) return null;
        
        // Get safe alternatives using the intelligent injury swapper
        const safeAlternatives = availableExercises
          .filter(ex => {
            // Must target same muscle
            if (ex.primary_muscle !== targetBlock.exercise.primaryMuscle) return false;
            // Must not be the current exercise
            if (ex.id === targetBlock.exercise.id) return false;
            // Must not already be in workout
            if (blocks.some(b => b.exercise.id === ex.id)) return false;
            // Must be performable with the selected location's equipment
            if (
              exerciseRequiresUnavailableEquipment(
                { name: ex.name, equipment: ex.equipment_required, isBodyweight: ex.is_bodyweight },
                locationUnavailableEquipmentIds
              )
            ) return false;
            // Check search filter
            if (swapSearchQuery && !ex.name.toLowerCase().includes(swapSearchQuery.toLowerCase())) return false;
            // Check if safe for injuries
            const risk = getExerciseInjuryRisk(
              { ...targetBlock.exercise, id: ex.id, name: ex.name, primaryMuscle: ex.primary_muscle },
              temporaryInjuries
            );
            return !risk.isRisky || risk.risk === 'caution';
          })
          .map(ex => {
            const risk = getExerciseInjuryRisk(
              { ...targetBlock.exercise, id: ex.id, name: ex.name, primaryMuscle: ex.primary_muscle },
              temporaryInjuries
            );
            return { exercise: ex, risk };
          })
          .sort((a, b) => {
            // Safe first, then caution
            if (a.risk.risk === 'safe' && b.risk.risk !== 'safe') return -1;
            if (a.risk.risk !== 'safe' && b.risk.risk === 'safe') return 1;
            return a.exercise.name.localeCompare(b.exercise.name);
          });
        
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div 
              className="absolute inset-0 bg-black/60"
              onClick={() => setShowPageLevelSwapModal(false)}
            />
            
            <div className="relative w-full max-w-lg max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-surface-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-surface-100">Swap Exercise</h3>
                    <p className="text-sm text-surface-400">
                      Replace <span className="text-warning-400 font-medium">{targetBlock.exercise.name}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPageLevelSwapModal(false)}
                    className="p-2 text-surface-400 hover:text-surface-200"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                {/* Search */}
                <div className="mt-3">
                  <Input
                    placeholder="Search exercises..."
                    value={swapSearchQuery}
                    onChange={(e) => setSwapSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3">
                {/* Info banner */}
                <div className={`mb-3 p-3 rounded-lg ${
                  safeAlternatives.length > 0 
                    ? 'bg-success-500/10 border border-success-500/20' 
                    : 'bg-warning-500/10 border border-warning-500/20'
                }`}>
                  {safeAlternatives.length > 0 ? (
                    <p className="text-xs text-success-400">
                      ✓ <span className="font-medium">{safeAlternatives.filter(a => a.risk.risk === 'safe').length} safe alternative(s)</span> found for {targetBlock.exercise.primaryMuscle}
                    </p>
                  ) : (
                    <p className="text-xs text-warning-400">
                      ⚠️ No safe alternatives found. Consider skipping this exercise.
                    </p>
                  )}
                </div>
                
                {/* Exercise list */}
                <div className="space-y-1">
                  {safeAlternatives.map(({ exercise: alt, risk }) => (
                    <button
                      key={alt.id}
                      onClick={async () => {
                        // Perform the swap
                        await handleExerciseSwap(swapTargetBlockId, {
                          id: alt.id,
                          name: alt.name,
                          primaryMuscle: alt.primary_muscle,
                          secondaryMuscles: alt.secondary_muscles || [],
                          mechanic: alt.mechanic,
                          defaultRepRange: [8, 12] as [number, number],
                          defaultRir: 2,
                          minWeightIncrementKg: 2.5,
                          formCues: [],
                          commonMistakes: [],
                          setupNote: '',
                          movementPattern: '',
                          equipmentRequired: [],
                        });
                        setShowPageLevelSwapModal(false);
                        setAutoAdjustMessage(`✓ Swapped ${targetBlock.exercise.name} → ${alt.name}`);
                        setTimeout(() => setAutoAdjustMessage(null), 5000);
                      }}
                      className="w-full p-3 text-left rounded-lg hover:bg-surface-800 transition-colors flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-surface-100 truncate">{alt.name}</p>
                          {risk.risk === 'safe' && temporaryInjuries.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-500/20 text-success-400">
                              ✓ Safe
                            </span>
                          )}
                          {risk.risk === 'caution' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-500/20 text-warning-400">
                              ⚠️ Caution
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-surface-500 capitalize">
                          {alt.primary_muscle} • {alt.mechanic}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                  
                  {safeAlternatives.length === 0 && (
                    <p className="py-8 text-center text-surface-500">
                      No safe alternatives found for {targetBlock.exercise.primaryMuscle}
                    </p>
                  )}
                </div>
              </div>
              
              {/* Skip option */}
              <div className="p-3 border-t border-surface-800 bg-surface-800/50 space-y-2">
                <button
                  onClick={() => {
                    setCustomSwapBlockId(swapTargetBlockId);
                    setCustomSwapInitialName(swapSearchQuery.trim());
                    setShowPageLevelSwapModal(false);
                    setShowCustomExercise(true);
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-primary-400 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create custom exercise
                </button>
                <button
                  onClick={async () => {
                    await handleExerciseDelete(swapTargetBlockId);
                    setShowPageLevelSwapModal(false);
                    setAutoAdjustMessage(`Removed ${targetBlock.exercise.name} from workout`);
                    setTimeout(() => setAutoAdjustMessage(null), 5000);
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Skip this exercise
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cancel Workout Confirmation Modal */}
      {showCancelModal && (
        <CancelWorkoutModal
          totalCompletedSets={totalCompletedSets}
          isCancelling={isCancelling}
          onKeepGoing={() => setShowCancelModal(false)}
          onConfirm={handleCancelWorkout}
        />
      )}

      {/* Finish Workout Confirmation Modal */}
      <ConfirmModal
        isOpen={showFinishConfirm}
        onClose={() => setShowFinishConfirm(false)}
        onConfirm={confirmFinishWorkout}
        title="Finish Workout?"
        message={
          totalCompletedSets < totalPlannedSets
            ? `You've logged ${totalCompletedSets} of ${totalPlannedSets} sets. Remaining sets won't be logged.`
            : `All ${totalPlannedSets} sets logged. Wrap up and rate your session.`
        }
        confirmText="Finish"
        cancelText="Keep Training"
        variant={totalCompletedSets < totalPlannedSets ? 'warning' : 'default'}
      />
      
      {/* Exercise Details Modal — carries the workout-context metadata the
          card's title row no longer shows (position, set count; grade/caution/
          muscle/last-session render inside the modal itself). */}
      {(() => {
        const detailsBlock = selectedExerciseForDetails
          ? blocks.find((b) => b.exercise.id === selectedExerciseForDetails.id)
          : undefined;
        let detailsPositionLabel: string | undefined;
        let detailsSetCountLabel: string | undefined;
        if (detailsBlock) {
          // Same position math as the exercise list rows (non-skipped index).
          const activePos = activeBlocks.findIndex((b) => b.id === detailsBlock.id);
          const rawPos = blocks.findIndex((b) => b.id === detailsBlock.id);
          detailsPositionLabel =
            activePos >= 0
              ? `${activePos + 1}/${activeBlocks.length}`
              : `${rawPos + 1}/${blocks.length}`;
          const doneSets = completedSets.filter(
            (s) => s.exerciseBlockId === detailsBlock.id && s.setType === 'normal'
          ).length;
          detailsSetCountLabel = `${doneSets}/${detailsBlock.targetSets} sets`;
        }
        return (
          <ExerciseDetailsModal
            exercise={selectedExerciseForDetails}
            isOpen={!!selectedExerciseForDetails}
            onClose={() => setSelectedExerciseForDetails(null)}
            unit={preferences.units}
            positionLabel={detailsPositionLabel}
            setCountLabel={detailsSetCountLabel}
          />
        );
      })()}

      {/* Sanity Check "Performance Drop" toast is rendered inside the bottom
          chrome stack above (so it stacks over the rest timer instead of
          overlapping it), not as its own independent fixed layer here. */}

      {/* Calibration Result Card (modal overlay) */}
      {calibrationResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="max-w-md w-full">
            <CalibrationResultCard
              result={calibrationResult}
              enhancedAthleteMode={enhancedAthleteModeActive}
              onDismiss={() => setCalibrationResult(null)}
            />
          </div>
        </div>
      )}

      {/* Toast Container for notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Delete Exercise Confirmation Modal (for header row delete button) */}
      <ConfirmModal
        isOpen={deleteConfirmBlock !== null}
        onClose={() => setDeleteConfirmBlock(null)}
        onConfirm={() => {
          if (deleteConfirmBlock) {
            handleExerciseDelete(deleteConfirmBlock.id);
            setDeleteConfirmBlock(null);
          }
        }}
        title="Remove Exercise"
        message={deleteConfirmBlock ? `Remove "${deleteConfirmBlock.name}" from this workout? This will delete any logged sets for this exercise.` : ''}
        confirmText="Remove"
        cancelText="Keep"
        variant="danger"
      />
    </div>
  );
}
