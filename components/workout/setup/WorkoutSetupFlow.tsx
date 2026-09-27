'use client';

/**
 * WorkoutSetupFlow — the empty-workout setup: Target Picker → Draft Editor.
 *
 * Everything shown here is computed synchronously from cached data by the
 * existing engines (readiness rows, the draft builder, the shared projection
 * and duration models); nothing on this path waits on the network once the
 * readiness history and catalog are cached. Start hands the ordered plan to
 * the page, which creates the blocks through its normal add-exercise path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMuscleReadiness } from '@/hooks/useMuscleReadiness';
import { useRecentSessionSummaries, useSetupCatalog } from '@/hooks/useWorkoutSetupData';
import { now as clockNow } from '@/lib/clock';
import type { CoarseMuscle } from '@/services/volumeBands';
import { buildDraftPlan, makePlanItem, nextItemId } from '@/services/workoutSetup/draftPlan';
import { applyPlanEdit, type PlanEdit } from '@/services/workoutSetup/planEdits';
import {
  estimatePlanMinutes,
  planWarnings,
  projectPlanVolume,
} from '@/services/workoutSetup/planProjection';
import { rankSwapCandidates } from '@/services/workoutSetup/swapRanking';
import { SETUP_CONFIG } from '@/services/workoutSetup/config';
import type { PlanItem, RecentSessionSummary, SetupExercise } from '@/services/workoutSetup/types';
import {
  buildTargetChips,
  deriveShortcuts,
  dominantGroups,
  groupStatesFromRows,
  stabilizerLoadMap,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/setup/targetPicker';
import { TargetPicker } from './TargetPicker';
import { DraftPlanEditor } from './DraftPlanEditor';

const BUDGET_STORAGE_KEY = 'hypertrack:setup-time-budget';
const DAY_MS = 86_400_000;

function readStoredBudget(): number | null {
  try {
    const raw = window.localStorage.getItem(BUDGET_STORAGE_KEY);
    if (raw === null || raw === 'none') return null;
    const n = Number(raw);
    return (SETUP_CONFIG.timeBudgetOptions as readonly number[]).includes(n) ? n : null;
  } catch {
    return null;
  }
}

function storeBudget(minutes: number | null) {
  try {
    window.localStorage.setItem(BUDGET_STORAGE_KEY, minutes === null ? 'none' : String(minutes));
  } catch {
    // Private mode / blocked storage — the default just won't stick.
  }
}

export interface StartPlanPayload {
  items: PlanItem[];
  exercisesById: ReadonlyMap<string, SetupExercise>;
}

export interface WorkoutSetupFlowProps {
  sessionId: string;
  /** Location blocklists (the same ones the add-exercise picker uses). */
  unavailableEquipmentIds: string[];
  unavailableExerciseIds: string[];
  /** 90-day usage counts by exercise id (preference signal). */
  usageCounts: ReadonlyMap<string, number>;
  /** Open the existing picker in manual mode (the old empty state). */
  onBuildManually: () => void;
  /**
   * Open the existing picker to add to the PLAN; the page calls the returned
   * callback with the chosen exercise ids.
   */
  onRequestAddToPlan: (add: (exerciseIds: string[]) => void) => void;
  /** Create the blocks. Resolves false (with a message) when it could not. */
  onStart: (payload: StartPlanPayload) => Promise<{ ok: boolean; error?: string }>;
  disabled?: boolean;
  /** Rendered under the picker only (not in the editor). */
  pickStepExtras?: React.ReactNode;
}

