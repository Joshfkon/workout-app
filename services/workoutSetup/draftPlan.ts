/**
 * draftPlan — build the instant, deterministic draft for the setup flow.
 *
 * Composition of existing engines, not a new one:
 *  - guardrails: filterExercisesByEquipment (fail-closed) + isMuscleExcludedByInjury,
 *  - exercise preference: compareExerciseCandidates (the suggested-workout
 *    order: recent → staple → compound → tier → name) and its rep/RIR targets,
 *  - volume: perSetGroupCredits via plannedCreditByGroup — sets are sized to
 *    move each selected group's weekly CREDITED volume toward its zone,
 *    counting the spill-over earlier picks already give it,
 *  - ordering: autoArrangeExercises (compounds first, grip rule, overlap
 *    interleave, + stabilizer stacking and larger-groups-first),
 *  - duration: the app-wide planned-session model (estimatePlanMinutes).
 *
 * Pure and synchronous — no DB, no network, no randomness, no clock.
 */

import { filterExercisesByEquipment } from '@/services/equipmentFilter';
import { isMuscleExcludedByInjury } from '@/services/shared/injuryExclusion';
import { computeStapleExerciseIds } from '@/services/exerciseStaples';
import {
  compareExerciseCandidates,
  repRangeFor,
  targetRirFor,
} from '@/services/suggestedWorkout';
import { autoArrangeExercises, GROUP_SIZE_ORDER } from '@/services/exerciseOrdering';
import type { CoarseMuscle } from '@/services/volumeBands';
import type { StandardMuscleGroup } from '@/types/schema';
import { SETUP_CONFIG } from './config';
import {
  primaryGroupOf,
  primaryStandards,
  servesGroup,
  trackedStabilizersOf,
} from './exerciseMeta';
import { estimatePlanMinutes, plannedCreditByGroup } from './planProjection';
import type {
  PlanItem,
  PlanItemSource,
  SetupExercise,
  SetupGroupState,
  StabilizerLoadLevel,
} from './types';

export interface BuildDraftPlanInput {
  /** Selected groups (the picker's chips). Order is not significant. */
  groups: readonly SetupGroupState[];
  exercises: readonly SetupExercise[];
  /** Exercise ids the user does, most used/recent first (preference signal). */
  recentExerciseIds: readonly string[];
  unavailableEquipmentIds?: readonly string[];
  /** Exercises unavailable at the current location (per-exercise overrides). */
  unavailableExerciseIds?: readonly string[];
  injuredMuscles?: readonly string[];
  /** Stabilizer-channel load per tracked stabilizer. */
  stabilizerLoad?: Partial<Record<StandardMuscleGroup, StabilizerLoadLevel>>;
  /** Minutes; null/undefined = no budget. */
  timeBudgetMin?: number | null;
}

