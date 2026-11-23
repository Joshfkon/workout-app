'use client';

/**
 * Self-contained "AI suggested workout" launcher, shared by the Train tab and
 * the /dashboard/log startup page so the suggestion flow exists in more than
 * one place (the app must never be unable to start a workout).
 *
 * Flow: opens straight onto a plan sized for the last-used duration at the
 * last-used location (both changeable in place; "Change" reopens "How much
 * time do you have?") → deterministic plan preview (services/suggestedWorkout — recovery + weekly
 * volume in, MRV-capped / injury-aware / joint-stress-floored picks out) →
 * a location substitution pass (services/locationSubstitution) swaps picks
 * the selected training location can't support for same-muscle alternatives
 * → Start materializes the session via the same ad-hoc create/reuse path as
 * the blank workout (origin 'ai_suggested'). NOTHING is written until Start.
 *
 * Two-phase plan build: the "ideal" plan is built against the user's default
 * location's inventory (what they'd normally do), then re-checked against the
 * SELECTED location — so training at a hotel shows "swapped from X" notes
 * instead of silently different picks. Substituted exercises keep their OWN
 * identity: weight seeding runs on the substitute's name with no e1RM carried
 * over from the original, so progression history never cross-pollutes.
 *
 * Mount it only while open ({open && <SuggestedWorkoutSheet .../>}) — data
 * fetches happen on mount.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconArrowsExchange, IconLoader2, IconPlus, IconX } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { quickWeightEstimate, type WorkingWeightRecommendation } from '@/services/weightEstimationEngine';
import { fetchTransferCandidates } from '@/lib/training/transferCandidates';

type TransferCandidate = Awaited<ReturnType<typeof fetchTransferCandidates>>[number];
import {
  buildSuggestedWorkout,
  detectSplit,
  maxExercisesForDuration,
  suggestedOrderLine,
  injuryAreasPhrase,
  injuryPickLine,
  injuryPlanLine,
  type SuggestedOrderRule,
} from '@/services/suggestedWorkout';
import {
  applyLocationSubstitutions,
  buildSubstitutedPick,
  enforcePlanEquipmentInvariant,
  type LocationSubstitutionExercise,
  type SubstitutedPick,
  type SubstitutedWorkoutPlan,
} from '@/services/locationSubstitution';
import {
  locationIcon,
  pickDefaultLocation,
  LOCATION_PRESETS,
  type LocationPresetKind,
} from '@/services/locationProfiles';
import { fetchUnavailableEquipment } from '@/lib/actions/equipment';
import {
  createTrainingLocation,
  fetchTrainingLocations,
  fetchUnavailableEquipmentForLocation,
  touchLocationLastUsed,
  type TrainingLocationRow,
} from '@/lib/actions/locations';
import { getOrCreateTodaySession } from '@/app/(dashboard)/dashboard/workout/_lib/adhocSession';
import { markGymChosen } from '@/lib/geo/gymChoice';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import {
  exerciseSafetyForAreas,
  parseStandingInjuryAreas,
  STANDING_INJURY_OPTIONS,
} from '@/lib/training/standingInjuries';
import type { PositionStress } from '@/services/exerciseService';
import { now as clockNow } from '@/lib/clock';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { STANDARD_MUSCLE_DISPLAY_NAMES, resolveMuscleToStandard } from '@/types/schema';
import { useBeginnerMode } from '@/hooks/useBeginnerMode';
import { beginnerEffortTarget, beginnerMuscleName, beginnerPickReason, beginnerSuggestedFocus } from '@/lib/beginnerMode';
import { convertWeightForDisplay, formatDate, formatWeight } from '@/lib/utils';
import { localDaysBetween } from '@/lib/date/localDay';
import type { Experience, ExerciseType, MuscleGroup, WarmupSet } from '@/types/schema';
import { formatTargetRange, getSetReps, type ModalitySource } from '@/services/shared/setModality';

interface SheetExercise {
  id: string;
  name: string;
  primary_muscle: string | null;
  secondary_muscles: string[] | null;
  movement_pattern: string | null;
  mechanic: 'compound' | 'isolation' | null;
  default_rep_range: [number, number] | null;
  default_rir: number | null;
  hypertrophy_tier: string | null;
  equipment_required: string[] | null;
  is_bodyweight: boolean | null;
  exercise_type: ExerciseType | null;
  position_stress?: PositionStress | null;
  spinal_loading?: string | null;
  contraindications?: string[] | null;
}

/** Shape the location substitution pass consumes. */
function toSubstitutionExercise(ex: SheetExercise): LocationSubstitutionExercise {
  return {
    id: ex.id,
    name: ex.name,
    primaryMuscle: ex.primary_muscle,
    secondaryMuscles: ex.secondary_muscles,
    movementPattern: ex.movement_pattern,
    mechanic: ex.mechanic,
    tier: ex.hypertrophy_tier,
    equipment: ex.equipment_required,
    isBodyweight: ex.is_bodyweight,
  };
}

/** True when a pick is currently showing its substitute (not reverted). */
function isActiveSubstitution(pick: SubstitutedPick): boolean {
  return !!pick.substitution && pick.exerciseId !== pick.substitution.originalExerciseId;
}

/** Camel-cased location fields for the profile helpers. */
function toLocationSummary(row: TrainingLocationRow) {
  return {
    isDefault: row.is_default,
    lastUsedAt: row.last_used_at,
    icon: row.icon,
    presetKind: row.preset_kind as 'gym' | 'home' | 'travel' | 'custom' | null,
  };
}

/** The users-table fields the launcher needs (estimation + injury flags). */
interface SheetProfile {
  weight_kg: number | null;
  height_cm: number | null;
  body_fat_percent: number | null;
  experience: string | null;
  injury_history: string[] | null;
  /** users.preferences; injuryAreas = standing injuries from onboarding. */
  preferences?: { injuryAreas?: unknown; units?: 'kg' | 'lb' } | null;
}

/**
 * The starting weight a pick will be seeded with, and what it rests on.
 * One function for the preview line in the sheet and for handleStart, so the
 * number the user is told is the number the workout opens with.
 */
function estimatePickStart(
  exercise: Pick<SheetExercise, 'name' | 'primary_muscle' | 'movement_pattern' | 'equipment_required'>,
  pick: { repRange: [number, number]; targetRir: number },
  profile: SheetProfile | null,
  transferCandidates: TransferCandidate[]
): WorkingWeightRecommendation | null {
  if (!profile?.weight_kg || !profile?.height_cm) return null;
  return quickWeightEstimate(
    exercise.name,
    { min: pick.repRange[0], max: pick.repRange[1] },
    pick.targetRir,
    profile.weight_kg,
    profile.height_cm,
    profile.body_fat_percent || 20,
    (profile.experience || 'intermediate') as Experience,
    undefined,
    'kg',
    undefined,
    {
      transferCandidates,
      targetMeta: {
        primaryMuscle: exercise.primary_muscle,
        movementPattern: exercise.movement_pattern,
        equipmentRequired: exercise.equipment_required,
      },
    }
  );
}