export function WorkoutSetupFlow({
  sessionId,
  unavailableEquipmentIds,
  unavailableExerciseIds,
  usageCounts,
  onBuildManually,
  onRequestAddToPlan,
  onStart,
  disabled = false,
  pickStepExtras,
}: WorkoutSetupFlowProps) {
  const [now] = useState(() => clockNow());
  const readiness = useMuscleReadiness({ liveBlocks: EMPTY, liveSets: EMPTY, now, enabled: true });
  const catalogQuery = useSetupCatalog(true);
  const recentQuery = useRecentSessionSummaries(true, sessionId);

  const catalog = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const exercisesById = useMemo(() => new Map(catalog.map((ex) => [ex.id, ex])), [catalog]);
  const recentSessions = useMemo(() => recentQuery.data ?? [], [recentQuery.data]);

  const chips = useMemo(
    () => buildTargetChips(readiness.rows, readiness.targets),
    [readiness.rows, readiness.targets]
  );
  const groupStates = useMemo(
    () => groupStatesFromRows(readiness.rows, readiness.targets),
    [readiness.rows, readiness.targets]
  );
  const stabilizerLoad = useMemo(
    () => stabilizerLoadMap(readiness.stabilizerRecovery, readiness.recoveryConfig),
    [readiness.stabilizerRecovery, readiness.recoveryConfig]
  );
  const shortcuts = useMemo(
    () => deriveShortcuts(recentSessions, (iso) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS))),
    [recentSessions, now]
  );

  // Preference / recency signals shared by the builder and the swap sheet.
  const recentExerciseIds = useMemo(() => {
    const seen = new Set<string>();
    recentSessions.forEach((s) => s.exercises.forEach((e) => seen.add(e.exerciseId)));
    const byUsage = Array.from(usageCounts.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return [...Array.from(seen), ...byUsage.filter((id) => !seen.has(id))];
  }, [recentSessions, usageCounts]);
  const recentlyDoneIds = useMemo(() => {
    const cutoff = now.getTime() - SETUP_CONFIG.swapRecentDays * DAY_MS;
    const ids = new Set<string>();
    recentSessions
      .filter((s) => new Date(s.completedAt).getTime() >= cutoff)
      .forEach((s) => s.exercises.forEach((e) => ids.add(e.exerciseId)));
    return ids;
  }, [recentSessions, now]);

  // ---- Step 1: selection (pre-selected once readiness lands) --------------
  const [step, setStep] = useState<'pick' | 'edit'>('pick');
  const [selected, setSelected] = useState<Set<CoarseMuscle>>(new Set());
  const [timeBudget, setTimeBudget] = useState<number | null>(null);
  const seeded = useRef(false);
  useEffect(() => {
    setTimeBudget(readStoredBudget());
  }, []);
  useEffect(() => {
    if (seeded.current || readiness.isLoading || chips.length === 0) return;
    seeded.current = true;
    setSelected(new Set(chips.filter((c) => c.preselected).map((c) => c.group)));
  }, [chips, readiness.isLoading]);

  const toggle = useCallback((group: CoarseMuscle) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // ---- Step 2: the draft ---------------------------------------------------
  const [items, setItems] = useState<PlanItem[]>([]);
  const [planGroups, setPlanGroups] = useState<CoarseMuscle[]>([]);
  const [trimmedSets, setTrimmedSets] = useState(0);
  const [unfilledGroups, setUnfilledGroups] = useState<CoarseMuscle[]>([]);

  const build = useCallback(
    (groups: CoarseMuscle[]) => {
      const wanted = new Set(groups);
      const states = groupStates.filter((g) => wanted.has(g.group));
      const result = buildDraftPlan({
        groups: states,
        exercises: catalog,
        recentExerciseIds,
        unavailableEquipmentIds,
        unavailableExerciseIds,
        stabilizerLoad,
        timeBudgetMin: timeBudget,
      });
      setItems(result.items);
      setTrimmedSets(result.trimmedSets);
      setUnfilledGroups(result.unfilledGroups);
      setPlanGroups(groups);
      setStep('edit');
    },
    [groupStates, catalog, recentExerciseIds, unavailableEquipmentIds, unavailableExerciseIds, stabilizerLoad, timeBudget]
  );

  const loadSession = useCallback(
    (session: RecentSessionSummary) => {
      const loaded: PlanItem[] = [];
      for (const ex of session.exercises) {
        const catalogEx = exercisesById.get(ex.exerciseId);
        if (!catalogEx || loaded.some((i) => i.exerciseId === ex.exerciseId)) continue;
        loaded.push(makePlanItem(catalogEx, nextItemId(loaded), ex.workingSets, 'repeat'));
      }
      setItems(loaded);
      setTrimmedSets(0);
      setUnfilledGroups([]);
      setPlanGroups(dominantGroups(session));
      setStep('edit');
    },
    [exercisesById]
  );

  const edit = useCallback((e: PlanEdit) => setItems((prev) => applyPlanEdit(prev, e)), []);

  // Adds from the page's picker are queued and applied once the catalog has
  // them — a custom exercise created mid-pick lands after a catalog refetch.
  const [pendingAdds, setPendingAdds] = useState<string[]>([]);
  const addToPlan = useCallback((exerciseIds: string[]) => {
    setPendingAdds((prev) => [...prev, ...exerciseIds]);
  }, []);
  useEffect(() => {
    if (pendingAdds.length === 0) return;
    const ready = pendingAdds.filter((id) => exercisesById.has(id));
    if (ready.length === 0) return;
    setItems((prev) => {
      let next = prev;
      for (const id of ready) {
        if (!next.some((i) => i.exerciseId === id)) {
          next = applyPlanEdit(next, { type: 'add', exercise: exercisesById.get(id)! });
        }
      }
      return next;
    });
    setPendingAdds((prev) => prev.filter((id) => !ready.includes(id)));
  }, [pendingAdds, exercisesById]);

  // Live footer — every edit re-derives from `items` through the shared models.
  const projection = useMemo(
    () => projectPlanVolume(items, exercisesById, groupStates, planGroups),
    [items, exercisesById, groupStates, planGroups]
  );
  const estimatedMinutes = useMemo(() => estimatePlanMinutes(items, exercisesById), [items, exercisesById]);
  const warnings = useMemo(
    () =>
      planWarnings({ items, exercisesById, projection, estimatedMinutes, timeBudgetMin: timeBudget, stabilizerLoad }),
    [items, exercisesById, projection, estimatedMinutes, timeBudget, stabilizerLoad]
  );

  const rankSwaps = useCallback(
    (item: PlanItem) => {
      const current = exercisesById.get(item.exerciseId);
      if (!current) return [];
      return rankSwapCandidates(current, catalog, {
        unavailableEquipmentIds,
        unavailableExerciseIds,
        recentlyDoneIds,
        usageCounts,
        excludeIds: new Set(items.map((i) => i.exerciseId)),
      });
    },
    [exercisesById, catalog, unavailableEquipmentIds, unavailableExerciseIds, recentlyDoneIds, usageCounts, items]
  );

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const start = useCallback(async () => {
    setStartError(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStartError("You're offline — starting needs a connection. Your plan is kept; try again when you're back online.");
      return;
    }
    setIsStarting(true);
    try {
      const result = await onStart({ items, exercisesById });
      if (!result.ok) setStartError(result.error ?? 'Could not start the workout. Try again.');
    } finally {
      setIsStarting(false);
    }
  }, [items, exercisesById, onStart]);

  if (step === 'edit') {
    return (
      <DraftPlanEditor
        items={items}
        exercisesById={exercisesById}
        projection={projection}
        estimatedMinutes={estimatedMinutes}
        timeBudget={timeBudget}
        warnings={warnings}
        trimmedSets={trimmedSets}
        unfilledGroups={unfilledGroups.map((g) => groupStates.find((s) => s.group === g)?.displayName ?? g)}
        onEdit={edit}
        rankSwaps={rankSwaps}
        onAddExercise={() => onRequestAddToPlan(addToPlan)}
        onBack={() => setStep('pick')}
        onStart={start}
        isStarting={isStarting || disabled}
        startError={startError}
      />
    );
  }

  return (
    <>
    <TargetPicker
      chips={chips}
      selected={selected}
      onToggle={toggle}
      shortcuts={shortcuts}
      onRepeatType={(groups) => build(groups)}
      onLoadSession={loadSession}
      timeBudget={timeBudget}
      onTimeBudgetChange={(m) => {
        setTimeBudget(m);
        storeBudget(m);
      }}
      onBuild={() => build(chips.filter((c) => selected.has(c.group)).map((c) => c.group))}
      onBuildManually={onBuildManually}
      disabled={disabled || (catalog.length === 0 && catalogQuery.isLoading)}
      isLoading={readiness.isLoading}
    />
    {pickStepExtras}
    </>
  );
}

const EMPTY: never[] = [];