export interface DraftPlanResult {
  items: PlanItem[];
  /** Working sets removed to fit the time budget. */
  trimmedSets: number;
  /** Selected groups the library had no usable exercise for. */
  unfilledGroups: CoarseMuscle[];
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Session working sets for one selected group, before splitting into exercises. */
export function groupSessionSets(
  state: SetupGroupState,
  alreadyPlannedCredit: number
): number {
  const c = SETUP_CONFIG;
  const credited = state.weeklyCredited + alreadyPlannedCredit;
  const deficit = Math.max(0, state.zoneMin - credited);
  const headroom = state.zoneMax - credited;

  let sets: number;
  switch (state.status) {
    case 'fresh':
      sets = clampInt(Math.max(deficit, c.baseGroupSets), c.minGroupSets, c.maxGroupSets);
      break;
    case 'recovering':
      sets = clampInt(
        Math.max(deficit, c.baseGroupSets) * c.recoveringScale,
        c.minGroupSets,
        c.maxGroupSets
      );
      break;
    case 'fatigued':
      sets = c.fatiguedGroupSets;
      break;
    case 'unknown':
      sets = c.unknownGroupSets;
      break;
  }
  // Never plan past the weekly ceiling — but a group the user explicitly
  // chose still gets a minimal dose (the footer warns if that crosses MRV).
  return Math.max(c.minGroupSets, Math.min(sets, Math.floor(headroom)));
}

/** Split a group's session sets across 1–2 exercises (bigger share first). */
export function splitGroupSets(total: number): number[] {
  const c = SETUP_CONFIG;
  if (total <= c.splitAboveSets) return [total];
  const first = Math.ceil(total / 2);
  const second = total - first;
  return second >= c.minSetsPerExercise ? [first, second] : [total];
}

function restFor(ex: SetupExercise): number {
  return ex.mechanic === 'isolation'
    ? SETUP_CONFIG.restSeconds.isolation
    : SETUP_CONFIG.restSeconds.compound;
}

/** A plan item for `ex`, with library rep/RIR targets (shared with the suggester). */
export function makePlanItem(
  ex: SetupExercise,
  itemId: string,
  sets: number,
  source: PlanItemSource,
  opts: { rirBump?: number; reason?: string } = {}
): PlanItem {
  const suggesterView = {
    id: ex.id,
    name: ex.name,
    primaryMuscle: ex.primaryMuscle,
    tier: ex.tier,
    mechanic: ex.mechanic,
    defaultRepRange: ex.defaultRepRange,
    defaultRir: ex.defaultRir,
  };
  return {
    itemId,
    exerciseId: ex.id,
    group: primaryGroupOf(ex),
    sets: clampInt(sets, SETUP_CONFIG.minSetsPerItem, SETUP_CONFIG.maxSetsPerItem),
    repRange: repRangeFor(suggesterView),
    targetRir: targetRirFor(suggesterView, (ex.defaultRir ?? 2) + (opts.rirBump ?? 0)),
    restSeconds: restFor(ex),
    source,
    reason: opts.reason,
  };
}

/** Next free `item-N` id for a plan. */
export function nextItemId(items: readonly Pick<PlanItem, 'itemId'>[]): string {
  let max = 0;
  for (const { itemId } of items) {
    const m = /^item-(\d+)$/.exec(itemId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `item-${max + 1}`;
}

/** Usable exercises after the equipment / location / injury guardrails. */
export function usableExercises(
  exercises: readonly SetupExercise[],
  unavailableEquipmentIds: readonly string[] = [],
  unavailableExerciseIds: readonly string[] = [],
  injuredMuscles: readonly string[] = []
): SetupExercise[] {
  const blockedIds = new Set(unavailableExerciseIds);
  return filterExercisesByEquipment([...exercises], [...unavailableEquipmentIds]).filter(
    (ex) =>
      !blockedIds.has(ex.id) &&
      (!ex.primaryMuscle || !isMuscleExcludedByInjury(ex.primaryMuscle, [...injuredMuscles]))
  );
}

/** Deterministic auto-arrange for plan items (the shared ordering service). */
export function arrangePlanItems(
  items: readonly PlanItem[],
  exercisesById: ReadonlyMap<string, SetupExercise>
): PlanItem[] {
  return autoArrangeExercises(
    items,
    (item) => {
      const ex = exercisesById.get(item.exerciseId);
      return {
        id: item.itemId,
        name: ex?.name ?? item.exerciseId,
        primaryMuscle: ex?.primaryMuscle ?? null,
        secondaryMuscles: ex?.secondaryMuscles ?? [],
        mechanic: ex?.mechanic ?? null,
        movementPattern: ex?.movementPattern ?? null,
        stabilizers: ex?.stabilizers ?? [],
      };
    },
    { preferLargerGroups: true }
  );
}

function sizeRank(group: CoarseMuscle): number {
  const idx = GROUP_SIZE_ORDER.indexOf(group);
  return idx === -1 ? GROUP_SIZE_ORDER.length : idx;
}

/**
 * Build the draft. Groups are filled largest-first so a compound's secondary
 * credit (bench → triceps) counts toward the smaller groups before they are
 * sized; then the whole plan is auto-arranged and, with a budget, trimmed.
 */
export function buildDraftPlan(input: BuildDraftPlanInput): DraftPlanResult {
  const pool = usableExercises(
    input.exercises,
    input.unavailableEquipmentIds,
    input.unavailableExerciseIds,
    input.injuredMuscles
  );
  const exercisesById = new Map(input.exercises.map((ex) => [ex.id, ex]));
  const recentIds = new Set(input.recentExerciseIds);
  const stapleIds = computeStapleExerciseIds(
    pool.map((ex) => ({ id: ex.id, muscle: ex.primaryMuscle, tier: ex.tier }))
  );
  const stabilizerLoad = input.stabilizerLoad ?? {};
  const loadsFatiguedStabilizer = (ex: SetupExercise) =>
    trackedStabilizersOf(ex).some((s) => stabilizerLoad[s] === 'high');

  const groups = [...input.groups].sort(
    (a, b) => sizeRank(a.group) - sizeRank(b.group) || a.group.localeCompare(b.group)
  );

  const items: PlanItem[] = [];
  const picked = new Set<string>();
  const unfilledGroups: CoarseMuscle[] = [];

  for (const state of groups) {
    const credit = plannedCreditByGroup(items, exercisesById).get(state.group) ?? 0;
    const total = groupSessionSets(state, credit);
    const deficit = Math.max(0, Math.round(state.zoneMin - state.weeklyCredited - credit));
    const reason =
      state.status === 'unknown'
        ? `${state.displayName}: no recent data, starting easy`
        : deficit > 0
          ? `${state.displayName}: ${deficit} sets below zone`
          : state.displayName;
    const split = splitGroupSets(total);
    const focus = new Set(state.focusMuscles);
    const gentle = state.status === 'fatigued' || state.status === 'recovering';

    const candidates = pool
      .filter((ex) => servesGroup(ex, state.group) && !picked.has(ex.id))
      .sort((a, b) => {
        // 1. Don't prescribe work that leans on a fatigued stabilizer.
        const stab = Number(loadsFatiguedStabilizer(a)) - Number(loadsFatiguedStabilizer(b));
        if (stab !== 0) return stab;
        // 2. A lagging fine muscle (e.g. rear delts under Shoulders) first.
        const fa = primaryStandards(a).some((m) => focus.has(m)) ? 0 : 1;
        const fb = primaryStandards(b).some((m) => focus.has(m)) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        // 3. Not-ready groups get isolation work before heavy compounds.
        if (gentle && a.mechanic !== b.mechanic) {
          return (a.mechanic === 'isolation' ? 0 : 1) - (b.mechanic === 'isolation' ? 0 : 1);
        }
        return compareExerciseCandidates(a, b, recentIds, stapleIds);
      });

    if (candidates.length === 0) {
      unfilledGroups.push(state.group);
      continue;
    }

    let first: SetupExercise | null = null;
    for (const sets of split) {
      // Second exercise: a different movement pattern than the first when
      // one exists (no two flat presses), else the next best.
      const next: SetupExercise | undefined =
        first === null
          ? candidates[0]
          : candidates.find(
              (ex) => !picked.has(ex.id) && ex.movementPattern !== first!.movementPattern
            ) ?? candidates.find((ex) => !picked.has(ex.id));
      if (!next) {
        // Only one usable exercise: fold the remaining sets into it.
        const last = items[items.length - 1];
        if (last && first && last.exerciseId === first.id) {
          last.sets = Math.min(SETUP_CONFIG.maxSetsPerItem, last.sets + sets);
        }
        break;
      }
      picked.add(next.id);
      const caution = state.status === 'fatigued' || loadsFatiguedStabilizer(next);
      items.push(
        makePlanItem(next, nextItemId(items), sets, 'generated', {
          rirBump: caution ? SETUP_CONFIG.cautionRirBump : 0,
          reason,
        })
      );
      first = first ?? next;
    }
  }

  const arranged = arrangePlanItems(items, exercisesById);
  if (input.timeBudgetMin == null) {
    return { items: arranged, trimmedSets: 0, unfilledGroups };
  }
  const trimmed = trimPlanToBudget(arranged, exercisesById, input.groups, input.timeBudgetMin);
  return { items: trimmed.items, trimmedSets: trimmed.trimmedSets, unfilledGroups };
}

/**
 * Trim the lowest-priority sets until the plan fits `budgetMin`.
 *
 * Priority (lowest trimmed first):
 *  1. items serving a group already at/above its zone min (the plan adds
 *     beyond what the week needs) before items closing a deficit,
 *  2. a group's secondary exercise before its first,
 *  3. isolation before compound,
 *  4. later in the session before earlier.
 * Sets come off one at a time down to SETUP_CONFIG.minSetsPerExercise; only
 * when every item is at the floor are whole items dropped (same priority),
 * never the last one.
 */
export function trimPlanToBudget(
  items: readonly PlanItem[],
  exercisesById: ReadonlyMap<string, SetupExercise>,
  groupStates: readonly SetupGroupState[],
  budgetMin: number
): { items: PlanItem[]; trimmedSets: number } {
  let plan = items.map((i) => ({ ...i }));
  let trimmedSets = 0;
  const stateByGroup = new Map(groupStates.map((g) => [g.group, g]));

  const priorityKey = (item: PlanItem, index: number, current: readonly PlanItem[]): number[] => {
    const state = item.group ? stateByGroup.get(item.group) : undefined;
    const hasDeficit = state ? state.weeklyCredited < state.zoneMin : false;
    const isFirstForGroup =
      current.findIndex((other) => other.group === item.group) === index;
    const compound = exercisesById.get(item.exerciseId)?.mechanic === 'compound';
    return [hasDeficit ? 1 : 0, isFirstForGroup ? 1 : 0, compound ? 1 : 0, -index];
  };
  const lowest = (candidates: number[], current: readonly PlanItem[]): number => {
    let best = candidates[0];
    let bestKey = priorityKey(current[best], best, current);
    for (const idx of candidates.slice(1)) {
      const key = priorityKey(current[idx], idx, current);
      for (let k = 0; k < key.length; k++) {
        if (key[k] !== bestKey[k]) {
          if (key[k] < bestKey[k]) {
            best = idx;
            bestKey = key;
          }
          break;
        }
      }
    }
    return best;
  };

  // Hard stop so a pathological input can never spin.
  for (let guard = 0; guard < 200; guard++) {
    if (estimatePlanMinutes(plan, exercisesById) <= budgetMin) break;
    const reducible = plan
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.sets > SETUP_CONFIG.minSetsPerExercise)
      .map(({ idx }) => idx);
    if (reducible.length > 0) {
      const idx = lowest(reducible, plan);
      plan[idx] = { ...plan[idx], sets: plan[idx].sets - 1 };
      trimmedSets += 1;
      continue;
    }
    if (plan.length <= 1) break;
    const idx = lowest(
      plan.map((_, i) => i),
      plan
    );
    trimmedSets += plan[idx].sets;
    plan = plan.filter((_, i) => i !== idx);
  }
  return { items: plan, trimmedSets };
}