/**
 * Cap a dumbbell lift's load at the location's heaviest dumbbell. Shared by
 * the sheet's preview line and handleStart, so the preview never promises a
 * load the workout won't open with.
 */
export function capToLocationDumbbells(
  weightKg: number,
  exercise: Pick<SheetExercise, 'name' | 'equipment_required'>,
  dumbbellMaxKg: number | null | undefined
): number {
  if (
    dumbbellMaxKg &&
    weightKg > dumbbellMaxKg &&
    `${exercise.name} ${(exercise.equipment_required ?? []).join(' ')}`.toLowerCase().includes('dumbbell')
  ) {
    return dumbbellMaxKg;
  }
  return weightKg;
}

/** Plain words for what a new lift's starting weight rests on. */
const START_BASIS: Record<string, string> = {
  related_exercise: 'similar lifts you’ve logged',
  strength_standards: 'typical strength for your experience and bodyweight',
  bodyweight_ratio: 'your bodyweight',
  calibration: 'your strength test',
};

/**
 * When a lift was last done, on the viewer's local calendar: "today",
 * "yesterday", else "on Mon, Nov 17" (with the year only when it differs).
 */
export function lastDoneLabel(at: Date, now: Date): string {
  const days = localDaysBetween(at, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `on ${formatDate(at, {
    weekday: 'short',
    year: at.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })}`;
}

/**
 * Why this lift, and where its first weight comes from — the panel's
 * "no explanation why it picked Upright Row or 65 lbs".
 */
/** The best working set of a lift's last completed session (heaviest, then most reps). */
export interface LastTopSet {
  weightKg: number;
  /** Rep count (modality-resolved; never seconds). */
  repCount: number;
}

/**
 * Pick the top working set from one session's logged sets. Reps come through
 * the modality accessor: a duration exercise's reps field holds seconds, so
 * it has no "× reps" top set (null).
 */
export function topWorkingSet(
  sets: readonly { weight_kg: number | null; reps: number | null; is_warmup?: boolean | null; set_type?: string | null }[],
  exercise: ModalitySource | null | undefined
): LastTopSet | null {
  let best: LastTopSet | null = null;
  for (const s of sets) {
    if (s.is_warmup || s.set_type === 'warmup') continue;
    const weightKg = Number(s.weight_kg ?? 0);
    const repCount = getSetReps(s as { reps: number }, exercise);
    if (repCount === null || !(repCount > 0) || !(weightKg > 0)) continue;
    if (!best || weightKg > best.weightKg || (weightKg === best.weightKg && repCount > best.repCount)) {
      best = { weightKg, repCount };
    }
  }
  return best;
}

export function pickWhyLine(args: {
  isRecent: boolean;
  /** Best working set of the last completed session with this lift. Shown so
   *  the progression is visible before the workout starts (UX panel: a Hevy
   *  switcher "couldn't see the smarter progression" he came for). */
  lastTopSet?: LastTopSet | null;
  /**
   * When the lift was last done in a COMPLETED session (the sheet's usage
   * query, started_at). Named in the line so "recently" is checkable.
   */
  lastDoneAt?: Date | null;
  muscleLabel: string;
  rec: Pick<WorkingWeightRecommendation, 'recommendedWeight' | 'confidence' | 'transferFrom' | 'estimateSource'> | null;
  units: 'kg' | 'lb';
  /** "Now" for today/yesterday; defaults to lib/clock. */
  now?: Date;
}): string {
  const { isRecent, lastDoneAt, muscleLabel, rec, units } = args;
  if (isRecent) {
    const top = args.lastTopSet;
    if (lastDoneAt && top) {
      const w = convertWeightForDisplay(top.weightKg, units, 1);
      const unit = units === 'kg' ? 'kg' : 'lbs';
      return `Last time (${lastDoneLabel(lastDoneAt, args.now ?? clockNow()).replace(/^on /, '')}): best set ${w} ${unit} × ${top.repCount}. Today’s target builds on it.`;
    }
    return lastDoneAt
      ? `You did this ${lastDoneLabel(lastDoneAt, args.now ?? clockNow())} — weights start from your last sets.`
      : 'You’ve done this recently — weights start from your last sets.';
  }
  const lead = `New to you — a top ${muscleLabel.toLowerCase()} pick for your equipment.`;
  if (!rec || rec.confidence === 'find_working_weight' || !(rec.recommendedWeight > 0)) {
    return `${lead} You’ll find your starting weight on the first set.`;
  }
  const w = formatWeight(rec.recommendedWeight, units);
  const basis = rec.transferFrom ? `your ${rec.transferFrom}` : START_BASIS[rec.estimateSource ?? ''];
  return basis ? `${lead} Starts at ~${w}, estimated from ${basis}.` : `${lead} Starts at ~${w} (an estimate).`;
}

type StartStage = 'creating' | 'opening';

/**
 * The Start button's copy while starting: which step it is on, not a bare
 * "Starting..." (UX panel round 19: the wait read as a stall).
 */
export function startStageLabel(stage: StartStage): string {
  return stage === 'opening' ? 'Opening your workout…' : 'Setting up your workout…';
}

interface SuggestedWorkoutSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Home's one-tap "Start today's workout": start the plan as soon as it is
   * built, without waiting for the Start button. Any change the user makes
   * in the sheet first (duration, location, a swap or removal) cancels it
   * and leaves the normal preview.
   */
  autoStart?: boolean;
}

/** Duration choices for the AI suggested workout ("How much time do you have?"). */
const AI_DURATION_CHOICES = [20, 30, 45, 60, 75, 90];
const DEFAULT_AI_DURATION = 45;

/**
 * Last duration this viewer started a suggested workout with. A per-device
 * convenience only (never relied on): the sheet opens straight onto a plan
 * sized for it, with "Change" one tap away.
 */
export const AI_DURATION_STORAGE_KEY = 'hypertrack:suggested-workout-duration';

function readLastDuration(): number {
  try {
    const raw = window.localStorage.getItem(AI_DURATION_STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return AI_DURATION_CHOICES.includes(n) ? n : DEFAULT_AI_DURATION;
  } catch {
    return DEFAULT_AI_DURATION;
  }
}

function rememberDuration(mins: number) {
  try {
    window.localStorage.setItem(AI_DURATION_STORAGE_KEY, String(mins));
  } catch {
    // Private mode / blocked storage: next time just defaults again.
  }
}

/**
 * The target effort in words, no RIR jargon. Beginner mode drops "failure"
 * too (panel: "stop 2 reps short of failure" read as jargon to a new lifter).
 */
export function rirTargetLabel(rir: number, beginner = false): string {
  if (beginner) return beginnerEffortTarget(rir);
  if (rir <= 0) return 'to failure';
  return `stop ${rir} rep${rir === 1 ? '' : 's'} short of failure`;
}

/**
 * Whether a pick may say "Last time …" / "You did this …": only when the
 * lift was in a COMPLETED session. Recency alone (the 90-day usage list) also
 * counted planned and abandoned sessions — a new user's seeded or unstarted
 * plan made the sheet claim they had done a Romanian Deadlift.
 */
export function hasCompletedLift(exerciseId: string, lastCompletedAt: ReadonlyMap<string, number>): boolean {
  return lastCompletedAt.has(exerciseId);
}

export function SuggestedWorkoutSheet({ isOpen, onClose, autoStart = false }: SuggestedWorkoutSheetProps) {
  const router = useRouter();
  const supabase = createUntypedClient();

  const { recoveryStatus, isLoading: recoveryLoading } = useMuscleRecovery();
  // Beginner mode: everyday muscle names, "behind this week" instead of
  // weekly-set counts, no MRV. Wording only; the plan is the same.
  const beginner = useBeginnerMode();
  const muscleName = (muscle: string) =>
    beginner
      ? beginnerMuscleName(muscle)
      : STANDARD_MUSCLE_DISPLAY_NAMES[muscle as keyof typeof STANDARD_MUSCLE_DISPLAY_NAMES] ?? muscle;
  const { volumeData, isLoading: volumeLoading } = useWeeklyVolume();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [exercises, setExercises] = useState<SheetExercise[]>([]);
  const [recentExerciseIds, setRecentExerciseIds] = useState<string[]>([]);
  // When each exercise was last done in a COMPLETED session (epoch ms), so a
  // pick's "You did this …" line names a real day.
  const [lastCompletedAt, setLastCompletedAt] = useState<Map<string, number>>(() => new Map());
  const [lastTopSets, setLastTopSets] = useState<Map<string, LastTopSet>>(() => new Map());
  // The rule the plan builder ordered the picks by (suggestedOrderLine).
  const [planOrder, setPlanOrder] = useState<SuggestedOrderRule | undefined>(undefined);
  // Loaded with the plan data so each pick can preview its starting weight.
  const [transferCandidates, setTransferCandidates] = useState<TransferCandidate[]>([]);
  // Recent completed sessions' exercise ids, most recent first — for the
  // split check (detectSplit: push/pull/legs or a body-part split).
  const [recentSessionExerciseIds, setRecentSessionExerciseIds] = useState<string[][]>([]);
  const [profile, setProfile] = useState<SheetProfile | null>(null);
  /** Legacy locationless blocklist — baseline when the user has no locations. */
  const [unavailableEquipmentIds, setUnavailableEquipmentIds] = useState<string[]>([]);

  // Training locations ("where are you training?"). Blocklists are cached
  // per location id so switching chips doesn't refetch.
  const [locations, setLocations] = useState<TrainingLocationRow[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  // True once the user picks (or creates) a gym here rather than keeping the
  // preselected default — the workout page's automatic gym selection must
  // not override that choice (lib/geo/gymChoice).
  const [locationChosen, setLocationChosen] = useState(false);
  const [unavailableByLocation, setUnavailableByLocation] = useState<Record<string, string[]>>({});

  // Opens straight onto a plan: the build starts on mount with the last-used
  // duration (and the last-used location, preselected below), so the common
  // case is one tap on Start. The duration picker is behind "Change".
  const [aiRequested, setAiRequested] = useState(true);
  const [aiDuration, setAiDuration] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_AI_DURATION : readLastDuration()
  );
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [aiPlan, setAiPlan] = useState<SubstitutedWorkoutPlan | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  /** Where the start is (button copy): building the session, then opening it. */
  const [startStage, setStartStage] = useState<StartStage>('creating');
  // One-tap start from Home: cleared by the first start or any user edit.
  const [autoStartPending, setAutoStartPending] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  /** Pick whose swap options (revert / choose other) are expanded. */
  const [swapOptionsFor, setSwapOptionsFor] = useState<string | null>(null);

  // Inline "add a training location" form (opened from the chip row's "+").
  // Kept in-sheet so the suggestion, duration and selection survive: cancel
  // restores the sheet untouched; save selects the new location and (if a
  // plan is already showing) regenerates the suggestion for it.
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationPreset, setNewLocationPreset] = useState<LocationPresetKind | null>(null);
  const [newDumbbellMax, setNewDumbbellMax] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [addLocationError, setAddLocationError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const userId = await getLocalUserId(supabase);
        if (!userId) return;

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const [exercisesRes, usageRes, profileRes, unavailable, locationRows, transfers] = await Promise.all([
          supabase
            .from('exercises')
            .select(
              'id, name, primary_muscle, secondary_muscles, movement_pattern, mechanic, default_rep_range, default_rir, hypertrophy_tier, equipment_required, is_bodyweight, exercise_type, position_stress, spinal_loading, contraindications'
            )
            .is('deleted_at', null) // hide merge-soft-deleted duplicates
            .order('name'),
          supabase
            .from('exercise_blocks')
            .select('exercise_id, set_logs(weight_kg, reps, is_warmup, set_type), workout_sessions!inner(user_id, started_at, state)')
            .eq('workout_sessions.user_id', userId)
            .gte('workout_sessions.started_at', ninetyDaysAgo.toISOString()),
          supabase
            .from('users')
            .select('weight_kg, height_cm, body_fat_percent, experience, injury_history, preferences')
            .eq('id', userId)
            .single(),
          fetchUnavailableEquipment(userId).catch(() => [] as string[]),
          fetchTrainingLocations(userId).catch(() => [] as TrainingLocationRow[]),
          fetchTransferCandidates(userId, supabase).catch(() => [] as TransferCandidate[]),
        ]);
        setTransferCandidates(transfers);

        setExercises((exercisesRes.data ?? []) as SheetExercise[]);
        setProfile((profileRes.data as SheetProfile | null) ?? null);
        setUnavailableEquipmentIds(unavailable);

        setLocations(locationRows);
        if (locationRows.length > 0) {
          // Default to the last-used location (falling back to the user's
          // default), so the common case is zero extra taps.
          const preselected = pickDefaultLocation(
            locationRows.map((row) => ({ row, ...toLocationSummary(row) }))
          );
          setSelectedLocationId(preselected?.row.id ?? locationRows[0].id);
        }

        // Most recent first, ties broken by usage count (same ordering the
        // log page used before this flow was extracted).
        const counts = new Map<string, number>();
        const lastDone = new Map<string, number>();
        (
          (usageRes.data ?? []) as {
            exercise_id: string;
            workout_sessions: { started_at: string };
          }[]
        ).forEach((block) => {
          // Only lifts actually done: a completed session, or an unfinished
          // one with a logged working set. A planned / seeded / abandoned
          // session's blocks are not "recent" — the plan builder and the
          // pick lines would treat a never-done lift as familiar.
          const b = block as {
            set_logs?: { is_warmup?: boolean | null; set_type?: string | null }[] | null;
            workout_sessions: { state?: string | null };
          };
          const performed =
            b.workout_sessions.state === 'completed' ||
            (b.set_logs ?? []).some((l) => !l.is_warmup && l.set_type !== 'warmup');
          if (!performed) return;
          counts.set(block.exercise_id, (counts.get(block.exercise_id) || 0) + 1);
          const at = new Date(block.workout_sessions.started_at).getTime();
          if (at > (lastDone.get(block.exercise_id) ?? 0)) lastDone.set(block.exercise_id, at);
        });
        // Group blocks into sessions (by start time), most recent first.
        // Completed sessions only: a started-but-abandoned suggestion has its
        // blocks before any set is logged and must not advance the rotation.
        const bySession = new Map<string, string[]>();
        const completedAt = new Map<string, number>();
        const exerciseTypeById = new Map(
          ((exercisesRes.data ?? []) as SheetExercise[]).map((e) => [e.id, { exerciseType: e.exercise_type ?? null }])
        );
        const topSets = new Map<string, LastTopSet>();
        for (const block of (usageRes.data ?? []) as {
          exercise_id: string;
          set_logs?: { weight_kg: number | null; reps: number | null; is_warmup?: boolean | null; set_type?: string | null }[] | null;
          workout_sessions: { started_at: string; state?: string | null };
        }[]) {
          if (block.workout_sessions.state !== 'completed') continue;
          const at = new Date(block.workout_sessions.started_at).getTime();
          if (at > (completedAt.get(block.exercise_id) ?? 0)) {
            completedAt.set(block.exercise_id, at);
            const top = topWorkingSet(block.set_logs ?? [], exerciseTypeById.get(block.exercise_id));
            if (top) topSets.set(block.exercise_id, top);
            else topSets.delete(block.exercise_id);
          }
          const key = block.workout_sessions.started_at;
          const ids = bySession.get(key) ?? [];
          ids.push(block.exercise_id);
          bySession.set(key, ids);
        }
        setLastCompletedAt(completedAt);
        setLastTopSets(topSets);
        setRecentSessionExerciseIds(
          Array.from(bySession.entries())
            .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
            .map(([, ids]) => ids)
        );
        setRecentExerciseIds(
          Array.from(lastDone.entries())
            .sort(
              (a, b) => b[1] - a[1] || (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0)
            )
            .map(([id]) => id)
        );
      } catch (err) {
        console.error('Failed to load suggestion data:', err);
      } finally {
        setIsLoadingData(false);
      }
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The user's "home base" inventory the ideal plan is built against; the
  // selected location's inventory drives the substitution pass.
  const defaultLocation = useMemo(
    () => locations.find((l) => l.is_default) ?? locations[0] ?? null,
    [locations]
  );
  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocationId) ?? null,
    [locations, selectedLocationId]
  );

  // Cache each needed location's equipment blocklist as it becomes relevant.
  useEffect(() => {
    const neededIds = [defaultLocation?.id, selectedLocationId].filter(
      (id): id is string => !!id && !(id in unavailableByLocation)
    );
    if (neededIds.length === 0) return;

    let cancelled = false;
    async function fetchBlocklists() {
      const userId = await getLocalUserId(supabase);
      if (!userId || cancelled) return;
      const entries = await Promise.all(
        neededIds.map(async (id) => {
          const ids = await fetchUnavailableEquipmentForLocation(userId, id).catch((err) => {
            // Degrading to "no blocklist" here means the location stops
            // constraining generation — make that failure loud.
            console.error(
              `[SuggestedWorkoutSheet] failed to load equipment blocklist for location ${id}; ` +
                'suggestions will NOT be equipment-constrained:',
              err
            );
            return [] as string[];
          });
          return [id, ids] as const;
        })
      );
      if (!cancelled) {
        setUnavailableByLocation((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    }
    fetchBlocklists();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLocation?.id, selectedLocationId, unavailableByLocation]);

  const hasLocations = locations.length > 0;
  const baselineUnavailable = useMemo(
    () =>
      hasLocations
        ? defaultLocation
          ? unavailableByLocation[defaultLocation.id]
          : []
        : unavailableEquipmentIds,
    [hasLocations, defaultLocation, unavailableByLocation, unavailableEquipmentIds]
  );
  const selectedUnavailable = useMemo(
    () =>
      hasLocations && selectedLocationId ? unavailableByLocation[selectedLocationId] : undefined,
    [hasLocations, selectedLocationId, unavailableByLocation]
  );
  const blocklistsReady =
    !hasLocations || (baselineUnavailable !== undefined && selectedUnavailable !== undefined);

  // Picking a duration sets aiRequested; the plan is computed here once
  // recovery/volume/exercise/location data is in, sized to fit the time and
  // substituted to fit the selected location's equipment.
  const exerciseById = useMemo(() => new Map(exercises.map((ex) => [ex.id, ex])), [exercises]);
  // "your shoulder" — the standing injury areas the plan was checked against
  // (same parse the plan effect feeds exerciseSafetyForAreas). Null = none.
  const injuryAreas = useMemo(
    () =>
      injuryAreasPhrase(
        parseStandingInjuryAreas(profile?.preferences?.injuryAreas).map(
          (id) => STANDING_INJURY_OPTIONS.find((o) => o.id === id)?.label ?? id
        )
      ),
    [profile]
  );
  const exerciseNameOf = useCallback((id: string) => exerciseById.get(id)?.name, [exerciseById]);

  useEffect(() => {
    if (!aiRequested || recoveryLoading || volumeLoading || isLoadingData || !blocklistsReady)
      return;

    const volumeByMuscle = new Map(volumeData.map((v) => [v.muscleGroup, v]));
    // Standing injuries (onboarding's "areas to go easy on"): drop lifts the
    // safety check rates 'avoid', rank 'caution' ones behind safe options.
    const injurySafety = exerciseSafetyForAreas(
      exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        primaryMuscle: ex.primary_muscle,
        movementPattern: ex.movement_pattern,
        equipment: ex.equipment_required,
        mechanic: ex.mechanic,
        isBodyweight: ex.is_bodyweight,
        positionStress: ex.position_stress ?? null,
        spinalLoading: ex.spinal_loading ?? null,
        contraindications: ex.contraindications ?? null,
      })),
      parseStandingInjuryAreas(profile?.preferences?.injuryAreas),
      clockNow()
    );
    const plan = buildSuggestedWorkout({
      muscles: recoveryStatus.map((r) => ({
        muscle: r.muscle,
        recoveryStatus: r.isReady ? 'ready' : r.recoveryPercent < 50 ? 'sore' : 'recovering',
        weeklySets: volumeByMuscle.get(r.muscle)?.totalSets ?? 0,
        targetSets: volumeByMuscle.get(r.muscle)?.landmarks.mav ?? 10,
        mrvSets: volumeByMuscle.get(r.muscle)?.landmarks.mrv,
      })),
      exercises: exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        primaryMuscle: ex.primary_muscle,
        tier: ex.hypertrophy_tier,
        mechanic: ex.mechanic,
        defaultRepRange: ex.default_rep_range,
        defaultRir: ex.default_rir,
        equipment: ex.equipment_required,
        isBodyweight: ex.is_bodyweight,
        exerciseType: ex.exercise_type,
      })),
      recentExerciseIds,
      split: detectSplit(
        recentSessionExerciseIds.map((ids) =>
          ids.flatMap((id) => {
            const primary = exerciseById.get(id)?.primary_muscle;
            const standard = primary ? resolveMuscleToStandard(primary)[0] : undefined;
            return standard ? [standard] : [];
          })
        )
      ),
      maxExercises: maxExercisesForDuration(aiDuration),
      sessionMinutes: aiDuration,
      injuredMuscles: profile?.injury_history ?? [],
      unavailableEquipmentIds: baselineUnavailable ?? [],
      avoidExerciseIds: injurySafety.avoid,
      cautionExerciseIds: injurySafety.caution,
    });

    // Location pass: swap picks the selected location can't support for
    // same-muscle alternatives (visible as "swapped from ..." notes).
    const substitutionExercises = exercises.map(toSubstitutionExercise);
    const substituted = applyLocationSubstitutions({
      plan,
      exercises: substitutionExercises,
      unavailableEquipmentIds: selectedUnavailable ?? [],
      sessionMinutes: aiDuration,
      avoidExerciseIds: injurySafety.avoid,
      cautionExerciseIds: injurySafety.caution,
    });

    // Belt-and-braces: no pick may require equipment the selected location
    // lacks (dev: throws; prod: drops + logs). Exceptions stay visible via
    // the noSubstituteAvailable flag.
    const enforced = enforcePlanEquipmentInvariant(
      substituted,
      substitutionExercises,
      selectedUnavailable ?? []
    );

    setAiRequested(false);
    setSwapOptionsFor(null);
    setPlanOrder(plan.order);
    setAiPlan(enforced);
  }, [
    aiRequested,
    recoveryLoading,
    volumeLoading,
    isLoadingData,
    blocklistsReady,
    recoveryStatus,
    volumeData,
    exercises,
    recentExerciseIds,
    recentSessionExerciseIds,
    exerciseById,
    profile,
    baselineUnavailable,
    selectedUnavailable,
    aiDuration,
  ]);


  const openDurationPicker = () => {
    setAutoStartPending(false);
    setShowDurationPicker(true);
    setAiPlan(null);
  };

  const handleRemovePick = (exerciseId: string) => {
    setAutoStartPending(false);
    setAiPlan((plan) =>
      plan
        ? { ...plan, exercises: plan.exercises.filter((p) => p.exerciseId !== exerciseId) }
        : plan
    );
  };

  // Switching locations re-runs the plan build (and its substitution pass)
  // so the preview and est. set counts update immediately.
  const handleSelectLocation = (locationId: string) => {
    setAutoStartPending(false);
    if (locationId === selectedLocationId) return;
    setSelectedLocationId(locationId);
    setLocationChosen(true);
    if (aiPlan) setAiRequested(true);
  };

  const openAddLocation = () => {
    setAutoStartPending(false);
    setNewLocationName('');
    setNewLocationPreset(null);
    setNewDumbbellMax('');
    setAddLocationError(null);
    setIsAddingLocation(true);
  };

  const closeAddLocation = () => {
    // Cancel: leave selection and plan untouched — the sheet is unchanged.
    setIsAddingLocation(false);
    setAddLocationError(null);
  };

  const pickNewLocationPreset = (kind: LocationPresetKind) => {
    setNewLocationPreset(kind);
    // Prefill the name from the preset unless the user has typed their own.
    const preset = LOCATION_PRESETS.find((p) => p.kind === kind);
    if (preset && (!newLocationName.trim() || LOCATION_PRESETS.some((p) => p.name === newLocationName))) {
      setNewLocationName(preset.name);
    }
  };

  // Create the location inline, select it, and (if a plan is already on
  // screen) regenerate the suggestion for it. The blocklist-cache effect
  // picks up the new selectedLocationId and fetches its equipment gaps, so
  // the plan rebuild waits until they're in before substituting.
  const handleSaveNewLocation = async () => {
    const name = newLocationName.trim();
    if (!name || isSavingLocation) return;
    setIsSavingLocation(true);
    setAddLocationError(null);
    try {
      // Local session read — getUser() hits the network and reads a blip as
      // "logged out"; RLS still verifies the token on the write itself.
      const userId = await getLocalUserId(supabase);
      if (!userId) throw new Error('Not signed in');

      const parsedDumbbell = parseFloat(newDumbbellMax);
      const created = await createTrainingLocation(userId, {
        name,
        presetKind: newLocationPreset,
        dumbbellMaxKg: Number.isFinite(parsedDumbbell) && parsedDumbbell > 0 ? parsedDumbbell : null,
      });

      setLocations((prev) => [...prev, created]);
      setSelectedLocationId(created.id);
      setLocationChosen(true);
      if (aiPlan) setAiRequested(true);
      setIsAddingLocation(false);
    } catch (err) {
      console.error('Failed to create training location:', err);
      setAddLocationError('Could not add the location. Please try again.');
    } finally {
      setIsSavingLocation(false);
    }
  };

  /** Swap a substituted pick to another exercise (or back to the original). */
  const handleChooseSwap = (pick: SubstitutedPick, chosenExerciseId: string) => {
    setAutoStartPending(false);
    setSwapOptionsFor(null);
    setAiPlan((plan) => {
      if (!plan || !pick.substitution) return plan;
      const sub = pick.substitution;
      return {
        ...plan,
        exercises: plan.exercises.map((p) => {
          if (p !== pick) return p;
          if (chosenExerciseId === sub.originalExerciseId) {
            // Revert: keep the original exercise despite the equipment gap.
            // Metadata stays (with the substitute back in the alternatives)
            // so the user can swap again.
            return {
              ...p,
              exerciseId: sub.originalExerciseId,
              sets: sub.originalSets,
              substitution: {
                ...sub,
                alternatives: [p.exerciseId, ...sub.alternatives.filter((id) => id !== p.exerciseId)],
              },
            };
          }
          const originalEx = exerciseById.get(sub.originalExerciseId);
          const chosenEx = exerciseById.get(chosenExerciseId);
          if (!originalEx || !chosenEx) return p;
          const alternatives = [sub.originalExerciseId !== p.exerciseId ? p.exerciseId : null]
            .concat(sub.alternatives)
            .filter((id): id is string => !!id && id !== chosenExerciseId && id !== sub.originalExerciseId);
          return buildSubstitutedPick(
            { ...p, exerciseId: sub.originalExerciseId, sets: sub.originalSets },
            toSubstitutionExercise(originalEx),
            toSubstitutionExercise(chosenEx),
            aiDuration,
            alternatives
          );
        }),
      };
    });
  };

  // Materialize the previewed plan: same session + block creation path as the
  // blank workout (lazy create, quickWeightEstimate, warmups on the session's
  // first exercise), with the plan's own set/rep/RIR targets.
  const handleStart = async () => {
    if (!aiPlan || aiPlan.exercises.length === 0 || isStarting) return;
    setIsStarting(true);
    setStartStage('creating');
    setError(null);
    try {
      // Only bounce to /login when the persisted session is genuinely absent.
      // getUser() here used to read a network blip as "logged out" and kick a
      // signed-in user to the login screen mid-flow.
      const userId = await getLocalUserId(supabase);
      if (!userId) {
        router.push('/login');
        return;
      }

      // Cross-exercise strength summary for cold-start weight estimation:
      // never-trained exercises (incl. first-time substitutes) seed from a
      // related exercise's logged e1RM before profile heuristics. Fetched
      // alongside the session (independent reads) instead of after it: the
      // panel sat on "Starting…" through each await in turn.
      const transferCandidatesPromise = fetchTransferCandidates(userId, supabase);
      const { sessionId, isNewSession } = await getOrCreateTodaySession(
        supabase,
        userId,
        'ai_suggested',
        selectedLocationId
      );
      // Start loading the workout screen while the blocks are written, so
      // the push below lands on a route that is already on its way.
      const destination = `/dashboard/workout/${sessionId}?fromCreate=true`;
      try {
        router.prefetch(destination);
      } catch {
        // Prefetch is an optimisation only.
      }
      const transferCandidates = await transferCandidatesPromise;

      let order = 1;
      if (!isNewSession) {
        const { data: maxOrderResult } = await supabase
          .from('exercise_blocks')
          .select('order')
          .eq('workout_session_id', sessionId)
          .order('order', { ascending: false })
          .limit(1)
          .maybeSingle();
        order = (maxOrderResult?.order || 0) + 1;
      }

      const blocks = [];
      for (const pick of aiPlan.exercises) {
        const exercise = exerciseById.get(pick.exerciseId);
        if (!exercise) continue;

        const isCompound = exercise.mechanic === 'compound';
        const repRange = pick.repRange;
        const substituted = isActiveSubstitution(pick);
        let suggestedWeight = 0;
        let lowConfidenceSeed = false;
        // Substitutes are estimated from the SUBSTITUTE's own name — the
        // original exercise's e1RM/history is never grafted on. First-time
        // substitutes fall through to related-lift / strength-standard
        // seeding, which the engine flags low-confidence.
        const weightRec = estimatePickStart(exercise, pick, profile, transferCandidates);
        if (weightRec) {
          suggestedWeight =
            weightRec.confidence === 'find_working_weight'
              ? 0
              : weightRec.recommendedWeight || 0;
          lowConfidenceSeed =
            substituted &&
            (weightRec.confidence === 'low' || weightRec.confidence === 'find_working_weight');
        }

        // Cap dumbbell suggestions at the location's heaviest dumbbell.
        suggestedWeight = capToLocationDumbbells(suggestedWeight, exercise, selectedLocation?.dumbbell_max_kg);

        let reason = pick.reason;
        if (substituted && pick.substitution) {
          reason += ` ↔ Swapped from ${pick.substitution.originalExerciseName} (equipment${
            selectedLocation ? ` at ${selectedLocation.name}` : ''
          })`;
          if (lowConfidenceSeed) reason += ' · weight seeded from strength data (low confidence)';
        }
        // The injury line rides into the workout on the block, last, so the
        // card can say why this lift was chosen for the user's shoulder/knee
        // (services/suggestedWorkout injuryNoteFromReason reads it back).
        const injuryLine = injuryPickLine(pick.injury, pick.exerciseId, injuryAreas, exerciseNameOf);
        if (injuryLine) reason += ` · ${injuryLine}`;

        let warmupSets: WarmupSet[] = [];
        if (isNewSession && blocks.length === 0) {
          warmupSets = generateWarmupProtocol({
            workingWeight: suggestedWeight > 0 ? suggestedWeight : 60,
            exercise: {
              id: exercise.id,
              name: exercise.name,
              primaryMuscle: (exercise.primary_muscle || 'chest') as MuscleGroup,
              secondaryMuscles: [],
              mechanic: isCompound ? 'compound' : 'isolation',
              defaultRepRange: repRange,
              defaultRir: pick.targetRir,
              minWeightIncrementKg: 2.5,
              formCues: [],
              commonMistakes: [],
              equipmentRequired: [],
              setupNote: '',
              movementPattern: isCompound ? 'compound' : 'isolation',
            },
            isFirstExercise: true,
          });
        }

        blocks.push({
          workout_session_id: sessionId,
          exercise_id: exercise.id,
          order: order++,
          target_sets: pick.sets,
          target_rep_range: repRange,
          target_rir: pick.targetRir,
          target_weight_kg: suggestedWeight,
          target_rest_seconds: isCompound ? 180 : 90,
          suggestion_reason: reason,
          warmup_protocol: { sets: warmupSets },
        });
      }

      if (blocks.length === 0) throw new Error('No exercises to start');
      rememberDuration(aiDuration);

      const { error: blocksError } = await supabase.from('exercise_blocks').insert(blocks);
      if (blocksError) throw blocksError;

      // Remember where this workout happened (best-effort) so next time the
      // chip row defaults to it.
      if (selectedLocationId) {
        touchLocationLastUsed(userId, selectedLocationId).catch(() => {});
      }

      if (locationChosen) markGymChosen(sessionId);
      setStartStage('opening');
      router.push(destination);
    } catch (err) {
      console.error('Failed to start suggested workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStarting(false);
    }
  };

  // One-tap start: the plan is built on mount; start it the moment it exists.
  // An empty plan keeps the sheet open on its "nothing to suggest" note.
  useEffect(() => {
    if (!autoStartPending || !aiPlan) return;
    setAutoStartPending(false);
    if (aiPlan.exercises.length > 0) void handleStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartPending, aiPlan]);

  // "Where are you training?" chip row. With a single profile the chip is
  // preselected and costs no interaction — the row stays visible so the
  // feature is discoverable. The + chip opens the inline add-location form
  // below (never navigates away — the sheet's state must survive).
  const locationChipRow = locations.length > 0 && (
    <div className="flex gap-1.5 flex-wrap items-center" role="group" aria-label="Training location">
      {locations.map((loc) => (
        <button
          key={loc.id}
          onClick={() => handleSelectLocation(loc.id)}
          disabled={aiRequested || isStarting}
          className={`px-2.5 py-1.5 rounded-full text-caption border transition-colors disabled:opacity-60 ${
            selectedLocationId === loc.id
              ? 'bg-action/20 border-action text-action'
              : 'bg-fill border-transparent text-ink-2 hover:bg-sep'
          }`}
          aria-pressed={selectedLocationId === loc.id}
        >
          <span aria-hidden="true">{locationIcon(toLocationSummary(loc))}</span> {loc.name}
        </button>
      ))}
      <button
        onClick={openAddLocation}
        disabled={aiRequested || isStarting}
        className="p-1.5 rounded-full bg-fill text-ink-2 hover:bg-sep hover:text-ink transition-colors disabled:opacity-60"
        aria-label="Add training location"
      >
        <IconPlus size={14} aria-hidden="true" />
      </button>
    </div>
  );

  const substitutionCount = aiPlan ? aiPlan.exercises.filter(isActiveSubstitution).length : 0;

  // Inline add-location form. Replaces the sheet body while open so the
  // underlying duration/plan state is preserved untouched behind it.
  const addLocationForm = (
    <div className="space-y-4">
      <p className="text-subhead text-ink-2">Add a place you train so we can fit the workout to its equipment.</p>

      {addLocationError && (
        <div className="p-2.5 rounded-lg bg-status-bad/10 border border-status-bad/20 text-status-bad text-caption">
          {addLocationError}
        </div>
      )}

      <div className="space-y-2">
        <span className="block text-caption font-medium text-ink-2">Start from a preset</span>
        <div className="flex gap-1.5 flex-wrap">
          {LOCATION_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              type="button"
              onClick={() => pickNewLocationPreset(preset.kind)}
              className={`px-2.5 py-1.5 rounded-full text-caption border transition-colors ${
                newLocationPreset === preset.kind
                  ? 'bg-action/20 border-action text-action'
                  : 'bg-fill border-transparent text-ink-2 hover:bg-sep'
              }`}
            >
              <span aria-hidden="true">{preset.icon}</span> {preset.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNewLocationPreset('custom')}
            className={`px-2.5 py-1.5 rounded-full text-caption border transition-colors ${
              newLocationPreset === 'custom'
                ? 'bg-action/20 border-action text-action'
                : 'bg-fill border-transparent text-ink-2 hover:bg-sep'
            }`}
          >
            Custom
          </button>
        </div>
        <p className="text-caption text-ink-3">
          Presets pre-fill the equipment checklist (edit it later in Settings). Custom starts with everything available.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="new-location-name" className="block text-caption font-medium text-ink-2">
          Location name
        </label>
        <input
          id="new-location-name"
          autoFocus
          value={newLocationName}
          onChange={(e) => setNewLocationName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newLocationName.trim()) handleSaveNewLocation();
          }}
          placeholder="e.g., Hotel Gym"
          className="w-full px-3 py-2 rounded-lg bg-fill border border-sep text-body text-ink placeholder:text-ink-3 focus:outline-none focus:border-action"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="new-location-dumbbell" className="block text-caption font-medium text-ink-2">
          Heaviest dumbbell (kg, optional)
        </label>
        <input
          id="new-location-dumbbell"
          type="number"
          value={newDumbbellMax}
          onChange={(e) => setNewDumbbellMax(e.target.value)}
          placeholder="e.g., 25"
          className="w-full px-3 py-2 rounded-lg bg-fill border border-sep text-body text-ink placeholder:text-ink-3 focus:outline-none focus:border-action"
        />
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={closeAddLocation}
          disabled={isSavingLocation}
          className="px-4 py-2 rounded-lg text-subhead font-medium bg-fill text-ink-2 hover:bg-sep transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveNewLocation}
          disabled={!newLocationName.trim() || isSavingLocation}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-subhead font-medium bg-action text-on-action hover:bg-action transition-colors disabled:opacity-60"
        >
          {isSavingLocation && <IconLoader2 size={14} className="animate-spin" aria-hidden="true" />}
          Save location
        </button>
      </div>
    </div>
  );

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={
        isAddingLocation
          ? 'Add training location'
          : aiPlan || !showDurationPicker
            ? 'Suggested workout'
            : 'How much time do you have?'
      }
    >
      {isAddingLocation ? (
        addLocationForm
      ) : (
      <>
      {error && (
        <div className="mb-3 p-2.5 rounded-lg bg-status-bad/10 border border-status-bad/20 text-status-bad text-caption">
          {error}
        </div>
      )}

      {!aiPlan && !showDurationPicker && (
        <div className="space-y-3">
          {locationChipRow}
          <p
            className="flex items-center gap-2 text-subhead text-ink-2"
            data-testid="suggested-workout-building"
          >
            <IconLoader2 size={14} className="animate-spin" aria-hidden="true" />
            {autoStartPending ? `Building and starting today’s ~${aiDuration}-minute workout…` : `Building a ~${aiDuration}-minute workout...`}
          </p>
        </div>
      )}

      {!aiPlan && showDurationPicker && (
        <div className="space-y-3">
          {locationChipRow}
          <p className="text-subhead text-ink-2">
            We&apos;ll size the workout to fit your time
            {selectedLocation ? ` and the equipment at ${selectedLocation.name}` : ''}.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {AI_DURATION_CHOICES.map((mins) => (
              <button
                key={mins}
                onClick={() => {
                  setAiDuration(mins);
                  rememberDuration(mins);
                  setAiRequested(true);
                }}
                disabled={aiRequested}
                className={`p-3 rounded-xl text-center border-2 transition-colors disabled:opacity-60 ${
                  aiRequested && aiDuration === mins
                    ? 'bg-action/20 border-action text-action'
                    : 'bg-fill border-transparent text-ink hover:bg-sep'
                }`}
              >
                <span className="block text-body font-semibold">{mins}</span>
                <span className="block text-caption text-ink-3">min</span>
              </button>
            ))}
          </div>
          {aiRequested && (
            <p className="flex items-center gap-2 text-subhead text-ink-2">
              <IconLoader2 size={14} className="animate-spin" aria-hidden="true" />
              Building suggestion...
            </p>
          )}
        </div>
      )}

      {aiPlan && (
        <div className="space-y-3">
          {locationChipRow}
          <p className="text-subhead text-ink-2" data-testid="suggested-workout-focus">
            {beginner ? beginnerSuggestedFocus(aiPlan.focus) : aiPlan.focus}
          </p>
          {(() => {
            // Why the list is in this order, from the builder's own rule.
            const orderLine = suggestedOrderLine(
              { order: planOrder, exercises: aiPlan.exercises },
              { beginner }
            );
            return orderLine ? (
              <p className="text-caption text-ink-2" data-testid="suggested-workout-order">
                {orderLine}
              </p>
            ) : null;
          })()}
          {(() => {
            // Did the injury areas shape the picks? Said either way, so
            // "does it account for my shoulder?" always has an answer.
            const line = aiPlan.exercises.length > 0 ? injuryPlanLine(aiPlan.exercises, injuryAreas) : null;
            return line ? (
              <p className="text-caption text-ink-2" data-testid="suggested-workout-injury">
                {line}
              </p>
            ) : null;
          })()}
          {aiPlan.isLightSession && aiPlan.exercises.length > 0 && (
            <p className="text-caption text-status-warn">
              {beginner
                ? 'Kept light so you can recover.'
                : 'Volume guardrail: staying under your weekly recoverable maximum.'}
            </p>
          )}
          {aiPlan.exercises.length > 0 && (
            <p className="text-caption text-ink-3">
              Sized for ~{aiDuration} minutes
              {substitutionCount > 0 && selectedLocation
                ? ` · ${substitutionCount} ${
                    substitutionCount === 1 ? 'exercise' : 'exercises'
                  } swapped for ${selectedLocation.name} equipment`
                : ''}
              .{' '}
              <button
                type="button"
                onClick={openDurationPicker}
                disabled={isStarting}
                className="font-medium text-action disabled:opacity-60"
                data-testid="suggested-workout-change-duration"
              >
                Change
              </button>
            </p>
          )}

          <div className="rounded-xl border border-sep bg-canvas/40 overflow-hidden">
            {aiPlan.exercises.map((pick) => {
              const exercise = exerciseById.get(pick.exerciseId);
              if (!exercise) return null;
              const sub = pick.substitution;
              const activeSub = isActiveSubstitution(pick);
              const showOptions = swapOptionsFor === pick.exerciseId && !!sub;
              return (
                <div
                  key={pick.exerciseId}
                  className="px-3 py-2.5 border-b border-sep/50 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-subhead text-ink truncate">
                        {exercise.name}
                      </span>
                      <span className="block text-caption text-ink-3">
                        {muscleName(pick.muscle)} · {pick.sets}{' '}
                        {pick.sets === 1 ? 'set' : 'sets'} ·{' '}
                        {formatTargetRange(pick.repRange, {
                          exerciseType: exercise.exercise_type,
                        })}
                        {exercise.exercise_type === 'duration_based' ? '' : ' reps'} ·{' '}
                        {rirTargetLabel(pick.targetRir, beginner)}
                      </span>
                      <span className="block text-caption text-ink-2" data-testid="suggested-pick-why">
                        {pickWhyLine({
                          isRecent: hasCompletedLift(exercise.id, lastCompletedAt),
                          lastDoneAt: lastCompletedAt.has(exercise.id)
                            ? new Date(lastCompletedAt.get(exercise.id)!)
                            : null,
                          lastTopSet: lastTopSets.get(exercise.id) ?? null,
                          muscleLabel: muscleName(pick.muscle),
                          rec: (() => {
                            const r = estimatePickStart(exercise, pick, profile, transferCandidates);
                            return r
                              ? { ...r, recommendedWeight: capToLocationDumbbells(r.recommendedWeight, exercise, selectedLocation?.dumbbell_max_kg) }
                              : null;
                          })(),
                          units: profile?.preferences?.units === 'kg' ? 'kg' : 'lb',
                        })}
                      </span>
                      <span className="block text-caption text-ink-3" data-testid="suggested-pick-reason">
                        {beginner ? beginnerPickReason(pick.reason, pick.muscle) : pick.reason}
                      </span>
                      {(() => {
                        const injuryLine = injuryPickLine(pick.injury, pick.exerciseId, injuryAreas, exerciseNameOf);
                        return injuryLine ? (
                          <span className="block text-caption text-ink-2" data-testid="suggested-pick-injury">
                            {injuryLine}
                          </span>
                        ) : null;
                      })()}
                      {sub && (
                        <button
                          onClick={() =>
                            setSwapOptionsFor(showOptions ? null : pick.exerciseId)
                          }
                          className="mt-0.5 flex items-center gap-1 text-caption text-action transition-colors"
                        >
                          <IconArrowsExchange size={12} aria-hidden="true" />
                          {activeSub
                            ? `Swapped from ${sub.originalExerciseName} (equipment)`
                            : `Needs equipment ${
                                selectedLocation ? `${selectedLocation.name} lacks` : 'unavailable here'
                              } — swap back?`}
                        </button>
                      )}
                      {pick.noSubstituteAvailable && (
                        <span className="mt-0.5 block text-caption text-status-warn">
                          No substitute available
                          {selectedLocation ? ` at ${selectedLocation.name}` : ''} — kept so this
                          muscle isn&apos;t dropped.
                        </span>
                      )}
                      {activeSub && (
                        <span className="block text-caption text-ink-3">
                          Logs to its own history; first-time weight is seeded from your strength
                          data.
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => handleRemovePick(pick.exerciseId)}
                      className="p-1.5 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-fill transition-colors flex-shrink-0"
                      aria-label={`Remove ${exercise.name}`}
                    >
                      <IconX size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {showOptions && sub && (
                    <div className="mt-2 space-y-1">
                      {(activeSub ? [sub.originalExerciseId] : [])
                        .concat(sub.alternatives)
                        .filter((id) => id !== pick.exerciseId)
                        .map((id) => {
                          const option = exerciseById.get(id);
                          if (!option) return null;
                          const isOriginal = id === sub.originalExerciseId;
                          return (
                            <button
                              key={id}
                              onClick={() => handleChooseSwap(pick, id)}
                              className="w-full text-left px-2.5 py-1.5 rounded-lg bg-fill/60 hover:bg-sep text-caption text-ink-2 transition-colors"
                            >
                              {isOriginal
                                ? `Keep ${option.name} anyway (equipment unavailable)`
                                : `Use ${option.name} instead`}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
            {aiPlan.exercises.length === 0 && (
              <p className="p-4 text-center text-caption text-ink-3">
                Nothing to suggest right now — a blank workout is always available.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <button
              onClick={handleStart}
              disabled={isStarting || aiPlan.exercises.length === 0}
              className="w-full py-2.5 rounded-lg bg-action text-on-action text-subhead font-medium hover:bg-action transition-colors disabled:opacity-60"
            >
              {isStarting
                ? startStageLabel(startStage)
                : `Start workout (${aiPlan.exercises.length} ${
                    aiPlan.exercises.length === 1 ? 'exercise' : 'exercises'
                  })`}
            </button>
            <button
              onClick={openDurationPicker}
              disabled={isStarting}
              className="w-full py-2 rounded-lg text-subhead text-ink-2 hover:text-ink transition-colors disabled:opacity-60"
            >
              Change duration
            </button>
            <button
              onClick={onClose}
              disabled={isStarting}
              className="w-full py-2 rounded-lg text-subhead text-ink-2 hover:text-ink transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      </>
      )}
    </BottomSheet>
  );
}
